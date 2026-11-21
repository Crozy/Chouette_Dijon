"""Antennes de téléphonie mobile autour de Dijon.

Deux sources officielles, ouvertes et sans clé :
  - **ANFR – Observatoire 2G/3G/4G/5G** : registre de tous les émetteurs (opérateur, technologie,
    position, hauteur, statut). Mis à jour chaque semaine environ.
  - **Arcep – Sites indisponibles** (New Deal mobile) : antennes en panne ou en maintenance, déclarées
    chaque jour par les opérateurs (avec 1 à 3 jours de décalage).

Il n'existe pas de flux public en temps réel : la donnée la plus fraîche est la liste quotidienne des
pannes. Le n° de station `station_anfr` de l'Arcep correspond au `sta_nm_anfr` de l'ANFR, ce qui permet
de marquer chaque antenne du registre.
"""
import asyncio
import json
import logging
import math
import time
from datetime import datetime

from app.cache import cached
from app.config import get_settings
from app.models import AntennaData, AntennaOperator, AntennaOutage, AntennaStation
from app.services import registry
from app.services.http import client

log = logging.getLogger(__name__)

ANFR_API = "https://data.anfr.fr/d4c/api/records/1.0/search/"
ANFR_FIELDS = ("sta_nm_anfr,adm_lb_nom,generation,emr_lb_systeme,emr_dt,coordonnees,statut,sup_nm_haut,"
               "adr_lb_lieu,adr_lb_add1,adr_nm_cp,com_cd_insee,date_maj")
ARCEP_DATASET = "https://www.data.gouv.fr/api/1/datasets/sites-indisponibles/"
DEPARTEMENT = "021"
CENTER = (47.322, 5.0415)
RADIUS_KM = 15
REGISTRY_MAX_AGE = 24 * 3600

OPERATORS = {"ORANGE": "Orange", "SFR": "SFR", "BOUYGUES TELECOM": "Bouygues Telecom", "FREE MOBILE": "Free"}
STATUS_RANK = {"En service": 0, "Techniquement opérationnel": 1, "Projet approuvé": 2}
_lock = asyncio.Lock()


def km(lat: float, lon: float) -> float:
    dy = (lat - CENTER[0]) * 111
    dx = (lon - CENTER[1]) * 111 * math.cos(math.radians(CENTER[0]))
    return math.hypot(dx, dy)


def operator_name(raw: str | None) -> str:
    raw = (raw or "").strip()
    return OPERATORS.get(raw.upper()) or next((v for k, v in OPERATORS.items() if raw.lower().startswith(v.lower()[:4])), raw or "?")


def group_registry(records: list[dict]) -> tuple[list[AntennaStation], str | None]:
    """Regroupe les émetteurs ANFR par station, dans le rayon autour de Dijon."""
    stations: dict[str, dict] = {}
    registry_date = None
    for f in records:
        sid = f.get("sta_nm_anfr")
        try:
            lat, lon = (float(x) for x in str(f.get("coordonnees", "")).split(","))
        except ValueError:
            continue
        if not sid or km(lat, lon) > RADIUS_KM:
            continue
        registry_date = max(filter(None, [registry_date, (f.get("date_maj") or "")[:10] or None]), default=None)
        st = stations.setdefault(sid, {
            "id": sid, "lat": lat, "lon": lon, "height": None, "ops": {},
            "address": " · ".join(filter(None, [f.get("adr_lb_lieu"), f.get("adr_lb_add1")])) or None,
            "postcode": f.get("adr_nm_cp"), "insee": f.get("com_cd_insee"),
        })
        try:
            st["height"] = float(str(f.get("sup_nm_haut") or "").replace(",", "."))
        except ValueError:
            pass
        op = st["ops"].setdefault(operator_name(f.get("adm_lb_nom")),
                                  {"generations": set(), "systems": set(), "status": None, "latest": None})
        if f.get("generation"):
            op["generations"].add(f["generation"])
        if f.get("emr_lb_systeme"):
            op["systems"].add(f["emr_lb_systeme"])
        status = f.get("statut")
        if status and (op["status"] is None or STATUS_RANK.get(status, 9) < STATUS_RANK.get(op["status"], 9)):
            op["status"] = status
        if f.get("emr_dt") and (op["latest"] is None or f["emr_dt"] > op["latest"]):
            op["latest"] = f["emr_dt"]
    out = []
    for st in stations.values():
        ops = [AntennaOperator(name=name, generations=sorted(o["generations"]), status=o["status"], latest=o["latest"],
                               systems=sorted(o["systems"], key=lambda s: (s.split()[0], s)))
               for name, o in sorted(st["ops"].items())]
        out.append(AntennaStation(id=st["id"], lat=round(st["lat"], 6), lon=round(st["lon"], 6), height=st["height"],
                                  address=st["address"], postcode=st["postcode"], insee=st["insee"], operators=ops))
    return out, registry_date


