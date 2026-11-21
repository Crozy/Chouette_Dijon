from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Path, Query, Response

from app.models import AntennaData, ApiResponse, Board, BoardEntry, CrowdData, Journey, TrafficInfo, LineShape, MeetingPoint, TransitStop, VelodiStation, Vehicle
from app.services import antennas, coach, crowd, gtfs_rt, gtfs_static, registry, sncf, traffic, velodi

router = APIRouter(prefix="/api/transports", tags=["transports"])


@router.get("/vehicles", response_model=ApiResponse[list[Vehicle]])
async def vehicles():
    meta, data = await gtfs_rt.get_vehicles()
    return ApiResponse(meta=meta, data=data)


@router.get("/lines", response_model=ApiResponse[list[LineShape]])
async def lines():
    """Tracés des lignes de tram et de bus (GTFS statique), un par sens."""
    if not gtfs_static.STATE.loaded:
        await gtfs_static.load()
    meta = registry.get("divia_static")
    if not gtfs_static.STATE.line_shapes:
        meta = meta.model_copy(update={"status": "simulated", "message": "Tracés approximatifs (tram uniquement)"})
    return ApiResponse(meta=meta, data=gtfs_static.all_shapes())


@router.get("/stops", response_model=ApiResponse[list[TransitStop]])
async def stops():
    """Arrêts de tram et de bus Divia (GTFS statique), avec les lignes qui les desservent."""
    if not gtfs_static.STATE.loaded:
        await gtfs_static.load()
    meta = registry.get("divia_static")
    if not gtfs_static.STATE.transit_stops:
        meta = meta.model_copy(update={"status": "error", "message": "Arrêts indisponibles (GTFS non chargé)"})
    return ApiResponse(meta=meta, data=gtfs_static.transit_stops())


@router.get("/velodi", response_model=ApiResponse[list[VelodiStation]])
async def velodi_stations():
    meta, data = await velodi.get_stations()
    return ApiResponse(meta=meta, data=data)


@router.get("/meeting-points", response_model=ApiResponse[list[MeetingPoint]])
async def meeting_points():
    meta = registry.get("coach", "simulated", "Points de rendez-vous de référence")
    return ApiResponse(meta=meta, data=coach.meeting_points())


@router.get("/traffic", response_model=ApiResponse[TrafficInfo])
async def traffic_info():
    """Circulation : tuiles TomTom temps réel si clé, sinon niveau estimé selon l'heure."""
    meta, data = await traffic.get_traffic()
    return ApiResponse(meta=meta, data=data)


@router.get("/traffic/tiles/{z}/{x}/{y}.png")
async def traffic_tile(z: int = Path(..., ge=0, le=22), x: int = Path(..., ge=0), y: int = Path(..., ge=0),
                       dark: bool = Query(False)):
    """Relais des tuiles TomTom Traffic Flow (la clé API reste côté serveur)."""
    if x >= 2 ** z or y >= 2 ** z:
        raise HTTPException(404)
    tile = await traffic.fetch_tile(z, x, y, dark)
    if tile is None:
        raise HTTPException(404, "Circulation temps réel indisponible")
    return Response(tile, media_type="image/png", headers={"Cache-Control": "public, max-age=120"})


@router.get("/antennas", response_model=ApiResponse[AntennaData])
async def antennas_map():
    """Antennes mobiles (registre ANFR, hebdomadaire) et pannes déclarées (Arcep, quotidien) autour de Dijon."""
    data = await antennas.get_antennas()
    return ApiResponse(meta=registry.get("antennes"), data=data)


@router.get("/crowd", response_model=ApiResponse[CrowdData])
async def crowd_estimate():
    """Zones d'affluence ESTIMÉES (pas une mesure) : horaires Divia, profils horaires, agenda."""
    meta, data = await crowd.get_crowd()
    return ApiResponse(meta=meta, data=data)


@router.get("/journey", response_model=Journey)
async def journey(
    id: str = Query(..., max_length=200, description="journey_id d'une entrée du tableau"),
    ref: Optional[datetime] = Query(None, description="heure théorique de passage à Dijon (base_time)"),
    delay: int = Query(0, ge=0, le=1440),
):
    """Parcours d'un train : gares desservies, déjà passées et à venir."""
    result = await sncf.get_journey(id, ref, delay)
    if result is None:
        raise HTTPException(404, "Parcours indisponible pour ce train")
    return result


@router.get("/board", response_model=Board)
async def board(direction: Literal["departures", "arrivals"] = Query("departures"), limit: int = Query(40, le=100)):
    """Tableau unifié Gare + Gare routière + covoiturage + Vélodi (style Infogare)."""
    train_meta, trains = await sncf.get_trains(direction)
    coach_meta, coaches = await coach.get_coaches(direction)
    velo_meta, stations = await velodi.get_stations()
    entries: list[BoardEntry] = sorted(trains + coaches, key=lambda e: e.time)[:limit]
    gare = next((s for s in stations if "gare" in s.name.lower()), stations[0] if stations else None)
    if gare:
        entries.append(BoardEntry(
            id=f"velodi-{gare.id}", mode="velodi", operator="Vélodi", number=f"Station {gare.id}",
            time=registry.now(), place=f"Vélodi — {gare.name}", via=f"{gare.bikes} vélos · {gare.docks} bornettes",
            platform="—", status="info", status_label=f"{gare.bikes}/{gare.capacity}",
            source_status=velo_meta.status))
    return Board(direction=direction, entries=entries, sources=[train_meta, coach_meta, velo_meta])
