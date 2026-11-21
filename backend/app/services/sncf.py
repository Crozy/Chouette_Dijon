"""Trains en gare de Dijon-Ville : API SNCF (Navitia) si SNCF_API_KEY, sinon horaires simulés."""
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from app.cache import cached
from app.config import get_settings
from app.fallback.data import TRAIN_ROUTES, TRAIN_TEMPLATES
from app.models import BoardEntry, Journey, JourneyStop, SourceMeta
from app.services import registry
from app.services.http import client

log = logging.getLogger(__name__)
PARIS = ZoneInfo("Europe/Paris")
Direction = Literal["departures", "arrivals"]


def _h(*parts) -> int:
    return int(hashlib.md5("-".join(map(str, parts)).encode()).hexdigest(), 16)


def status_for(delay: int, minutes_away: float, cancelled: bool = False) -> tuple[str, str]:
    if cancelled:
        return "cancelled", "Supprimé"
    if delay > 0:
        return "delayed", f"+{delay} min"
    if 0 <= minutes_away <= 8:
        return "boarding", "Embarquement"
    return "on_time", "À l'heure"


def simulated_trains(direction: Direction, now: datetime | None = None, horizon_h: int = 4) -> list[BoardEntry]:
    now = now or datetime.now(PARIS)
    start = now.replace(second=0, microsecond=0) - timedelta(minutes=5)
    end = now + timedelta(hours=horizon_h)
    out: list[BoardEntry] = []
    for idx, (op, num, dest, via, origin, platform, minute, period) in enumerate(TRAIN_TEMPLATES):
        base = start.replace(minute=0) + timedelta(minutes=minute + (5 if direction == "arrivals" else 0))
        # aligne sur la période
        while base < start:
            base += timedelta(minutes=period)
        k = 0
        while base <= end:
            seed = _h(op, num, base.date(), base.hour, direction)
            delay = [0, 0, 0, 0, 0, 5, 10, 0, 15, 0][seed % 10]
            cancelled = seed % 37 == 0
            t = base + timedelta(minutes=delay)
            st, label = status_for(delay, (t - now).total_seconds() / 60, cancelled)
            if direction == "arrivals" and st == "boarding":
                st, label = "on_time", "À l'heure"
            number = str(num + (base.hour * 2 if num < 10000 else base.hour * 10) + (1 if direction == "arrivals" else 0))
            out.append(BoardEntry(
                id=f"train-{direction}-{idx}-{base:%H%M}", mode="train", operator=op, number=f"N° {number}",
                time=t, base_time=base, delay_min=delay,
                place=dest if direction == "departures" else origin, via=via, platform=platform,
                status=st, status_label=label, source_status="simulated",
                journey_id=f"sim:{direction}:{idx}:{base:%Y%m%dT%H%M}"))
            base += timedelta(minutes=period)
            k += 1
    return out


def _parse_navitia_dt(s: str) -> datetime:
    return datetime.strptime(s, "%Y%m%dT%H%M%S").replace(tzinfo=PARIS)


