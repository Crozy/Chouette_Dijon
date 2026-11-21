"""Positions temps réel des bus et trams Divia (GTFS-RT Protobuf)."""
import logging
import math
import time

from google.transit import gtfs_realtime_pb2

from app.cache import cached
from app.config import get_settings
from app.models import SourceMeta, Vehicle
from app.services import gtfs_static, registry
from app.services.http import client

log = logging.getLogger(__name__)

STATUS_LABELS = {0: "En approche", 1: "À l'arrêt", 2: "En route"}


def decode_vehicles(payload: bytes) -> list[Vehicle]:
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(payload)
    st = gtfs_static.STATE
    out: list[Vehicle] = []
    for ent in feed.entity:
        if not ent.HasField("vehicle") or not ent.vehicle.HasField("position"):
            continue
        v = ent.vehicle
        route_id = v.trip.route_id
        trip = st.trips.get(v.trip.trip_id)
        if not route_id and trip:
            route_id = trip[0]
        route = st.routes.get(route_id)
        line = route.short_name if route else (route_id.split("-")[-1] if route_id else "?")
        mode = "tram" if (route and route.route_type == 0) or line.startswith("T") else "bus"
        color = route.color if route else ("AB0672" if mode == "tram" else "005CA9")
        text_color = route.text_color if route else "FFFFFF"
        headsign = trip[1] if trip and trip[1] else None
        if not headsign and route and "<>" in route.long_name:
            a, b = (p.strip() for p in route.long_name.split("<>", 1))
            headsign = b if v.trip.direction_id == 0 else a
        speed = v.position.speed if v.position.HasField("speed") else None
        out.append(Vehicle(
            id=v.vehicle.id or ent.id,
            line=line,
            route_id=route_id or "",
            mode=mode,
            color=f"#{color}",
            text_color=f"#{text_color}",
            lat=v.position.latitude,
            lon=v.position.longitude,
            bearing=v.position.bearing if v.position.HasField("bearing") else None,
            # La spec GTFS-RT prévoit des m/s, mais le flux Divia publie des valeurs déjà en km/h
            speed_kmh=round(speed, 1) if speed is not None else None,
            headsign=headsign,
            next_stop=st.stops.get(v.stop_id) if v.stop_id else None,
            status=STATUS_LABELS.get(v.current_status) if v.HasField("current_status") else None,
            timestamp=v.timestamp or None,
        ))
    return out


def _interp(coords: list[list[float]], f: float) -> tuple[float, float, float]:
    """Position le long d'une polyligne (fraction 0..1) + cap."""
    segs = [(coords[i], coords[i + 1]) for i in range(len(coords) - 1)]
    lengths = [math.dist(a, b) for a, b in segs]
    total = sum(lengths) or 1
    target = f * total
    for (a, b), length in zip(segs, lengths):
        if target <= length:
            r = target / length if length else 0
            lon, lat = a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r
            bearing = (math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) + 360) % 360
            return lon, lat, bearing
        target -= length
    return coords[-1][0], coords[-1][1], 0.0


def simulated_vehicles() -> list[Vehicle]:
    """Trams qui se déplacent le long des tracés + quelques bus, en fonction de l'heure."""
    t = time.time()
    out: list[Vehicle] = []
    for shape in gtfs_static.tram_shapes():
        terminus = gtfs_static.STATE.routes.get(f"4-{shape.line}")
        names = [p.strip() for p in terminus.long_name.split("<>")] if terminus and "<>" in terminus.long_name \
            else ["Terminus A", "Terminus B"]
        for k in range(8):
            phase = ((t / 2400) + k / 8) % 1.0  # aller-retour en 40 min
            forward = phase < 0.5
            f = phase * 2 if forward else (1 - phase) * 2
            lon, lat, bearing = _interp(shape.coordinates, f)
            out.append(Vehicle(id=f"sim-{shape.line}-{k}", line=shape.line, route_id=f"4-{shape.line}", mode="tram",
                               color=shape.color, text_color="#FFFFFF", lat=lat, lon=lon,
                               bearing=bearing if forward else (bearing + 180) % 360,
                               headsign=names[-1] if forward else names[0], status="En route"))
    s = get_settings()
    bus_lines = [("L3", "#EA619F"), ("L4", "#EA619F"), ("L5", "#EA619F"), ("L6", "#EA619F"), ("10", "#005CA9"),
                 ("12", "#005CA9"), ("CO", "#00B1EB"), ("PL", "#2C2276")]
    for i, (line, color) in enumerate(bus_lines):
        route = gtfs_static.STATE.routes.get(f"4-{line}")
        if route:
            color = f"#{route.color}"
        for k in range(3):
            ang = (t / 900 + i * 0.7 + k * 2.1) % (2 * math.pi)
            radius = 0.012 + 0.004 * ((i + k) % 3)
            out.append(Vehicle(id=f"sim-{line}-{k}", line=line, route_id=f"4-{line}", mode="bus", color=color,
                               text_color="#FFFFFF", lat=s.lat + radius * math.sin(ang) * 0.7,
                               lon=s.lon + radius * math.cos(ang), bearing=(math.degrees(ang) + 90) % 360,
                               headsign="Centre", status="En route"))
    return out


@cached(ttl=12)
async def get_vehicles() -> tuple[SourceMeta, list[Vehicle]]:
    s = get_settings()
    if not gtfs_static.STATE.loaded:
        await gtfs_static.load()
    if s.force_demo:
        return registry.record("divia_rt", "simulated", "Mode démo forcé"), simulated_vehicles()
    try:
        with registry.timer() as t:
            resp = await client().get(s.divia_gtfs_rt_vehicles_url)
            resp.raise_for_status()
        vehicles = decode_vehicles(resp.content)
        if not vehicles:
            # Flux vide (nuit, coupure) : on garde le flux comme LIVE mais sans véhicule
            return registry.record("divia_rt", "live", "Aucun véhicule en circulation", t.ms,
                                   s.divia_gtfs_rt_vehicles_url), []
        return registry.record("divia_rt", "live", f"{len(vehicles)} véhicules", t.ms,
                               s.divia_gtfs_rt_vehicles_url), vehicles
    except Exception as exc:  # noqa: BLE001
        log.warning("GTFS-RT Divia indisponible : %s", exc)
        return registry.record("divia_rt", "simulated", f"Flux indisponible ({exc.__class__.__name__})",
                               endpoint=s.divia_gtfs_rt_vehicles_url), simulated_vehicles()
