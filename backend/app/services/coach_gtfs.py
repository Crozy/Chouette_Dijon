"""Horaires théoriques officiels des cars FlixBus et BlaBlaCar Bus (GTFS open data, licence ODbL).

Sources : transport.data.gouv.fr — « Réseau européen FlixBus et FlixTrain » et « Réseau européen
BlaBlaCar Bus ». Les fichiers sont téléchargés au démarrage et mis en cache disque 24 h. On ne garde
que les courses qui desservent Dijon, avec leur parcours complet.

Ce sont les horaires PRÉVUS par les opérateurs (pas du temps réel) : statut « scheduled ».
"""
import asyncio
import csv
import io
import logging
import math
import time
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app.config import get_settings
from app.models import BoardEntry, Journey, JourneyStop
from app.services import registry
from app.services.http import client
from app.services.sncf import PARIS, Direction, _with_states

log = logging.getLogger(__name__)
MAX_AGE = 24 * 3600
DIJON = (47.322, 5.0415)


@dataclass
class CoachTrip:
    feed: str
    trip_id: str
    operator: str
    mode: str  # "flixbus" | "blablacar"
    number: str
    service_id: str
    stops: list[tuple[str, int | None, int | None]]  # (nom, arrivée s, départ s) depuis minuit du jour de service
    dijon: list[int]  # index des arrêts dijonnais dans `stops`


@dataclass
class Feed:
    trips: list[CoachTrip] = field(default_factory=list)
    calendar: dict[str, tuple[tuple[bool, ...], str, str]] = field(default_factory=dict)
    calendar_dates: dict[tuple[str, str], int] = field(default_factory=dict)

    def active(self, day: date) -> set[str]:
        ymd = day.strftime("%Y%m%d")
        out = {sid for sid, (week, start, end) in self.calendar.items() if start <= ymd <= end and week[day.weekday()]}
        for (sid, d), kind in self.calendar_dates.items():
            if d == ymd:
                (out.add if kind == 1 else out.discard)(sid)
        return out


FEEDS: dict[str, Feed] = {}
_lock = asyncio.Lock()


def _secs(v: str) -> int | None:
    try:
        h, m, s = v.strip().split(":")
        return int(h) * 3600 + int(m) * 60 + int(s)
    except ValueError:
        return None


def _km(lat: float, lon: float) -> float:
    dy = (lat - DIJON[0]) * 111
    dx = (lon - DIJON[1]) * 111 * math.cos(math.radians(DIJON[0]))
    return math.hypot(dx, dy)


def _rows(z: zipfile.ZipFile, name: str):
    with z.open(name) as f:
        reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        header = [h.strip() for h in next(reader)]
        yield header
        yield from reader


