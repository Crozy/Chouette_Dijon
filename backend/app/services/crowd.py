"""Affluence ESTIMÉE (zones où il y a du monde).

Aucune donnée publique de fréquentation en temps réel n'existe pour Dijon : il s'agit d'une
estimation, jamais d'une mesure. Elle combine :
  1. les passages réels de bus et de tram par arrêt pour l'heure en cours (horaires GTFS Divia) ;
  2. un profil horaire typique des lieux animés (centre-ville, gare, centres commerciaux, campus…) ;
  3. les événements de l'agenda (concert, match…) autour de leur horaire.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.cache import cached
from app.fallback.data import VENUE_POSITIONS
from app.models import CrowdData, CrowdPoint, CrowdZone, SourceMeta
from app.services import events, gtfs_static, registry

PARIS = ZoneInfo("Europe/Paris")
METHOD = ("Estimation calculée à partir des horaires Divia (passages par arrêt), de profils horaires "
          "typiques des lieux et de l'agenda. Ce n'est pas une mesure de fréquentation réelle.")

# nom, lat, lon, type de profil, importance (0–1). Positions approximatives.
HOTSPOTS = [
    ("Rue de la Liberté", 47.3221, 5.0378, "centre", 1.0),
    ("Place Darcy", 47.3225, 5.0349, "centre", 0.85),
    ("Place François Rude", 47.3222, 5.0404, "centre", 0.8),
    ("Place de la Libération", 47.3216, 5.0413, "centre", 0.7),
    ("Les Halles — marché central", 47.3240, 5.0397, "market", 0.9),
    ("Place Émile Zola", 47.3205, 5.0361, "nightlife", 0.7),
    ("Rue Berbisey", 47.3186, 5.0380, "nightlife", 0.6),
    ("Place de la République", 47.3271, 5.0457, "nightlife", 0.65),
    ("Gare de Dijon-Ville", 47.3233, 5.0272, "station", 1.0),
    ("Toison d'Or", 47.3417, 5.0508, "mall", 0.95),
    ("Quetigny — centre commercial", 47.3139, 5.1077, "mall", 0.7),
    ("Campus Université de Bourgogne", 47.3110, 5.0690, "campus", 0.9),
    ("CHU Dijon Bourgogne", 47.3197, 5.0657, "hospital", 0.6),
    ("Cité internationale de la gastronomie", 47.3126, 5.0327, "leisure", 0.6),
]

VENUES = VENUE_POSITIONS  # lieux de l'agenda (positions OpenStreetMap)


def _bump(h: float, center: float, width: float) -> float:
    return max(0.0, 1 - abs(h - center) / width)


def profile(kind: str, now: datetime) -> float:
    """Fréquentation typique (0–1) d'un type de lieu à l'heure donnée."""
    h = now.hour + now.minute / 60
    wd = now.weekday()  # 0 = lundi
    sat, sun = wd == 5, wd == 6
    if kind == "centre":
        if sun:
            return 0.15 + 0.3 * _bump(h, 15.5, 4)
        base = 0.55 * _bump(h, 12.5, 2.5) + 0.75 * _bump(h, 17, 3) + 0.2 * _bump(h, 10, 2)
        return min(1.0, base * (1.35 if sat else 1.0) + (0.15 if sat and 14 <= h <= 18 else 0))
    if kind == "market":  # Halles : mardi, vendredi, samedi matin (+ jeudi)
        if wd in (1, 3, 4, 5) and 7 <= h <= 13.5:
            return (1.0 if sat else 0.75) * (0.4 + 0.6 * _bump(h, 10.5, 3.5))
        return 0.1 + 0.25 * _bump(h, 18, 2) if not sun else 0.05
    if kind == "nightlife":
        night = _bump(h, 21.5, 3.5) if h >= 12 else _bump(h + 24, 21.5, 3.5)
        return min(1.0, 0.1 + night * (1.0 if wd in (3, 4, 5) else 0.55) + 0.25 * _bump(h, 12.75, 1.5))
    if kind == "station":
        if wd < 5:
            return min(1.0, 0.15 + 0.85 * _bump(h, 7.8, 1.8) + 0.85 * _bump(h, 17.8, 2.2) + 0.3 * _bump(h, 12.5, 2))
        return 0.15 + (0.6 if wd == 4 else 0.45) * _bump(h, 17, 4) + (0.5 if sun else 0.3) * _bump(h, 18.5, 3)
    if kind == "mall":
        if sun or h < 9 or h > 20.5:
            return 0.05
        return min(1.0, (0.35 + 0.65 * _bump(h, 16, 4.5)) * (1.0 if sat else 0.7))
    if kind == "campus":
        if wd >= 5 or not (7.5 <= h <= 19):
            return 0.05
        return 0.35 + 0.65 * max(_bump(h, 10, 2.5), _bump(h, 14.5, 3))
    if kind == "hospital":
        return 0.1 + (0.6 if wd < 5 else 0.3) * _bump(h, 14, 5.5)
    if kind == "leisure":
        return 0.1 + 0.6 * _bump(h, 15, 4) * (1.3 if wd >= 5 else 0.8)
    return 0.1


def level_label(score: float) -> str:
    if score < 0.25:
        return "Calme"
    if score < 0.5:
        return "Modéré"
    if score < 0.75:
        return "Animé"
    return "Très animé"


def compute(now: datetime, event_list=()) -> CrowdData:
    points: list[CrowdPoint] = []
    zones: list[CrowdZone] = []

    # 1. Passages Divia dans l'heure, par arrêt (heure en cours et suivante pondérées selon les minutes)
    st = gtfs_static.STATE
    services = gtfs_static.active_services(now.date())
    w_next = now.minute / 60
    stops_by_id = {s.id: s for s in st.transit_stops}
    for stop_id, per_service in st.stop_hourly.items():
        stop = stops_by_id.get(stop_id)
        if not stop:
            continue
        n = 0.0
        for sid, counts in per_service.items():
            if sid in services:
                n += counts[now.hour] * (1 - w_next) + counts[(now.hour + 1) % 24] * w_next
        if n >= 1:
            # 40 passages / h ≈ pôle d'échanges très actif
            points.append(CrowdPoint(lat=stop.lat, lon=stop.lon, weight=round(min(1.0, n / 40) * 0.45, 3)))

    # 2. Lieux animés selon leur profil horaire
    for name, lat, lon, kind, importance in HOTSPOTS:
        score = profile(kind, now) * importance
        reasons = [f"Profil horaire typique ({_KIND_LABEL[kind]})"]
        zones.append(CrowdZone(name=name, lat=lat, lon=lon, score=round(score, 3), level=level_label(score), reasons=reasons))

    # 3. Événements de l'agenda : affluence de 1 h 30 avant à 3 h après le début
    for ev in event_list:
        start = ev.start.astimezone(PARIS)
        if not (start - timedelta(minutes=90) <= now <= start + timedelta(hours=3)):
            continue
        venue = next((v for v in VENUES if v[0] in ev.venue.lower()), None)
        if not venue:
            continue
        mins = (now - start).total_seconds() / 60
        score = 0.95 if -30 <= mins <= 150 else 0.6
        zones.append(CrowdZone(name=venue[1], lat=venue[2], lon=venue[3], score=score, level=level_label(score),
                               reasons=[f"Événement : {ev.title} ({start:%H:%M})"]))

    for z in zones:
        if z.score >= 0.05:
            points.append(CrowdPoint(lat=z.lat, lon=z.lon, weight=round(z.score, 3)))
    zones.sort(key=lambda z: -z.score)
    return CrowdData(generated_at=now, estimated=True, method=METHOD, points=points, zones=zones)


_KIND_LABEL = {
    "centre": "centre-ville commerçant", "market": "jours de marché", "nightlife": "sorties en soirée",
    "station": "gare, heures de pointe", "mall": "centre commercial", "campus": "campus en semaine",
    "hospital": "hôpital", "leisure": "lieu de visite",
}


@cached(ttl=120)
async def get_crowd() -> tuple[SourceMeta, CrowdData]:
    if not gtfs_static.STATE.loaded:
        await gtfs_static.load()
    try:
        _, evs = await events.get_events()
    except Exception:  # noqa: BLE001
        evs = []
    data = compute(datetime.now(PARIS), evs)
    meta = registry.record("crowd", "simulated", "Estimation (horaires Divia + profils horaires + agenda) — pas une mesure",
                           endpoint="calcul local")
    return meta, data
