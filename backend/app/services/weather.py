"""Météo et qualité de l'air via Open-Meteo (gratuit, sans clé)."""
import logging
import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.cache import cached
from app.config import get_settings
from app.models import AirQuality, CurrentWeather, DailyPoint, HourlyPoint, SourceMeta, Weather
from app.services import registry
from app.services.http import client

log = logging.getLogger(__name__)
PARIS = ZoneInfo("Europe/Paris")
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

# Codes WMO → (libellé, icône)
WMO = {
    0: ("Ciel dégagé", "sun"), 1: ("Peu nuageux", "cloud-sun"), 2: ("Partiellement nuageux", "cloud-sun"),
    3: ("Couvert", "cloud"), 45: ("Brouillard", "fog"), 48: ("Brouillard givrant", "fog"),
    51: ("Bruine légère", "drizzle"), 53: ("Bruine", "drizzle"), 55: ("Bruine dense", "drizzle"),
    56: ("Bruine verglaçante", "drizzle"), 57: ("Bruine verglaçante", "drizzle"),
    61: ("Pluie faible", "rain"), 63: ("Pluie", "rain"), 65: ("Forte pluie", "rain"),
    66: ("Pluie verglaçante", "rain"), 67: ("Pluie verglaçante", "rain"),
    71: ("Neige faible", "snow"), 73: ("Neige", "snow"), 75: ("Forte neige", "snow"), 77: ("Grésil", "snow"),
    80: ("Averses", "showers"), 81: ("Averses", "showers"), 82: ("Fortes averses", "showers"),
    85: ("Averses de neige", "snow"), 86: ("Averses de neige", "snow"),
    95: ("Orage", "storm"), 96: ("Orage et grêle", "storm"), 99: ("Orage et grêle", "storm"),
}
DIRS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]


def wmo(code: int) -> tuple[str, str]:
    return WMO.get(int(code), ("—", "cloud"))


def aqi_level(v: float | None) -> str:
    if v is None:
        return "Indisponible"
    for limit, label in [(20, "Bon"), (40, "Correct"), (60, "Moyen"), (80, "Médiocre"), (100, "Mauvais")]:
        if v <= limit:
            return label
    return "Très mauvais"