def _dicts(z: zipfile.ZipFile, name: str):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def parse_feed(data: bytes, feed: str) -> Feed:
    out = Feed()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names: dict[str, str] = {}
        dijon_ids: set[str] = set()
        for s in _dicts(z, "stops.txt"):
            names[s["stop_id"]] = (s.get("stop_name") or s["stop_id"]).strip()
            try:
                near = _km(float(s["stop_lat"]), float(s["stop_lon"])) < 15
            except (KeyError, ValueError):
                near = False
            if near and "dijon" in names[s["stop_id"]].lower():
                dijon_ids.add(s["stop_id"])
        if not dijon_ids:
            return out

        # 1er passage : courses qui desservent Dijon ; 2e passage : leur parcours complet
        rows = _rows(z, "stop_times.txt")
        h = next(rows)
        i_trip, i_stop, i_seq = h.index("trip_id"), h.index("stop_id"), h.index("stop_sequence")
        i_arr, i_dep = h.index("arrival_time"), h.index("departure_time")
        wanted = {r[i_trip] for r in rows if len(r) > i_stop and r[i_stop] in dijon_ids}
        calls: dict[str, list[tuple[int, str, int | None, int | None]]] = {}
        rows = _rows(z, "stop_times.txt")
        next(rows)
        for r in rows:
            if len(r) > i_dep and r[i_trip] in wanted:
                calls.setdefault(r[i_trip], []).append((int(r[i_seq] or 0), r[i_stop], _secs(r[i_arr]), _secs(r[i_dep])))

        routes = {r["route_id"]: r for r in _dicts(z, "routes.txt")}
        services: set[str] = set()
        for t in _dicts(z, "trips.txt"):
            tid = t["trip_id"]
            if tid not in calls:
                continue
            seq = sorted(calls[tid])
            route = routes.get(t["route_id"], {})
            agency = (route.get("agency_id") or "").lower()
            if feed == "flixbus":
                operator = "FlixTrain" if "train" in agency else "FlixBus"
                line = (route.get("route_short_name") or "").replace("FlixBus", "").replace("FlixTrain", "").strip()
                number = f"Ligne {line}" if line else (t.get("trip_short_name") or "")
            else:
                operator = "BlaBlaCar Bus"
                number = f"N° {t['trip_short_name']}" if t.get("trip_short_name") else ""
            stops = [(names.get(sid, sid), a, d) for _, sid, a, d in seq]
            here = [i for i, (_, sid, _, _) in enumerate(seq) if sid in dijon_ids]
            out.trips.append(CoachTrip(feed=feed, trip_id=tid, operator=operator, mode="blablacar" if feed == "blablacar" else "flixbus",
                                       number=number, service_id=t["service_id"], stops=stops, dijon=here))
            services.add(t["service_id"])

        days = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
        if "calendar.txt" in z.namelist():
            for c in _dicts(z, "calendar.txt"):
                if c["service_id"] in services:
                    out.calendar[c["service_id"]] = (tuple(c.get(d) == "1" for d in days),
                                                     c.get("start_date") or "00000000", c.get("end_date") or "99999999")
        if "calendar_dates.txt" in z.namelist():
            for c in _dicts(z, "calendar_dates.txt"):
                if c["service_id"] in services:
                    try:
                        out.calendar_dates[(c["service_id"], c["date"])] = int(c["exception_type"])
                    except (KeyError, ValueError):
                        pass
    return out