async def _fetch_navitia(direction: Direction) -> list[BoardEntry]:
    s = get_settings()
    url = f"https://api.sncf.com/v1/coverage/sncf/stop_areas/{s.sncf_stop_area}/{direction}"
    resp = await client().get(url, params={"count": 30, "data_freshness": "realtime"}, auth=(s.sncf_api_key, ""))
    resp.raise_for_status()
    payload = resp.json()
    now = datetime.now(PARIS)
    out = []
    for i, d in enumerate(payload.get(direction, [])):
        info = d.get("display_informations", {})
        sdt = d.get("stop_date_time", {})
        key = "departure_date_time" if direction == "departures" else "arrival_date_time"
        t = _parse_navitia_dt(sdt[key])
        base = _parse_navitia_dt(sdt.get(f"base_{key}", sdt[key]))
        delay = max(0, int((t - base).total_seconds() // 60))
        cancelled = sdt.get("data_freshness") == "realtime" and any(
            "cancel" in (st.get("effect") or "").lower() for st in info.get("links", []) if isinstance(st, dict))
        st, label = status_for(delay, (t - now).total_seconds() / 60, cancelled)
        mode = info.get("commercial_mode") or info.get("network") or "Train"
        place = info.get("direction") or info.get("headsign") or "?"
        place = place.split("(")[0].strip()
        vj = next((l.get("id") for l in d.get("links", []) if isinstance(l, dict) and l.get("type") == "vehicle_journey"), None)
        out.append(BoardEntry(
            journey_id=vj,
            id=f"sncf-{direction}-{i}-{info.get('headsign', '')}", mode="train", operator=mode,
            number=f"N° {info.get('headsign', '')}", time=t, base_time=base, delay_min=delay, place=place,
            via=info.get("name") if info.get("name") != mode else None, platform=None,
            status=st, status_label=label, source_status="live"))
    return out


@cached(ttl=60)
async def get_trains(direction: Direction) -> tuple[SourceMeta, list[BoardEntry]]:
    s = get_settings()
    if not s.sncf_api_key or s.force_demo:
        msg = "Mode démo forcé" if s.force_demo else "SNCF_API_KEY absente — horaires simulés"
        return registry.record("sncf", "simulated", msg, endpoint="api.sncf.com/v1/coverage/sncf"), simulated_trains(direction)
    try:
        with registry.timer() as t:
            entries = await _fetch_navitia(direction)
        return registry.record("sncf", "live", f"{len(entries)} trains", t.ms, "api.sncf.com/v1/coverage/sncf"), entries
    except Exception as exc:  # noqa: BLE001
        log.warning("API SNCF indisponible : %s", exc)
        return registry.record("sncf", "simulated", f"API indisponible ({exc.__class__.__name__})",
                               endpoint="api.sncf.com/v1/coverage/sncf"), simulated_trains(direction)


# ---------------------------------------------------------------------------
# Parcours d'un train (arrêts desservis et à venir)

DWELL = 3  # minutes d'arrêt en gare de Dijon pour un train traversant


def _with_states(stops: list[JourneyStop], now: datetime) -> list[JourneyStop]:
    """Arrêts passés / en cours / à venir selon l'heure (retard inclus)."""
    for s in stops:
        leave = s.departure or s.arrival
        arrive = s.arrival or s.departure
        if leave and leave <= now:
            s.state = "passed"
        elif arrive and arrive <= now < (leave or arrive):
            s.state = "current"
        else:
            s.state = "upcoming"
    return stops


def simulated_journey(journey_id: str, now: datetime | None = None) -> Journey | None:
    """Parcours d'un train de démonstration à partir de son identifiant « sim:<sens>:<idx>:<AAAAMMJJTHHMM> »."""
    now = now or datetime.now(PARIS)
    try:
        _, direction, idx_s, stamp = journey_id.split(":", 3)
        idx = int(idx_s)
        base = datetime.strptime(stamp, "%Y%m%dT%H%M").replace(tzinfo=PARIS)
        op, num, dest, via, origin, platform, _minute, _period = TRAIN_TEMPLATES[idx]
        route = TRAIN_ROUTES[idx]
    except (ValueError, IndexError):
        return None
    if direction not in ("departures", "arrivals"):
        return None
    through = route[0][1] < 0
    if direction == "arrivals" and not through:
        route = [(name, -m) for name, m in reversed(route)]  # train qui termine à Dijon
    # Même tirage que le tableau : retard et suppression identiques
    seed = _h(op, num, base.date(), base.hour, direction)
    delay = [0, 0, 0, 0, 0, 5, 10, 0, 15, 0][seed % 10]
    cancelled = seed % 37 == 0
    number = str(num + (base.hour * 2 if num < 10000 else base.hour * 10) + (1 if direction == "arrivals" else 0))
    # Heure de référence à Dijon : départ (tableau des départs) ou arrivée (tableau des arrivées)
    dijon_arr = base - timedelta(minutes=DWELL) if direction == "departures" else base
    dijon_dep = base if direction == "departures" else base + timedelta(minutes=DWELL)
    stops: list[JourneyStop] = []
    for i, (name, minutes) in enumerate(route):
        first, last = i == 0, i == len(route) - 1
        here = name == "Dijon-Ville"
        if here:
            b_arr, b_dep = (None if first else dijon_arr), (None if last else dijon_dep)
        else:
            ref = dijon_arr if minutes < 0 else dijon_dep
            t = ref + timedelta(minutes=minutes)
            b_arr, b_dep = (None if first else t - timedelta(minutes=1 if not last else 0)), (None if last else t)
        shift = timedelta(minutes=delay)
        stops.append(JourneyStop(
            name=name, base_arrival=b_arr, base_departure=b_dep,
            arrival=b_arr + shift if b_arr else None, departure=b_dep + shift if b_dep else None,
            delay_min=delay, platform=platform if here else None, is_here=here))
    return Journey(
        id=journey_id, operator=op, number=f"N° {number}", origin=route[0][0], destination=route[-1][0],
        cancelled=cancelled, delay_min=delay, source_status="simulated", stops=_with_states(stops, now))


def _hms(s: str) -> timedelta:
    return timedelta(hours=int(s[0:2]), minutes=int(s[2:4]), seconds=int(s[4:6]))


async def _fetch_navitia_journey(journey_id: str, ref: datetime, delay: int) -> Journey:
    """Parcours réel (API SNCF) : horaires théoriques, recalés sur la date du passage à Dijon."""
    s = get_settings()
    url = f"https://api.sncf.com/v1/coverage/sncf/vehicle_journeys/{journey_id}"
    resp = await client().get(url, auth=(s.sncf_api_key, ""))
    resp.raise_for_status()
    vj = resp.json()["vehicle_journeys"][0]
    raw = vj.get("stop_times", [])
    # Horaires « HHMMSS » sans date : on reconstruit une suite croissante (passage de minuit)
    offsets: list[tuple[timedelta | None, timedelta | None]] = []
    day = timedelta(0)
    last = timedelta(-1)
    for st in raw:
        pair = []
        for key in ("arrival_time", "departure_time"):
            v = st.get(key)
            if not v:
                pair.append(None)
                continue
            t = _hms(v) + day
            if t < last:
                day += timedelta(days=1)
                t += timedelta(days=1)
            last = t
            pair.append(t)
        offsets.append((pair[0], pair[1]))
    names = [(st.get("stop_point") or {}).get("name") or "?" for st in raw]
    here_i = next((i for i, n in enumerate(names) if "dijon" in n.lower() and "ville" in n.lower()),
                  next((i for i, n in enumerate(names) if "dijon" in n.lower()), 0))
    # Recale : l'heure de Dijon (départ, sinon arrivée) correspond à la référence du tableau
    h_arr, h_dep = offsets[here_i] if offsets else (None, None)
    anchor = h_dep or h_arr or timedelta(0)
    midnight = ref.replace(hour=0, minute=0, second=0, microsecond=0)
    if midnight + anchor - ref > timedelta(hours=12):
        midnight -= timedelta(days=1)
    elif ref - (midnight + anchor) > timedelta(hours=12):
        midnight += timedelta(days=1)
    shift = timedelta(minutes=delay)
    stops = []
    for i, (name, (a, d)) in enumerate(zip(names, offsets)):
        first, lastp = i == 0, i == len(names) - 1
        b_arr = None if first or a is None else midnight + a
        b_dep = None if lastp or d is None else midnight + d
        stops.append(JourneyStop(
            name=name, base_arrival=b_arr, base_departure=b_dep,
            arrival=b_arr + shift if b_arr else None, departure=b_dep + shift if b_dep else None,
            delay_min=delay, is_here=i == here_i))
    headsign = vj.get("headsign") or vj.get("name") or ""
    return Journey(id=journey_id, operator=((vj.get("journey_pattern") or {}).get("name") or "Train").split(" ")[0],
                   number=f"N° {headsign}" if headsign else None, origin=names[0] if names else "?",
                   destination=names[-1] if names else "?", delay_min=delay, source_status="live",
                   stops=_with_states(stops, datetime.now(PARIS)))


@cached(ttl=60)
async def get_journey(journey_id: str, ref: datetime | None = None, delay: int = 0) -> Journey | None:
    if journey_id.startswith("sim:"):
        return simulated_journey(journey_id)
    if journey_id.startswith("gtfs:"):
        from app.services import coach_gtfs
        return coach_gtfs.journey(journey_id)
    if journey_id.startswith("coach:"):
        from app.services.coach import simulated_journey as coach_journey
        return coach_journey(journey_id)
    s = get_settings()
    if not s.sncf_api_key:
        return None
    try:
        return await _fetch_navitia_journey(journey_id, ref or datetime.now(PARIS), delay)
    except Exception as exc:  # noqa: BLE001
        log.warning("Parcours SNCF indisponible (%s) : %s", journey_id, exc)
        return None
