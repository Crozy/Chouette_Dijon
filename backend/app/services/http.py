"""Client HTTP asynchrone partagé."""
import httpx

from app.config import get_settings

_client: httpx.AsyncClient | None = None

USER_AGENT = "DijonHub/1.0 (+https://github.com/; tableau de bord open source)"


def client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=get_settings().http_timeout,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