async def _download(feed: str, url: str) -> Feed | None:
    path = get_settings().data_dir / f"{feed}_gtfs.zip"
    data = None
    if not (path.exists() and time.time() - path.stat().st_mtime < MAX_AGE):
        try:
            resp = await client().get(url, timeout=180)
            resp.raise_for_status()
            data = resp.content
            path.write_bytes(data)
            log.info("GTFS %s téléchargé (%d Ko)", feed, len(data) // 1024)
        except Exception as exc:  # noqa: BLE001
            log.warning("Téléchargement GTFS %s impossible : %s", feed, exc)
    if data is None and path.exists():
        data = path.read_bytes()
    if data is None:
        return None
    try:
        return await asyncio.to_thread(parse_feed, data, feed)
    except Exception:  # noqa: BLE001
        log.exception("GTFS %s illisible", feed)
        return None


async def load(force: bool = False) -> dict[str, Feed]:
    s = get_settings()
    async with _lock:
        if FEEDS and not force:
            return FEEDS
        urls = {"flixbus": s.flixbus_gtfs_url, "blablacar": s.blablacar_gtfs_url}
        results = await asyncio.gather(*(_download(k, u) for k, u in urls.items() if u))
        for key, feed in zip([k for k, u in urls.items() if u], results):
            if feed is not None:
                FEEDS[key] = feed
        n = sum(len(f.trips) for f in FEEDS.values())
        log.info("Cars : %d courses desservant Dijon (%s)", n, ", ".join(FEEDS))
        return FEEDS


def loaded() -> bool:
    return any(f.trips for f in FEEDS.values())


def _via(names: list[str]) -> str | None:
    return " · ".join(names[:3]) or None


def entries(direction: Direction, now: datetime | None = None, horizon_h: int = 24) -> list[BoardEntry]:
    """Prochains passages prévus à Dijon (départs ou arrivées)."""
    now = now or datetime.now(PARIS)
    start, end = now - timedelta(minutes=5), now + timedelta(hours=horizon_h)
    out: list[BoardEntry] = []
    for feed in FEEDS.values():
        for day in (now.date() - timedelta(days=1), now.date(), now.date() + timedelta(days=1)):
            active = feed.active(day)
            midnight = datetime(day.year, day.month, day.day, tzinfo=PARIS)
            for trip in feed.trips:
                if trip.service_id not in active:
                    continue
                for i in trip.dijon:
                    name, arr, dep = trip.stops[i]
                    if direction == "departures":
                        if i == len(trip.stops) - 1 or dep is None:
                            continue
                        secs, place = dep, trip.stops[-1][0]
                        via = [s[0] for s in trip.stops[i + 1:-1]]
                    else:
                        if i == 0 or arr is None:
                            continue
                        secs, place = arr, trip.stops[0][0]
                        via = [s[0] for s in reversed(trip.stops[1:i])]
                    t = midnight + timedelta(seconds=secs)
                    if not (start <= t <= end):
                        continue
                    # Arrêt secondaire (ex. FlixBus « Dijon (Université) ») : on le précise, la gare routière est l'arrêt par défaut
                    stop_note = f"Arrêt {name}" if "univ" in name.lower() else None
                    out.append(BoardEntry(
                        id=f"{trip.feed}-{direction}-{trip.trip_id}-{day:%Y%m%d}-{i}", mode=trip.mode, operator=trip.operator,
                        number=trip.number or None, time=t, base_time=t, delay_min=0, place=place,
                        via=" · ".join(filter(None, [stop_note, _via(via)])) or None, platform="—",
                        status="on_time", status_label="Prévu", source_status="scheduled",
                        journey_id=f"gtfs:{trip.feed}:{day:%Y%m%d}:{i}:{trip.trip_id}"))
    out.sort(key=lambda e: e.time)
    return out


def journey(journey_id: str, now: datetime | None = None) -> Journey | None:
    """Parcours d'une course : « gtfs:<flux>:<AAAAMMJJ>:<index Dijon>:<trip_id> »."""
    try:
        _, feed_key, ymd, idx_s, trip_id = journey_id.split(":", 4)
        day = datetime.strptime(ymd, "%Y%m%d").replace(tzinfo=PARIS)
        idx = int(idx_s)
    except ValueError:
        return None
    feed = FEEDS.get(feed_key)
    trip = next((t for t in feed.trips if t.trip_id == trip_id), None) if feed else None
    if not trip or not 0 <= idx < len(trip.stops):
        return None
    stops = []
    for i, (name, arr, dep) in enumerate(trip.stops):
        first, last = i == 0, i == len(trip.stops) - 1
        a = None if first or arr is None else day + timedelta(seconds=arr)
        d = None if last or dep is None else day + timedelta(seconds=dep)
        stops.append(JourneyStop(name=name, arrival=a, departure=d, base_arrival=a, base_departure=d, is_here=i == idx))
    return Journey(id=journey_id, operator=trip.operator, number=trip.number or None, origin=trip.stops[0][0],
                   destination=trip.stops[-1][0], source_status="scheduled",
                   stops=_with_states(stops, now or datetime.now(PARIS)))


def record_status() -> None:
    if loaded():
        n = {k: len(f.trips) for k, f in FEEDS.items()}
        registry.record("coach", "scheduled",
                        f"Horaires théoriques officiels (GTFS) — FlixBus : {n.get('flixbus', 0)} courses, "
                        f"BlaBlaCar Bus : {n.get('blablacar', 0)} courses · covoiturage simulé",
                        endpoint="transport.data.gouv.fr (cache 24 h)")
