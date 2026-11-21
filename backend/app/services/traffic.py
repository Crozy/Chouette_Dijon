"""Circulation routière.

- Avec TOMTOM_API_KEY : tuiles « Traffic Flow » TomTom en temps réel, servies via le backend
  (la clé ne quitte jamais le serveur).
- Sans clé : estimation selon l'heure et le jour (pointes du matin et du soir), appliquée côté carte
  aux grands axes du fond de plan. Ce n'est PAS une mesure : la source est marquée « simulée ».
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.cache import cached
from app.config import get_settings
from app.models import SourceMeta, TrafficInfo
from app.services import registry
from app.services.http import client

log = logging.getLogger(__name__)
PARIS = ZoneInfo("Europe/Paris")
TOMTOM_TILE = "https://api.tomtom.com/traffic/map/4/tile/flow/{style}/{z}/{x}/{y}.png"


def congestion_level(now: datetime) -> float:
    """Niveau de congestion estimé (0 = fluide, 1 = très chargé) pour Dijon, selon l'heure."""
    h = now.hour + now.minute / 60
    wd = now.weekday()

    def bump(center: float, width: float, height: float) -> float:
        return height * max(0.0, 1 - abs(h - center) / width)

    if wd < 5:  # semaine : pointes 7 h 45 et 17 h 30, léger pic le midi
        level = 0.12 + bump(7.9, 1.6, 0.75) + bump(12.4, 1.3, 0.3) + bump(17.6, 2.0, 0.8)
        if wd == 4:  # vendredi soir plus chargé
            level += bump(16.8, 2.0, 0.12)
    elif wd == 5:  # samedi : commerces, après-midi
        level = 0.1 + bump(11.0, 2.5, 0.35) + bump(16.0, 3.0, 0.45)
    else:  # dimanche
        level = 0.06 + bump(17.5, 3.0, 0.2)
    if h < 5.5 or h > 22:
        level = min(level, 0.08)
    return round(min(1.0, level), 3)


def _label(level: float) -> str:
    if level < 0.3:
        return "Fluide"
    if level < 0.55:
        return "Chargé par endroits"
    if level < 0.8:
        return "Dense"
    return "Très dense"


@cached(ttl=60)
async def get_traffic() -> tuple[SourceMeta, TrafficInfo]:
    s = get_settings()
    now = datetime.now(PARIS)
    level = congestion_level(now)
    if s.tomtom_api_key and not s.force_demo:
        meta = registry.record("traffic", "live", "TomTom Traffic Flow (tuiles temps réel)", endpoint="api.tomtom.com/traffic")
        return meta, TrafficInfo(mode="live", level=level, label=_label(level), tiles="/api/transports/traffic/tiles/{z}/{x}/{y}.png")
    msg = "Mode démo forcé" if s.force_demo else "TOMTOM_API_KEY absente — circulation estimée selon l'heure"
    meta = registry.record("traffic", "simulated", msg, endpoint="estimation horaire")
    return meta, TrafficInfo(mode="estimated", level=level, label=_label(level))


async def fetch_tile(z: int, x: int, y: int, dark: bool) -> bytes | None:
    s = get_settings()
    if not s.tomtom_api_key:
        return None
    return await _tile(z, x, y, "relative0-dark" if dark else "relative0")


async def _tile(z: int, x: int, y: int, style: str) -> bytes | None:
    s = get_settings()
    try:
        resp = await client().get(TOMTOM_TILE.format(style=style, z=z, x=x, y=y),
                                  params={"key": s.tomtom_api_key, "tileSize": 256})
        resp.raise_for_status()
        return resp.content
    except Exception as exc:  # noqa: BLE001
        log.warning("Tuile TomTom indisponible (%s/%s/%s) : %s", z, x, y, exc.__class__.__name__)
        registry.record("traffic", "error", f"TomTom indisponible ({exc.__class__.__name__})", endpoint="api.tomtom.com/traffic")
        return None
