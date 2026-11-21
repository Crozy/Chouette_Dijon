"""Modèles Pydantic exposés par l'API."""
from datetime import datetime
from typing import Generic, Literal, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")
Status = Literal["live", "scheduled", "simulated", "error"]  # scheduled = horaires officiels prévus, pas du temps réel


class SourceMeta(BaseModel):
    source: str
    label: str
    status: Status
    updated_at: datetime
    message: Optional[str] = None
    latency_ms: Optional[int] = None
    endpoint: Optional[str] = None


class ApiResponse(BaseModel, Generic[T]):
    meta: SourceMeta
    data: T


# ---------- Transports ----------
class Vehicle(BaseModel):
    id: str
    line: str
    route_id: str
    mode: Literal["tram", "bus"]
    color: str
    text_color: str
    lat: float
    lon: float
    bearing: Optional[float] = None
    speed_kmh: Optional[float] = None
    headsign: Optional[str] = None
    next_stop: Optional[str] = None
    status: Optional[str] = None
    timestamp: Optional[int] = None


class StopLine(BaseModel):
    line: str
    color: str
    text_color: str
    mode: Literal["tram", "bus"]


class TransitStop(BaseModel):
    id: str
    name: str
    lat: float
    lon: float
    mode: Literal["tram", "bus"]  # "tram" dès qu'une ligne de tram dessert l'arrêt
    lines: list[StopLine]
    wheelchair: bool = False


class TrafficInfo(BaseModel):
    mode: Literal["live", "estimated"]
    level: float  # congestion globale estimée selon l'heure (0 = fluide, 1 = très chargé)
    label: str
    tiles: Optional[str] = None  # gabarit d'URL des tuiles temps réel (mode live)


class CrowdPoint(BaseModel):
    lat: float
    lon: float
    weight: float


class CrowdZone(BaseModel):
    name: str
    lat: float
    lon: float
    score: float
    level: str  # Calme / Modéré / Animé / Très animé
    reasons: list[str] = []


class CrowdData(BaseModel):
    generated_at: datetime
    estimated: bool = True  # toujours une estimation, jamais une mesure
    method: str
    points: list[CrowdPoint]
    zones: list[CrowdZone]


class LineShape(BaseModel):
    line: str
    color: str
    coordinates: list[list[float]]  # [[lon, lat], ...]
    route_id: str = ""
    mode: Literal["tram", "bus"] = "tram"
    direction: Optional[int] = None


class VelodiStation(BaseModel):
    id: str
    name: str
    lat: float
    lon: float
    bikes: int
    docks: int
    capacity: int
    is_renting: bool = True


class MeetingPoint(BaseModel):
    id: str
    kind: Literal["train", "coach", "carpool"]
    name: str
    lat: float
    lon: float
    description: str


class BoardEntry(BaseModel):
    id: str
    mode: Literal["train", "flixbus", "blablacar", "velodi"]
    operator: str  # TGV INOUI, TER, FlixBus, BlaBlaCar Bus, Covoiturage, Vélodi
    number: Optional[str] = None
    time: datetime
    base_time: Optional[datetime] = None
    delay_min: int = 0
    place: str  # destination ou provenance
    via: Optional[str] = None
    platform: Optional[str] = None
    status: Literal["on_time", "delayed", "boarding", "cancelled", "info"] = "on_time"
    status_label: str = "À l'heure"
    source_status: Status = "simulated"
    journey_id: Optional[str] = None  # identifiant du parcours (trains) → /api/transports/journey


class JourneyStop(BaseModel):
    name: str
    arrival: Optional[datetime] = None  # heure prévue (retard inclus)
    departure: Optional[datetime] = None
    base_arrival: Optional[datetime] = None  # heure théorique
    base_departure: Optional[datetime] = None
    delay_min: int = 0
    platform: Optional[str] = None
    is_here: bool = False  # gare de Dijon-Ville
    state: Literal["passed", "current", "upcoming"] = "upcoming"


class Journey(BaseModel):
    id: str
    operator: str
    number: Optional[str] = None
    origin: str
    destination: str
    cancelled: bool = False
    delay_min: int = 0
    source_status: Status = "simulated"
    stops: list[JourneyStop]


class Board(BaseModel):
    direction: Literal["departures", "arrivals"]
    entries: list[BoardEntry]
    sources: list[SourceMeta]


# ---------- Actualités ----------
class NewsItem(BaseModel):
    id: str
    source: str
    title: str
    link: Optional[str] = None
    summary: Optional[str] = None
    published: Optional[datetime] = None
    image: Optional[str] = None


class SocialPost(BaseModel):
    id: str
    account: str
    text: str
    link: Optional[str] = None
    published: Optional[datetime] = None
    via: str = "RSS"


# ---------- Météo ----------
class CurrentWeather(BaseModel):
    temperature: float
    apparent_temperature: float
    humidity: int
    wind_speed: float
    wind_gusts: Optional[float] = None
    wind_direction: Optional[str] = None
    pressure: Optional[float] = None
    weather_code: int
    label: str
    icon: str
    is_day: bool = True


class HourlyPoint(BaseModel):
    time: datetime
    temperature: float
    precipitation_probability: int
    weather_code: int
    icon: str


class DailyPoint(BaseModel):
    date: str
    temp_min: float
    temp_max: float
    precipitation_probability: int
    weather_code: int
    label: str
    icon: str
    sunrise: Optional[str] = None
    sunset: Optional[str] = None


class AirQuality(BaseModel):
    european_aqi: Optional[int] = None
    level: str
    pm2_5: Optional[float] = None
    pm10: Optional[float] = None
    no2: Optional[float] = None
    o3: Optional[float] = None


class Weather(BaseModel):
    current: CurrentWeather
    hourly: list[HourlyPoint]
    daily: list[DailyPoint]
    air: Optional[AirQuality] = None
    air_meta: Optional[SourceMeta] = None


# ---------- Événements ----------
class Event(BaseModel):
    id: str
    title: str
    category: Literal["concert", "sport", "expo", "spectacle", "famille", "autre"]
    venue: str
    start: datetime
    price: Optional[str] = None
    link: Optional[str] = None
    image: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    address: Optional[str] = None
    location_approx: bool = False  # position déduite du nom du lieu (pas fournie par la source)
    venue_id: Optional[str] = None  # salle connue (voir /api/events/venues)
    subtitle: Optional[str] = None  # genre, sous-titre (« Folk », « Football · Ligue 2 »…)
    ticket: Optional[str] = None  # lien de billetterie, s'il diffère de `link`
    source_status: Optional[Status] = None  # statut propre à l'événement (ex. programmation réelle d'une salle)


class Venue(BaseModel):
    id: str
    name: str
    short: str
    kind: Literal["salle", "sport", "expo"]
    lat: float
    lon: float
    upcoming: int = 0  # événements à venir dans l'agenda


# ---------- Infos ----------
class Alert(BaseModel):
    id: str
    level: Literal["perturbation", "deviation", "travaux", "info"]
    scope: str
    title: str
    text: str
    period: Optional[str] = None


class UsefulNumber(BaseModel):
    label: str
    number: str
    emergency: bool = False


class Infos(BaseModel):
    alerts: list[Alert]
    numbers: list[UsefulNumber] = Field(default_factory=list)