def parse_outages(geojson: dict) -> dict[str, list[AntennaOutage]]:
    """Pannes et maintenances de Côte-d'Or, indexées par n° de station ANFR."""
    out: dict[str, list[AntennaOutage]] = {}
    for feat in geojson.get("features", []):
        p = feat.get("properties") or {}
        if (p.get("departement") or "").strip().zfill(2) != DEPARTEMENT[-2:] or not p.get("station_anfr"):
            continue
        techs = {k: v for k in ("voix2g", "voix3g", "voix4g", "data3g", "data4g", "data5g") if (v := p.get(k))}
        out.setdefault(p["station_anfr"], []).append(AntennaOutage(
            operator=operator_name(p.get("operateur")),
            kind="maintenance" if (p.get("raison") or "").upper().startswith("MAINT") else "incident",
            voice=p.get("voix"), data=p.get("data"), techs=techs, detail=p.get("detail"),
            start=p.get("debut"), end=p.get("fin"), commune=p.get("commune")))
    return out


async def fetch_registry() -> tuple[list[dict], bool]:
    """Émetteurs ANFR du département (cache disque 24 h). Renvoie (enregistrements, depuis_le_cache)."""
    path = get_settings().data_dir / f"anfr_{DEPARTEMENT}.json"
    fresh = path.exists() and time.time() - path.stat().st_mtime < REGISTRY_MAX_AGE
    if not fresh:
        try:
            # URL écrite à la main : l'API ANFR ne décode pas les virgules encodées (%2C) de « fields »
            url = (f"{ANFR_API}?dataset=observatoire_2g_3g_4g&refine.sta_nm_dpt={DEPARTEMENT}"
                   f"&rows=10000&fields={ANFR_FIELDS}")
            resp = await client().get(url, timeout=90)
            resp.raise_for_status()
            records = [r["fields"] for r in resp.json().get("records", [])]
            if records:
                path.write_text(json.dumps(records))
                return records, False
        except Exception as exc:  # noqa: BLE001
            log.warning("Registre ANFR injoignable : %s", exc)
    if path.exists():
        return json.loads(path.read_text()), True
    raise RuntimeError("Registre ANFR indisponible et aucun cache")


@cached(ttl=3 * 3600)
async def fetch_outages() -> tuple[dict[str, list[AntennaOutage]], str | None]:
    meta = (await client().get(ARCEP_DATASET)).json()
    res = max((r for r in meta.get("resources", []) if (r.get("format") or "").lower() == "geojson"),
              key=lambda r: r.get("title") or "", default=None)
    if not res:
        raise RuntimeError("Aucun fichier de pannes publié")
    resp = await client().get(res["url"], timeout=60)
    resp.raise_for_status()
    return parse_outages(resp.json()), (res.get("title") or "")[:10] or None


@cached(ttl=3600)
async def get_antennas() -> AntennaData:
    async with _lock:
        stations: list[AntennaStation] = []
        registry_date = outages_date = None
        try:
            records, from_cache = await fetch_registry()
            stations, registry_date = await asyncio.to_thread(group_registry, records)
            date_fr = datetime.fromisoformat(registry_date).strftime("%d/%m/%Y") if registry_date else "?"
            registry.record("antennes", "live",
                            f"Registre ANFR du {date_fr} · {len(stations)} stations"
                            + (" (cache local, ANFR injoignable)" if from_cache else ""),
                            endpoint="data.anfr.fr — observatoire 2G/3G/4G/5G (maj hebdomadaire)")
        except Exception as exc:  # noqa: BLE001
            registry.record("antennes", "error", f"Registre ANFR indisponible : {exc.__class__.__name__}",
                            endpoint="data.anfr.fr")
        try:
            outages, outages_date = await fetch_outages()
            for st in stations:
                st.outages = outages.get(st.id, [])
            n = sum(1 for st in stations if st.outages)
            date_fr = datetime.fromisoformat(outages_date).strftime("%d/%m/%Y") if outages_date else "?"
            registry.record("antennes_pannes", "live", f"Pannes déclarées le {date_fr} · {n} antenne(s) touchée(s) autour de Dijon",
                            endpoint="Arcep — sites indisponibles (quotidien)")
        except Exception as exc:  # noqa: BLE001
            log.warning("Pannes Arcep indisponibles : %s", exc)
            registry.record("antennes_pannes", "error", f"Pannes indisponibles : {exc.__class__.__name__}",
                            endpoint="Arcep — sites indisponibles")
        return AntennaData(stations=stations, registry_date=registry_date, outages_date=outages_date)
