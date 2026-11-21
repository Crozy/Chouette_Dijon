"""Registre de l'état des sources de données (affiché dans Paramètres et la barre supérieure)."""
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from app.models import SourceMeta, Status

SOURCES: dict[str, str] = {
    "divia_rt": "Divia GTFS-RT (véhicules)",
    "divia_static": "Divia GTFS statique",
    "velodi": "DiviaVélodi (GBFS)",
    "sncf": "SNCF / Navitia",
    "coach": "FlixBus & BlaBlaCar",
    "weather": "Open-Meteo",
    "air": "Open-Meteo Qualité de l'air",
    "news": "Presse locale (RSS)",
    "social": "Réseaux sociaux",
    "events": "OpenAgenda",
    "alerts": "Alertes trafic",
    "traffic": "Circulation (TomTom)",
    "crowd": "Affluence (estimation)",
    "venues": "Programmation des salles (Vapeur, Zénith, DFCO)",
}

_state: dict[str, SourceMeta] = {}


def now() -> datetime:
    return datetime.now(timezone.utc)


def record(source: str, status: Status, message: str | None = None, latency_ms: int | None = None,
           endpoint: str | None = None) -> SourceMeta:
    meta = SourceMeta(source=source, label=SOURCES.get(source, source), status=status, updated_at=now(),
                      message=message, latency_ms=latency_ms, endpoint=endpoint)
    _state[source] = meta
    return meta


def get(source: str, fallback_status: Status = "simulated", message: str | None = None) -> SourceMeta:
    """État courant d'une source sans l'écraser (l'enregistre s'il n'existe pas encore)."""
    return _state.get(source) or record(source, fallback_status, message)


def all_sources() -> list[SourceMeta]:
    out = []
    for key, label in SOURCES.items():
        out.append(_state.get(key) or SourceMeta(source=key, label=label, status="simulated",
                                                  updated_at=now(), message="Pas encore interrogée"))
    return out


class Timer:
    def __init__(self):
        self.start = time.perf_counter()

    @property
    def ms(self) -> int:
        return int((time.perf_counter() - self.start) * 1000)


@contextmanager
def timer():
    t = Timer()
    yield t
