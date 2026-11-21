from typing import Optional

from fastapi import APIRouter

from app.cache import clear_cache
from app.models import ApiResponse, Event, Venue, Infos, NewsItem, SocialPost, SourceMeta, Weather
from app.services import events, gtfs_rt, infos, news, registry, sncf, velodi, weather, coach

router = APIRouter(prefix="/api", tags=["contenu"])


@router.get("/news", response_model=ApiResponse[list[NewsItem]])
async def get_news():
    meta, data = await news.get_news()
    return ApiResponse(meta=meta, data=data)


@router.get("/news/social", response_model=ApiResponse[list[SocialPost]])
async def get_social():
    meta, data = await news.get_social()
    return ApiResponse(meta=meta, data=data)


@router.get("/weather", response_model=ApiResponse[Weather])
async def get_weather():
    meta, data = await weather.get_weather()
    return ApiResponse(meta=meta, data=data)


@router.get("/events/venues", response_model=ApiResponse[list[Venue]])
async def get_venues():
    """Salles et lieux connus (positionnés sur la carte), avec le nombre d'événements à venir."""
    meta, data = await events.get_events()
    return ApiResponse(meta=meta, data=events.known_venues(data))


@router.get("/events", response_model=ApiResponse[list[Event]])
async def get_events(category: Optional[str] = None):
    meta, data = await events.get_events()
    if category and category != "all":
        data = [e for e in data if e.category == category]
    return ApiResponse(meta=meta, data=data)


@router.get("/infos", response_model=ApiResponse[Infos])
async def get_infos():
    meta, data = await infos.get_infos()
    return ApiResponse(meta=meta, data=data)


@router.get("/status", response_model=list[SourceMeta])
async def status():
    return registry.all_sources()


@router.post("/status/refresh", response_model=list[SourceMeta])
async def refresh():
    """Vide le cache et interroge toutes les sources."""
    clear_cache()
    await gtfs_rt.get_vehicles()
    await velodi.get_stations()
    await sncf.get_trains("departures")
    await coach.get_coaches("departures")
    await weather.get_weather()
    await news.get_news()
    await news.get_social()
    await events.get_events()
    await infos.get_infos()
    return registry.all_sources()