def parse_forecast(j: dict) -> tuple[CurrentWeather, list[HourlyPoint], list[DailyPoint]]:
    c = j["current"]
    label, icon = wmo(c["weather_code"])
    wd = c.get("wind_direction_10m")
    current = CurrentWeather(
        temperature=c["temperature_2m"], apparent_temperature=c["apparent_temperature"],
        humidity=int(c["relative_humidity_2m"]), wind_speed=c["wind_speed_10m"], wind_gusts=c.get("wind_gusts_10m"),
        wind_direction=DIRS[int(((wd % 360) + 22.5) // 45) % 8] if wd is not None else None,
        pressure=c.get("pressure_msl"), weather_code=c["weather_code"], label=label,
        icon=("moon" if icon == "sun" and not c.get("is_day", 1) else icon), is_day=bool(c.get("is_day", 1)))
    h = j["hourly"]
    now = datetime.now(PARIS).replace(minute=0, second=0, microsecond=0)
    hourly = []
    for i, ts in enumerate(h["time"]):
        t = datetime.fromisoformat(ts).replace(tzinfo=PARIS)
        if t < now or len(hourly) >= 24:
            continue
        hourly.append(HourlyPoint(time=t, temperature=h["temperature_2m"][i],
                                  precipitation_probability=int(h["precipitation_probability"][i] or 0),
                                  weather_code=h["weather_code"][i], icon=wmo(h["weather_code"][i])[1]))
    d = j["daily"]
    daily = [DailyPoint(date=d["time"][i], temp_min=d["temperature_2m_min"][i], temp_max=d["temperature_2m_max"][i],
                        precipitation_probability=int(d["precipitation_probability_max"][i] or 0),
                        weather_code=d["weather_code"][i], label=wmo(d["weather_code"][i])[0],
                        icon=wmo(d["weather_code"][i])[1], sunrise=d["sunrise"][i][-5:], sunset=d["sunset"][i][-5:])
             for i in range(len(d["time"]))]
    return current, hourly, daily


def simulated_weather() -> Weather:
    now = datetime.now(PARIS)
    base = 11 + 9 * math.sin((now.timetuple().tm_yday - 110) / 365 * 2 * math.pi)  # saisonnalité
    hourly = []
    for k in range(24):
        t = (now + timedelta(hours=k)).replace(minute=0, second=0, microsecond=0)
        temp = round(base + 4 * math.sin((t.hour - 9) / 24 * 2 * math.pi), 1)
        hourly.append(HourlyPoint(time=t, temperature=temp, precipitation_probability=(k * 7) % 60,
                                  weather_code=3 if k % 5 else 61, icon="cloud" if k % 5 else "rain"))
    codes = [3, 61, 0, 1, 2, 80, 3]
    daily = [DailyPoint(date=(now + timedelta(days=i)).strftime("%Y-%m-%d"), temp_min=round(base - 3 + i % 3, 1),
                        temp_max=round(base + 3 + (i * 2) % 4, 1), precipitation_probability=[20, 70, 0, 5, 15, 45, 30][i],
                        weather_code=codes[i], label=wmo(codes[i])[0], icon=wmo(codes[i])[1],
                        sunrise="07:58", sunset="16:57") for i in range(7)]
    current = CurrentWeather(temperature=hourly[0].temperature, apparent_temperature=hourly[0].temperature - 3,
                             humidity=82, wind_speed=14, wind_gusts=32, wind_direction="SO", pressure=1018,
                             weather_code=3, label="Couvert", icon="cloud")
    air = AirQuality(european_aqi=28, level=aqi_level(28), pm2_5=6, pm10=11, no2=18, o3=42)
    return Weather(current=current, hourly=hourly, daily=daily, air=air)


async def _fetch_air() -> tuple[SourceMeta, AirQuality | None]:
    s = get_settings()
    try:
        with registry.timer() as t:
            resp = await client().get(AIR_URL, params={
                "latitude": s.lat, "longitude": s.lon, "timezone": "Europe/Paris",
                "current": "european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone"})
            resp.raise_for_status()
        c = resp.json()["current"]
        aqi = c.get("european_aqi")
        air = AirQuality(european_aqi=int(aqi) if aqi is not None else None, level=aqi_level(aqi), pm2_5=c.get("pm2_5"),
                         pm10=c.get("pm10"), no2=c.get("nitrogen_dioxide"), o3=c.get("ozone"))
        return registry.record("air", "live", air.level, t.ms, AIR_URL), air
    except Exception as exc:  # noqa: BLE001
        log.warning("Qualité de l'air indisponible : %s", exc)
        return registry.record("air", "simulated", f"API indisponible ({exc.__class__.__name__})", endpoint=AIR_URL), \
            AirQuality(european_aqi=28, level=aqi_level(28), pm2_5=6, pm10=11, no2=18, o3=42)


@cached(ttl=600)
async def get_weather() -> tuple[SourceMeta, Weather]:
    s = get_settings()
    if s.force_demo:
        w = simulated_weather()
        w.air_meta = registry.record("air", "simulated", "Mode démo forcé")
        return registry.record("weather", "simulated", "Mode démo forcé"), w
    try:
        with registry.timer() as t:
            resp = await client().get(FORECAST_URL, params={
                "latitude": s.lat, "longitude": s.lon, "timezone": "Europe/Paris", "forecast_days": 7,
                "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,"
                           "wind_direction_10m,wind_gusts_10m,pressure_msl,is_day",
                "hourly": "temperature_2m,precipitation_probability,weather_code",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
            })
            resp.raise_for_status()
        current, hourly, daily = parse_forecast(resp.json())
        meta = registry.record("weather", "live", current.label, t.ms, FORECAST_URL)
        air_meta, air = await _fetch_air()
        return meta, Weather(current=current, hourly=hourly, daily=daily, air=air, air_meta=air_meta)
    except Exception as exc:  # noqa: BLE001
        log.warning("Open-Meteo indisponible : %s", exc)
        w = simulated_weather()
        w.air_meta, w.air = await _fetch_air()
        return registry.record("weather", "simulated", f"API indisponible ({exc.__class__.__name__})",
                               endpoint=FORECAST_URL), w

