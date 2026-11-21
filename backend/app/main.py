"""DIJON HUB — API FastAPI."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import content, transports
from app.services import coach_gtfs, gtfs_static, http

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Le GTFS statique (≈6 Mo) est chargé en tâche de fond pour ne pas bloquer le démarrage
    task = asyncio.create_task(gtfs_static.load())
    # Horaires FlixBus / BlaBlaCar Bus (≈30 Mo, une fois par jour)
    coach_task = asyncio.create_task(coach_gtfs.load())
    yield
    task.cancel()
    coach_task.cancel()
    await http.close()


app = FastAPI(title="DIJON HUB API", version="1.0.0", description="La métropole en temps réel", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(transports.router)
app.include_router(content.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "gtfs_loaded": gtfs_static.STATE.loaded}
