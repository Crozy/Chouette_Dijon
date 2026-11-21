"""Gare routière (FlixBus, BlaBlaCar Bus) et covoiturage BlaBlaCar.

Cars : horaires théoriques officiels (GTFS open data, voir coach_gtfs) dès qu'ils sont chargés,
sinon horaires-types simulés. Covoiturage : pas de données publiques, toujours simulé.
"""
from datetime import datetime, timedelta

from app.cache import cached
from app.config import get_settings
from app.fallback.data import COACH_ROUTES, COACH_TEMPLATES, MEETING_POINTS
from app.models import BoardEntry, Journey, JourneyStop, MeetingPoint, SourceMeta
from app.services import registry
from app.services.sncf import PARIS, Direction, _h, _with_states, status_for


def coach_entries(direction: Direction, now: datetime | None = None, horizon_h: int = 5) -> list[BoardEntry]:
    now = now or datetime.now(PARIS)
    start = now.replace(second=0, microsecond=0) - timedelta(minutes=5)
    end = now + timedelta(hours=horizon_h)
    out = []
    for idx, (op, num, dest, via, origin, quai, minute, period, mode) in enumerate(COACH_TEMPLATES):
        base = start.replace(minute=0) + timedelta(minutes=minute)
        while base < start:
            base += timedelta(minutes=period)
        while base <= end:
            delay = [0, 0, 0, 10, 0, 5][_h(op, num, base.hour, direction) % 6]
            t = base + timedelta(minutes=delay)
            st, label = status_for(delay, (t - now).total_seconds() / 60)
            if direction == "arrivals" and st == "boarding":
                st, label = "on_time", "À l'heure"
            out.append(BoardEntry(
                id=f"coach-{direction}-{idx}-{base:%H%M}", mode=mode, operator=op, number=num, time=t, base_time=base,
                delay_min=delay, place=dest if direction == "departures" else origin, via=via,
                platform=quai if quai.startswith("Q") else "—", status=st, status_label=label,
                source_status="simulated",
                journey_id=f"coach:{direction}:{idx}:{base:%Y%m%dT%H%M}" if COACH_ROUTES[idx] else None))
            base += timedelta(minutes=period)
    return out


COACH_DWELL = 10  # minutes d'arrêt à la gare routière de Dijon


def simulated_journey(journey_id: str, now: datetime | None = None) -> Journey | None:
    """Parcours d'un car à partir de « coach:<sens>:<idx>:<AAAAMMJJTHHMM> »."""
    now = now or datetime.now(PARIS)
    try:
        _, direction, idx_s, stamp = journey_id.split(":", 3)
        idx = int(idx_s)
        base = datetime.strptime(stamp, "%Y%m%dT%H%M").replace(tzinfo=PARIS)
        op, num, _dest, _via, _origin, quai, _m, _p, _mode = COACH_TEMPLATES[idx]
        route = COACH_ROUTES[idx]
    except (ValueError, IndexError):
        return None
    if not route or direction not in ("departures", "arrivals"):
        return None
    delay = [0, 0, 0, 10, 0, 5][_h(op, num, base.hour, direction) % 6]  # même tirage que le tableau
    shift = timedelta(minutes=delay)
    here_arr = base - timedelta(minutes=COACH_DWELL) if direction == "departures" else base
    here_dep = base if direction == "departures" else base + timedelta(minutes=COACH_DWELL)
    stops = []
    for i, (name, minutes) in enumerate(route):
        first, last = i == 0, i == len(route) - 1
        here = minutes == 0
        if here:
            b_arr, b_dep = here_arr, here_dep
        else:
            t = (here_arr if minutes < 0 else here_dep) + timedelta(minutes=minutes)
            b_arr, b_dep = (None if first else t - timedelta(minutes=5)), (None if last else t)
        stops.append(JourneyStop(
            name=name, base_arrival=b_arr, base_departure=b_dep,
            arrival=b_arr + shift if b_arr else None, departure=b_dep + shift if b_dep else None,
            delay_min=delay, platform=quai if here else None, is_here=here))
    return Journey(id=journey_id, operator=op, number=num, origin=route[0][0], destination=route[-1][0],
                   delay_min=delay, source_status="simulated", stops=_with_states(stops, now))


@cached(ttl=60)
async def get_coaches(direction: Direction) -> tuple[SourceMeta, list[BoardEntry]]:
    from app.services import coach_gtfs
    if coach_gtfs.loaded() and not get_settings().force_demo:
        carpool = [e for e in coach_entries(direction) if e.operator == "Covoiturage"]
        coach_gtfs.record_status()
        return registry.get("coach"), sorted(coach_gtfs.entries(direction) + carpool, key=lambda e: e.time)
    meta = registry.record("coach", "simulated", "Horaires officiels pas encore chargés — horaires-types locaux",
                           endpoint="données structurées locales")
    return meta, coach_entries(direction)


def meeting_points() -> list[MeetingPoint]:
    return [MeetingPoint(id=i, kind=k, name=n, lat=la, lon=lo, description=d) for i, k, n, la, lo, d in MEETING_POINTS]
