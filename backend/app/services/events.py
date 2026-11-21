"""Agenda culturel et sportif : OpenAgenda si clé + agenda configurés, sinon données locales structurées."""
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.cache import cached
from app.config import get_settings
from app.fallback.data import EVENTS, VENUE_POSITIONS
from app.models import Event, SourceMeta, Venue
from app.services import registry, venues_programme
from app.services.http import client

log = logging.getLogger(__name__)
PARIS = ZoneInfo("Europe/Paris")

KEYWORDS = {
    "concert": ["concert", "musique", "festival", "dj", "jazz", "rock", "rap"],
    "sport": ["sport", "match", "dfco", "jda", "football", "basket", "handball", "course"],
    "expo": ["expo", "exposition", "musée", "visite", "patrimoine"],
    "spectacle": ["spectacle", "théâtre", "theatre", "danse", "opéra", "opera", "cirque", "humour"],
    "famille": ["enfant", "famille", "jeune public", "atelier"],
}


def categorize(*texts: str) -> str:
    blob = " ".join(t.lower() for t in texts if t)
    for cat, words in KEYWORDS.items():
        if any(w in blob for w in words):
            return cat
    return "autre"


def _fr(v) -> str:
    if isinstance(v, dict):
        return v.get("fr") or next(iter(v.values()), "") or ""
    return v or ""


def _slug(name: str) -> str:
    import re
    import unicodedata
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _venue_row(venue: str):
    v = (venue or "").lower()
    return next((p for p in VENUE_POSITIONS if p[0] in v), None)


def venue_position(venue: str) -> tuple[float, float] | None:
    """Position d'un lieu connu d'après son nom (table VENUE_POSITIONS)."""
    hit = _venue_row(venue)
    return (hit[2], hit[3]) if hit else None


def _with_position(ev: Event) -> Event:
    hit = _venue_row(ev.venue)
    if hit:
        ev.venue_id = _slug(hit[1])
    if (ev.lat is None or ev.lon is None) and hit:
        ev.lat, ev.lon, ev.location_approx = hit[2], hit[3], True
    return ev


def known_venues(event_list: list[Event] = ()) -> list[Venue]:
    """Salles connues (une par nom), avec le nombre d'événements à venir dans l'agenda."""
    counts: dict[str, int] = {}
    for ev in event_list:
        if ev.venue_id:
            counts[ev.venue_id] = counts.get(ev.venue_id, 0) + 1
    out: dict[str, Venue] = {}
    for _, name, lat, lon, kind, short in VENUE_POSITIONS:
        vid = _slug(name)
        out.setdefault(vid, Venue(id=vid, name=name, short=short, kind=kind, lat=lat, lon=lon, upcoming=counts.get(vid, 0)))
    return list(out.values())


def simulated_events() -> list[Event]:
    today = datetime.now(PARIS).replace(second=0, microsecond=0)
    out = []
    for i, (days, hhmm, title, cat, venue, price) in enumerate(EVENTS):
        h, m = map(int, hhmm.split(":"))
        start = (today + timedelta(days=days)).replace(hour=h, minute=m)
        out.append(_with_position(Event(id=f"demo-{i}", title=title, category=cat, venue=venue, start=start, price=price)))
    return out


async def _fetch_openagenda(key: str, uid: str) -> list[Event]:
    url = f"https://api.openagenda.com/v2/agendas/{uid}/events"
    params = {"key": key, "relative[]": ["current", "upcoming"], "size": 100, "detailed": 1,
              "sort": "timingsWithFeatured.asc", "monolingual": "fr"}
    resp = await client().get(url, params=params)
    resp.raise_for_status()
    out = []
    for e in resp.json().get("events", []):
        timing = (e.get("nextTiming") or (e.get("timings") or [{}])[0]) or {}
        if not timing.get("begin"):
            continue
        title = _fr(e.get("title"))
        kw = e.get("keywords") or []
        if isinstance(kw, dict):  # {"fr": [...]} en mode multilingue
            kw = kw.get("fr") or next(iter(kw.values()), [])
        kw_text = " ".join(kw) if isinstance(kw, list) else str(kw)
        img = e.get("image") or {}
        loc = e.get("location") or {}
        try:
            lat, lon = float(loc["latitude"]), float(loc["longitude"])
        except (KeyError, TypeError, ValueError):
            lat = lon = None
        out.append(_with_position(Event(
            id=str(e.get("uid")), title=title, category=categorize(title, _fr(e.get("description")), kw_text),
            venue=(e.get("location") or {}).get("name") or "Dijon", start=datetime.fromisoformat(timing["begin"]),
            price=_fr(e.get("conditions")) or None, link=e.get("canonicalUrl") or e.get("onlineAccessLink"),
            image=(img.get("base", "") + img.get("filename", "")) if img.get("filename") else None,
            lat=lat, lon=lon, address=loc.get("address"))))
    return out


@cached(ttl=1800)
async def get_events() -> tuple[SourceMeta, list[Event]]:
    meta, base = await _base_events()
    # Programmation réelle de La Vapeur, du Zénith et du stade : elle remplace, pour ces salles,
    # les événements de l'agenda général (démo ou OpenAgenda) afin d'éviter les doublons.
    if get_settings().force_demo:
        return meta, base
    try:
        real, covered = await venues_programme.get_programme()
    except Exception as exc:  # noqa: BLE001
        log.warning("Programmation des salles indisponible : %s", exc)
        return meta, base
    merged = [e for e in base if e.venue_id not in covered] + real
    merged.sort(key=lambda e: e.start)
    return meta, merged


async def _base_events() -> tuple[SourceMeta, list[Event]]:
    s = get_settings()
    if not (s.openagenda_key and s.openagenda_agenda_uid) or s.force_demo:
        msg = "Mode démo forcé" if s.force_demo else "Clé OpenAgenda absente — agenda local"
        return registry.record("events", "simulated", msg, endpoint="api.openagenda.com/v2"), simulated_events()
    try:
        with registry.timer() as t:
            events = await _fetch_openagenda(s.openagenda_key, s.openagenda_agenda_uid)
        return registry.record("events", "live", f"{len(events)} événements", t.ms, "api.openagenda.com/v2"), events
    except Exception as exc:  # noqa: BLE001
        log.warning("OpenAgenda indisponible : %s", exc)
        return registry.record("events", "simulated", f"API indisponible ({exc.__class__.__name__})",
                               endpoint="api.openagenda.com/v2"), simulated_events()
