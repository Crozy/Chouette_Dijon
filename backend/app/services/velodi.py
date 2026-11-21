"""Stations DiviaVélodi : flux GBFS si configuré (VELODI_GBFS_URL), sinon simulation réaliste."""
import hashlib
import logging
import time

from app.cache import cached
from app.config import get_settings
from app.fallback.data import VELODI_STATIONS
from app.models import SourceMeta, VelodiStation
from app.services import registry
from app.services.http import client

log = logging.getLogger(__name__)


def simulated_stations() -> list[VelodiStation]:
    slot = int(time.time() // 300)  # change toutes les 5 minutes
    out = []
    for sid, name, lat, lon, cap in VELODI_STATIONS:
        h = int(hashlib.md5(f"{sid}-{slot}".encode()).hexdigest(), 16)
        bikes = h % (cap + 1)
        if h % 11 == 0:
            bikes = 0
        out.append(VelodiStation(id=sid, name=name, lat=lat, lon=lon, bikes=bikes, docks=cap - bikes, capacity=cap))
    return out


async def _fetch_gbfs(url: str) -> list[VelodiStation]:
    http = client()
    root = (await http.get(url)).raise_for_status().json()
    feeds_by_lang = root.get("data", {})
    feeds = feeds_by_lang.get("fr") or feeds_by_lang.get("en") or next(iter(feeds_by_lang.values()), {})
    if isinstance(feeds, dict):
        feeds = feeds.get("feeds", [])
    urls = {f["name"]: f["url"] for f in feeds}
    info = (await http.get(urls["station_information"])).raise_for_status().json()["data"]["stations"]
    status = (await http.get(urls["station_status"])).raise_for_status().json()["data"]["stations"]
    st_by_id = {s["station_id"]: s for s in status}
    out = []
    for s in info:
        stt = st_by_id.get(s["station_id"], {})
        bikes = int(stt.get("num_bikes_available", stt.get("num_vehicles_available", 0)) or 0)
        docks = int(stt.get("num_docks_available", 0) or 0)
        name = s.get("name")
        if isinstance(name, list):  # GBFS v3 : liste de traductions
            name = name[0].get("text") if name else s["station_id"]
        out.append(VelodiStation(id=str(s["station_id"]), name=name or str(s["station_id"]), lat=s["lat"], lon=s["lon"],
                                 bikes=bikes, docks=docks, capacity=int(s.get("capacity") or bikes + docks),
                                 is_renting=bool(stt.get("is_renting", True))))
    return out


@cached(ttl=60)
async def get_stations() -> tuple[SourceMeta, list[VelodiStation]]:
    s = get_settings()
    if not s.velodi_gbfs_url or s.force_demo:
        msg = "Mode démo forcé" if s.force_demo else "VELODI_GBFS_URL non configurée — disponibilités simulées"
        return registry.record("velodi", "simulated", msg), simulated_stations()
    try:
        with registry.timer() as t:
            stations = await _fetch_gbfs(s.velodi_gbfs_url)
        return registry.record("velodi", "live", f"{len(stations)} stations", t.ms, s.velodi_gbfs_url), stations
    except Exception as exc:  # noqa: BLE001
        log.warning("GBFS Vélodi indisponible : %s", exc)
        return registry.record("velodi", "simulated", f"Flux indisponible ({exc.__class__.__name__})",
                               endpoint=s.velodi_gbfs_url), simulated_stations()
