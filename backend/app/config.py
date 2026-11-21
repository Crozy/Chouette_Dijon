"""Configuration chargée depuis les variables d'environnement (ou un fichier .env)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(BASE_DIR / ".env", BASE_DIR.parent / ".env"), extra="ignore")

    # Coordonnées de référence (Dijon centre)
    lat: float = 47.3220
    lon: float = 5.0415

    # --- Transports ---
    divia_gtfs_rt_vehicles_url: str = "https://proxy.transport.data.gouv.fr/resource/divia-dijon-gtfs-rt-vehicle-position"
    divia_gtfs_rt_alerts_url: str = ""  # flux GTFS-RT "service alerts" si disponible
    divia_gtfs_static_url: str = "https://www.data.gouv.fr/api/1/datasets/r/e0dbd217-15cd-4e28-9459-211a27511a34"
    velodi_gbfs_url: str = ""  # URL gbfs.json (auto-découverte) — vide = mode simulé
    sncf_api_key: str = ""
    sncf_stop_area: str = "stop_area:SNCF:87713040"
    # Horaires théoriques officiels des cars (GTFS open data, ODbL) — vide = horaires simulés
    flixbus_gtfs_url: str = "https://www.data.gouv.fr/api/1/datasets/r/30d94e83-48a4-4c44-8a96-c082377f5221"
    blablacar_gtfs_url: str = "https://www.data.gouv.fr/api/1/datasets/r/fd54f81f-4389-4e73-be75-491133d011c3"
    tomtom_api_key: str = ""  # circulation temps réel (TomTom Traffic Flow) — vide = estimation

    # --- Actualités ---
    # Format : "Nom|URL,Nom|URL"
    rss_feeds: str = (
        "Le Bien Public|https://www.bienpublic.com/edition-dijon-ville/rss,"
        "ici Bourgogne|https://www.francebleu.fr/rss/bourgogne/a-la-une.xml,"
        "Ville de Dijon|https://www.dijon.fr/rss"
    )
    # Format identique : "@Compte|URL RSS/Atom (Mastodon, RSS-Bridge, Nitter…)"
    social_feeds: str = ""

    # --- Événements ---
    openagenda_key: str = ""
    openagenda_agenda_uid: str = ""

    # --- Divers ---
    cors_origins: str = "*"
    http_timeout: float = 10.0
    data_dir: Path = BASE_DIR / "data"
    force_demo: bool = False  # force toutes les sources en mode simulé

    @staticmethod
    def parse_feeds(raw: str) -> list[tuple[str, str]]:
        out = []
        for chunk in raw.split(","):
            if "|" in chunk:
                name, url = chunk.split("|", 1)
                if name.strip() and url.strip():
                    out.append((name.strip(), url.strip()))
        return out


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s
