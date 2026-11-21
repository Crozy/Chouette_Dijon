"""GTFS statique Divia : téléchargé au démarrage, mis en cache disque 24 h.

Fournit les correspondances route_id → ligne/couleur, trip_id → destination, stop_id → nom,
ainsi que les tracés des lignes de tram et de bus.
"""
import asyncio
import csv
import io
import logging
import time
import zipfile
from dataclasses import dataclass, field

from app.config import get_settings
from app.fallback.data import TRAM_FALLBACK_SHAPES
from app.models import LineShape, StopLine, TransitStop
from app.services import registry
from app.services.http import client

log = logging.getLogger(__name__)
MAX_AGE = 24 * 3600


@dataclass
class Route:
    route_id: str
    short_name: str
    long_name: str
    route_type: int
    color: str
    text_color: str


@dataclass
class GtfsStatic:
    loaded: bool = False
    routes: dict[str, Route] = field(default_factory=dict)
    trips: dict[str, tuple[str, str]] = field(default_factory=dict)  # trip_id -> (route_id, headsign)
    stops: dict[str, str] = field(default_factory=dict)
    tram_shapes: list[LineShape] = field(default_factory=list)
    line_shapes: list[LineShape] = field(default_factory=list)  # toutes lignes, un tracé par sens
    transit_stops: list[TransitStop] = field(default_factory=list)  # arrêts desservis, avec leurs lignes
    # Passages par arrêt, par service (calendrier) et par heure : stop_id -> service_id -> [24 compteurs]
    stop_hourly: dict[str, dict[str, list[int]]] = field(default_factory=dict)
    # Calendrier : service_id -> (jours actifs lun..dim, début AAAAMMJJ, fin AAAAMMJJ) et exceptions
    calendar: dict[str, tuple[tuple[bool, ...], str, str]] = field(default_factory=dict)
    calendar_dates: dict[tuple[str, str], int] = field(default_factory=dict)  # (service_id, AAAAMMJJ) -> 1 ajout / 2 retrait


STATE = GtfsStatic()
_lock = asyncio.Lock()


def _text_color(hex_color: str) -> str:
    try:
        r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return "FFFFFF"
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return "111111" if lum > 150 else "FFFFFF"


def _hsl_hex(h: float, s: float, l: float) -> str:
    import colorsys
    r, g, b = colorsys.hls_to_rgb(h / 360, l, s)
    return f"{round(r * 255):02X}{round(g * 255):02X}{round(b * 255):02X}"


def bus_color(index: int) -> str:
    """Couleur distincte pour la n-ième ligne de bus.

    Divia ne donne aux bus que quelques couleurs de « famille » : on attribue à chaque ligne sa propre
    teinte (angle d'or → deux lignes voisines ont des teintes très différentes), en évitant le
    magenta réservé aux trams et en alternant la luminosité.
    """
    h = (index * 137.508) % 315
    if h >= 300:
        h += 45  # saute la plage 300–345° (magenta du tram)
    l = (0.42, 0.52, 0.34)[index % 3]
    return _hsl_hex(h, 0.78, l)


def _sort_key(name: str):
    return (not name[:1].isdigit(), int(name) if name.isdigit() else 0, name)


