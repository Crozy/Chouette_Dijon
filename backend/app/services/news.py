"""Presse locale (RSS) et flux sociaux (Mastodon / RSS-Bridge / Nitter…) via feedparser."""
import asyncio
import hashlib
import html
import logging
import re
from datetime import datetime, timedelta, timezone

import feedparser

from app.cache import cached
from app.config import get_settings
from app.fallback.data import NEWS, SOCIAL
from app.models import NewsItem, SocialPost, SourceMeta
from app.services import registry
from app.services.http import client

log = logging.getLogger(__name__)
TAG_RE = re.compile(r"<[^>]+>")


def clean(text: str | None, limit: int = 280) -> str | None:
    if not text:
        return None
    t = html.unescape(TAG_RE.sub(" ", text))
    t = re.sub(r"\s+", " ", t).strip()
    return (t[: limit - 1] + "…") if len(t) > limit else t


def _date(entry) -> datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        v = entry.get(key)
        if v:
            return datetime(*v[:6], tzinfo=timezone.utc)
    return None


def _image(entry) -> str | None:
    for m in entry.get("media_content", []) + entry.get("media_thumbnail", []):
        if m.get("url"):
            return m["url"]
    for link in entry.get("links", []):
        if link.get("rel") == "enclosure" and str(link.get("type", "")).startswith("image"):
            return link.get("href")
    return None


async def _fetch_feed(name: str, url: str) -> list:
    resp = await client().get(url)
    resp.raise_for_status()
    parsed = await asyncio.to_thread(feedparser.parse, resp.content)
    if parsed.bozo and not parsed.entries:
        raise ValueError("Flux illisible")
    return parsed.entries


def _id(*parts) -> str:
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12]


@cached(ttl=600)
async def get_news(limit: int = 40) -> tuple[SourceMeta, list[NewsItem]]:
    s = get_settings()
    feeds = s.parse_feeds(s.rss_feeds)
    items: list[NewsItem] = []
    ok, errors = [], []
    if feeds and not s.force_demo:
        with registry.timer() as t:
            results = await asyncio.gather(*(_fetch_feed(n, u) for n, u in feeds), return_exceptions=True)
        for (name, _), res in zip(feeds, results):
            if isinstance(res, Exception):
                errors.append(name)
                log.warning("Flux RSS %s indisponible : %s", name, res)
                continue
            ok.append(name)
            for e in res[:20]:
                items.append(NewsItem(id=_id(name, e.get("link"), e.get("title")), source=name,
                                      title=clean(e.get("title"), 200) or "(sans titre)", link=e.get("link"),
                                      summary=clean(e.get("summary")), published=_date(e), image=_image(e)))
    if items:
        items.sort(key=lambda i: i.published or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        msg = f"{len(ok)}/{len(feeds)} flux" + (f" — indisponible(s) : {', '.join(errors)}" if errors else "")
        return registry.record("news", "live", msg, t.ms, "feedparser"), items[:limit]
    now = datetime.now(timezone.utc)
    fallback = [NewsItem(id=f"demo-{i}", source=src, title=title, summary=summary, published=now - timedelta(minutes=12 + i * 40))
                for i, (src, title, summary) in enumerate(NEWS)]
    msg = "Mode démo forcé" if s.force_demo else "Aucun flux RSS joignable"
    return registry.record("news", "simulated", msg, endpoint="feedparser"), fallback


@cached(ttl=600)
async def get_social(limit: int = 20) -> tuple[SourceMeta, list[SocialPost]]:
    s = get_settings()
    feeds = s.parse_feeds(s.social_feeds)
    posts: list[SocialPost] = []
    if feeds and not s.force_demo:
        with registry.timer() as t:
            results = await asyncio.gather(*(_fetch_feed(n, u) for n, u in feeds), return_exceptions=True)
        for (account, url), res in zip(feeds, results):
            if isinstance(res, Exception):
                log.warning("Flux social %s indisponible : %s", account, res)
                continue
            via = "Mastodon" if "@" in url or "mastodon" in url else "RSS"
            for e in res[:10]:
                posts.append(SocialPost(id=_id(account, e.get("link"), e.get("title")), account=account,
                                        text=clean(e.get("summary") or e.get("title"), 400) or "",
                                        link=e.get("link"), published=_date(e), via=via))
        if posts:
            posts.sort(key=lambda p: p.published or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
            return registry.record("social", "live", f"{len(posts)} publications", t.ms, "SOCIAL_FEEDS"), posts[:limit]
        meta = registry.record("social", "error", "Aucun flux social joignable", endpoint="SOCIAL_FEEDS")
    else:
        meta = registry.record("social", "simulated",
                               "Mode démo forcé" if s.force_demo else "SOCIAL_FEEDS non configuré — publications simulées",
                               endpoint="SOCIAL_FEEDS")
    now = datetime.now(timezone.utc)
    return meta, [SocialPost(id=f"demo-{i}", account=a, text=txt, via=via, published=now - timedelta(minutes=8 + i * 50))
                  for i, (a, txt, via) in enumerate(SOCIAL)]
