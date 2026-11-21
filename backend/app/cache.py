"""Cache mémoire TTL léger et asynchrone (un verrou par clé pour éviter les appels concurrents)."""
import asyncio
import functools
import time
from typing import Any, Awaitable, Callable

_store: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}


def cached(ttl: float) -> Callable:
    def decorator(fn: Callable[..., Awaitable[Any]]):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            key = f"{fn.__module__}.{fn.__qualname__}:{args}:{sorted(kwargs.items())}"
            hit = _store.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            lock = _locks.setdefault(key, asyncio.Lock())
            async with lock:
                hit = _store.get(key)
                if hit and hit[0] > time.monotonic():
                    return hit[1]
                value = await fn(*args, **kwargs)
                _store[key] = (time.monotonic() + ttl, value)
                return value

        return wrapper

    return decorator


def clear_cache() -> None:
    _store.clear()