def _read(z: zipfile.ZipFile, name: str):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def parse_zip(data: bytes) -> GtfsStatic:
    st = GtfsStatic()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for r in _read(z, "routes.txt"):
            color = (r.get("route_color") or "005CA9").strip().upper() or "005CA9"
            st.routes[r["route_id"]] = Route(
                route_id=r["route_id"], short_name=r.get("route_short_name") or r["route_id"],
                long_name=r.get("route_long_name") or "", route_type=int(r.get("route_type") or 3),
                color=color, text_color=(r.get("route_text_color") or _text_color(color)).upper(),
            )
        # Une couleur propre à chaque ligne de bus (les trams gardent leur couleur officielle)
        bus_names = sorted({r.short_name for r in st.routes.values() if r.route_type != 0}, key=_sort_key)
        palette = {name: bus_color(i) for i, name in enumerate(bus_names)}
        for r in st.routes.values():
            if r.route_type != 0:
                r.color = palette[r.short_name]
                r.text_color = _text_color(r.color)
        tram_shape_ids: dict[str, set[str]] = {}
        route_shape_ids: dict[tuple[str, int], set[str]] = {}  # (route_id, sens) -> shape_ids
        sample_trips: dict[str, str] = {}  # un trip représentatif par tracé -> route_id
        trip_service: dict[str, str] = {}
        for t in _read(z, "trips.txt"):
            st.trips[t["trip_id"]] = (t["route_id"], (t.get("trip_headsign") or "").strip())
            trip_service[t["trip_id"]] = t.get("service_id") or ""
            sample_trips.setdefault(t.get("shape_id") or t["trip_id"], t["trip_id"])
            route = st.routes.get(t["route_id"])
            if not route or not t.get("shape_id"):
                continue
            if route.route_type == 0:
                tram_shape_ids.setdefault(route.short_name, set()).add(t["shape_id"])
            direction = int(t.get("direction_id") or 0)
            route_shape_ids.setdefault((route.route_id, direction), set()).add(t["shape_id"])
        stop_rows = list(_read(z, "stops.txt"))
        for s in stop_rows:
            st.stops[s["stop_id"]] = s.get("stop_name") or s["stop_id"]

        # Lignes desservant chaque arrêt : on ne lit que les courses représentatives (une par tracé)
        wanted_trips = {trip_id: st.trips[trip_id][0] for trip_id in sample_trips.values()}
        stop_routes: dict[str, set[str]] = {}
        with z.open("stop_times.txt") as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig"))
            header = [h.strip() for h in next(reader)]
            i_trip, i_stop = header.index("trip_id"), header.index("stop_id")
            i_time = header.index("departure_time") if "departure_time" in header else header.index("arrival_time")
            for row in reader:
                route_id = wanted_trips.get(row[i_trip])
                if route_id:
                    stop_routes.setdefault(row[i_stop], set()).add(route_id)
                # Comptage des passages (sert à estimer l'affluence autour des arrêts)
                hh = row[i_time][:2] if len(row) > i_time else ""
                if hh.isdigit():
                    per_service = st.stop_hourly.setdefault(row[i_stop], {})
                    counts = per_service.get(trip_service.get(row[i_trip], ""))
                    if counts is None:
                        counts = per_service[trip_service.get(row[i_trip], "")] = [0] * 24
                    counts[int(hh) % 24] += 1
        if "calendar.txt" in z.namelist():
            days = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
            for c in _read(z, "calendar.txt"):
                st.calendar[c["service_id"]] = (tuple(c.get(d) == "1" for d in days),
                                                c.get("start_date") or "00000000", c.get("end_date") or "99999999")
        if "calendar_dates.txt" in z.namelist():
            for c in _read(z, "calendar_dates.txt"):
                try:
                    st.calendar_dates[(c["service_id"], c["date"])] = int(c["exception_type"])
                except (KeyError, ValueError):
                    pass
        for s in stop_rows:
            routes = sorted((st.routes[r] for r in stop_routes.get(s["stop_id"], ()) if r in st.routes),
                            key=lambda r: (r.route_type != 0, len(r.short_name), r.short_name))
            if not routes:
                continue
            try:
                lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
            except (KeyError, ValueError):
                continue
            lines, seen = [], set()
            for r in routes:
                if r.short_name in seen:
                    continue
                seen.add(r.short_name)
                lines.append(StopLine(line=r.short_name, color=f"#{r.color}", text_color=f"#{r.text_color}",
                                      mode="tram" if r.route_type == 0 else "bus"))
            st.transit_stops.append(TransitStop(
                id=s["stop_id"], name=s.get("stop_name") or s["stop_id"], lat=round(lat, 6), lon=round(lon, 6),
                mode="tram" if any(l.mode == "tram" for l in lines) else "bus", lines=lines,
                wheelchair=(s.get("wheelchair_boarding") or "").strip() == "1"))

        wanted = {sid for ids in route_shape_ids.values() for sid in ids}
        wanted |= {sid for ids in tram_shape_ids.values() for sid in ids}
        points: dict[str, list[tuple[int, float, float]]] = {}
        if "shapes.txt" in z.namelist():
            for p in _read(z, "shapes.txt"):
                if p["shape_id"] in wanted:
                    points.setdefault(p["shape_id"], []).append(
                        (int(p["shape_pt_sequence"]), float(p["shape_pt_lon"]), float(p["shape_pt_lat"])))
        for line, ids in sorted(tram_shape_ids.items()):
            # On garde le tracé le plus long par ligne (trajet complet)
            best = max((points.get(i, []) for i in ids), key=len, default=[])
            if best:
                best.sort()
                color = next((r.color for r in st.routes.values() if r.short_name == line), "AB0672")
                st.tram_shapes.append(LineShape(line=line, color=f"#{color}",
                                                coordinates=[[lon, lat] for _, lon, lat in best]))
        for (route_id, direction), ids in sorted(route_shape_ids.items()):
            # Tracé le plus long de chaque sens (parcours complet de la ligne)
            best = max((points.get(i, []) for i in ids), key=len, default=[])
            if len(best) < 2:
                continue
            route = st.routes[route_id]
            st.line_shapes.append(LineShape(
                line=route.short_name, color=f"#{route.color}", route_id=route_id, direction=direction,
                mode="tram" if route.route_type == 0 else "bus",
                coordinates=[[round(lon, 5), round(lat, 5)] for _, lon, lat in sorted(best)]))
    st.loaded = True
    return st


async def load(force: bool = False) -> GtfsStatic:
    """Charge le GTFS (cache disque si récent, sinon téléchargement)."""
    global STATE
    settings = get_settings()
    path = settings.data_dir / "divia_gtfs.zip"
    async with _lock:
        if STATE.loaded and not force:
            return STATE
        data: bytes | None = None
        status, message = "live", None
        fresh = path.exists() and time.time() - path.stat().st_mtime < MAX_AGE
        if not fresh:
            try:
                with registry.timer() as t:
                    resp = await client().get(settings.divia_gtfs_static_url, timeout=60)
                    resp.raise_for_status()
                data = resp.content
                path.write_bytes(data)
                log.info("GTFS Divia téléchargé (%d Ko, %d ms)", len(data) // 1024, t.ms)
            except Exception as exc:  # noqa: BLE001
                log.warning("Téléchargement GTFS Divia impossible : %s", exc)
                message = f"Téléchargement impossible : {exc.__class__.__name__}"
        if data is None and path.exists():
            data = path.read_bytes()
            if message:
                message += " — cache disque utilisé"
        if data is None:
            registry.record("divia_static", "error", message or "Aucune donnée", endpoint=settings.divia_gtfs_static_url)
            return STATE
        try:
            STATE = await asyncio.to_thread(parse_zip, data)
            registry.record("divia_static", status, message or
                            f"{len(STATE.routes)} lignes, {len(STATE.trips)} courses, {len(STATE.stops)} arrêts",
                            endpoint="transport.data.gouv.fr (cache 24 h)")
        except Exception as exc:  # noqa: BLE001
            log.exception("GTFS Divia illisible")
            registry.record("divia_static", "error", f"GTFS illisible : {exc}")
        return STATE


def active_services(day) -> set[str]:
    """Services Divia qui circulent à la date donnée (calendar + calendar_dates)."""
    ymd = day.strftime("%Y%m%d")
    out = {sid for sid, (week, start, end) in STATE.calendar.items() if start <= ymd <= end and week[day.weekday()]}
    for (sid, d), kind in STATE.calendar_dates.items():
        if d == ymd:
            (out.add if kind == 1 else out.discard)(sid)
    return out


def transit_stops() -> list[TransitStop]:
    return STATE.transit_stops


def all_shapes() -> list[LineShape]:
    """Tracés de toutes les lignes (tram + bus) ; à défaut, tracés de tram approximatifs."""
    return STATE.line_shapes or tram_shapes()


def tram_shapes() -> list[LineShape]:
    if STATE.tram_shapes:
        return STATE.tram_shapes
    return [LineShape(line=k, color="#AB0672", coordinates=v) for k, v in TRAM_FALLBACK_SHAPES.items()]
