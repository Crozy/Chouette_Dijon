"""Programmation réelle de trois lieux : La Vapeur, le Zénith de Dijon et le stade Gaston-Gérard (DFCO).

Aucun de ces lieux ne publie d'API officielle. On interroge, comme leurs propres sites, les données
structurées qui les alimentent (ce n'est pas de l'analyse de pages HTML) :
  - La Vapeur  : GraphQL de son WordPress « headless » (admin.lavapeur.com/graphql) ;
  - Zénith     : API REST WordPress du site (zenith-dijon.fr/wp-json/wp/v2/event) ;
  - DFCO       : calendrier JSON d'ESPN (site.api.espn.com), matchs à domicile uniquement.

Bonnes pratiques : interrogation rare (cache 6 h), un seul appel en cours par lieu, lien systématique
vers la page officielle (billetterie). Si une source change ou échoue, l'agenda retombe sur ses
données habituelles et l'erreur est visible dans les Paramètres.
"""
import asyncio
import logging
import re
from datetime import datetime, timedelta
from html import unescape
from zoneinfo import ZoneInfo

from app.cache import cached
from app.fallback.data import VENUE_POSITIONS
from app.models import Event
from app.services import registry
from app.services.http import client

log = logging.getLogger(__name__)
PARIS = ZoneInfo("Europe/Paris")
TTL = 6 * 3600

VAPEUR_GQL = "https://admin.lavapeur.com/graphql"
ZENITH_REST = "https://www.zenith-dijon.fr/wp-json/wp/v2/event"
ESPN_DFCO = "https://site.api.espn.com/apis/site/v2/sports/soccer/fra.2/teams/3170/schedule"

# id de salle (slug, voir events._slug) et position, depuis la table commune des lieux
_POS = {name: (lat, lon) for _, name, lat, lon, *_ in VENUE_POSITIONS}
VAPEUR = ("la-vapeur", "La Vapeur", *_POS["La Vapeur"])
ZENITH = ("zenith-de-dijon", "Zénith de Dijon", *_POS["Zénith de Dijon"])
STADE = ("stade-gaston-gerard", "Stade Gaston-Gérard", *_POS["Stade Gaston-Gérard"])


def _clean(s: str | None) -> str:
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", s or "")).split())


def _largest(srcset: str | None) -> str | None:
    """Plus grande image d'un attribut srcset (« url 300w, url 1024w »), ou l'URL seule."""
    if not srcset:
        return None
    best, best_w = None, -1
    for part in srcset.split(","):
        bits = part.strip().split()
        if not bits:
            continue
        w = int(bits[1][:-1]) if len(bits) > 1 and bits[1].endswith("w") and bits[1][:-1].isdigit() else 0
        # au-delà de ~1000 px, inutile pour une vignette : on garde la plus proche de 800 px
        score = w if w <= 1100 else 1100 - (w - 1100) / 10
        if score > best_w:
            best, best_w = bits[0], score
    return best


def _event(vid, vname, lat, lon, **kw) -> Event:
    return Event(venue=vname, venue_id=vid, lat=lat, lon=lon, location_approx=False, source_status="live", **kw)


# ---------------------------------------------------------------- La Vapeur (GraphQL)
_VAPEUR_QUERY = """query($after: String) { programmes(first: 100, after: $after) {
  pageInfo { hasNextPage endCursor }
  nodes { databaseId title uri typesEvenements { nodes { name } }
    fieldsEvenement { sousTitre lienDeReservation imagePrincipale { srcSet }
      dates { dateDebut heureDebut statut } tarifs { prix titre } } } } }"""


def _vapeur_category(types: list[str], subtitle: str) -> str:
    from app.services.events import categorize
    blob = " ".join(types + [subtitle]).lower()
    if "concert" in blob:
        return "concert"
    if any(k in blob for k in ("atelier", "jeune public", "famille")):
        return "famille"
    return categorize(blob)


async def fetch_vapeur(now: datetime) -> list[Event]:
    out: list[Event] = []
    after = None
    for _ in range(4):  # 400 fiches max : la programmation à venir tient largement dedans
        resp = await client().post(VAPEUR_GQL, json={"query": _VAPEUR_QUERY, "variables": {"after": after}})
        resp.raise_for_status()
        data = resp.json()["data"]["programmes"]
        for n in data["nodes"]:
            f = n.get("fieldsEvenement") or {}
            types = [t["name"] for t in ((n.get("typesEvenements") or {}).get("nodes") or [])]
            prices = [p for p in (f.get("tarifs") or []) if p.get("prix")]
            price = None
            if prices:
                p = prices[0]
                label = (p.get("titre") or [""])[0] if isinstance(p.get("titre"), list) else (p.get("titre") or "")
                price = f"{p['prix']}{f' ({label.lower()})' if label else ''}"
            for i, d in enumerate(f.get("dates") or []):
                if not d.get("dateDebut"):
                    continue
                day = d["dateDebut"][:10]
                hh, mm = (d.get("heureDebut") or "20:00").split(":")[:2]
                start = datetime.fromisoformat(day).replace(hour=int(hh), minute=int(mm), tzinfo=PARIS)
                if start < now - timedelta(hours=4):
                    continue
                title = _clean(n.get("title"))
                raw = d.get("statut") or ""
                status = " ".join(raw).lower() if isinstance(raw, list) else str(raw).lower()
                if "annul" in status:
                    title = f"[Annulé] {title}"
                elif "complet" in status:
                    price = "Complet"
                out.append(_event(
                    *VAPEUR, id=f"vapeur-{n['databaseId']}-{i}", title=title,
                    category=_vapeur_category(types, f.get("sousTitre") or ""), start=start,
                    subtitle=_clean(f.get("sousTitre")) or None, price=price,
                    link=f"https://www.lavapeur.com{n['uri']}" if n.get("uri") else "https://www.lavapeur.com/programme",
                    image=_largest((f.get("imagePrincipale") or {}).get("srcSet"))))
        if not data["pageInfo"]["hasNextPage"]:
            break
        after = data["pageInfo"]["endCursor"]
    return out


# ---------------------------------------------------------------- Zénith (WordPress REST)
async def fetch_zenith(now: datetime) -> list[Event]:
    from app.services.events import categorize
    out: list[Event] = []
    fields = "id,title,link,acf.subtitle,acf.sessions,acf.image_cover,acf.price_start,acf.price_text,acf.status_places_global"
    for page in range(1, 6):
        resp = await client().get(ZENITH_REST, params={"per_page": 100, "page": page, "_fields": fields})
        if resp.status_code == 400:  # au-delà de la dernière page
            break
        resp.raise_for_status()
        items = resp.json()
        for e in items:
            acf = e.get("acf") or {}
            title = _clean((e.get("title") or {}).get("rendered"))
            subtitle = _clean(acf.get("subtitle")) or None
            cover = acf.get("image_cover") or {}
            image = ((cover.get("sizes") or {}).get("large") or cover.get("url")) if isinstance(cover, dict) else None
            price = _clean(acf.get("price_text")) or (f"dès {acf['price_start']} €" if acf.get("price_start") else None)
            for i, s in enumerate(acf.get("sessions") or []):
                try:
                    start = datetime.strptime(s["session_date"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=PARIS)
                except (KeyError, TypeError, ValueError):
                    continue
                if start < now - timedelta(hours=4):
                    continue
                status = (s.get("status_event") or "")
                ticket = ((s.get("ticketing") or {}).get("url_official")) or e.get("link")
                label = {"sold_out": "Complet", "cancelled": "Annulé", "postponed": "Reporté"}.get(status)
                out.append(_event(
                    *ZENITH, id=f"zenith-{e['id']}-{i}", title=f"[{label}] {title}" if label in ("Annulé", "Reporté") else title,
                    category=categorize(title, subtitle or "") if categorize(title, subtitle or "") != "autre" else "spectacle",
                    start=start, subtitle=subtitle, price="Complet" if label == "Complet" else price,
                    link=e.get("link") or ticket, ticket=ticket if ticket != e.get("link") else None, image=image))
        if len(items) < 100:
            break
    return out


# ---------------------------------------------------------------- DFCO (ESPN)
async def fetch_dfco(now: datetime) -> list[Event]:
    resp = await client().get(ESPN_DFCO, params={"fixture": "true"})
    resp.raise_for_status()
    out: list[Event] = []
    for e in resp.json().get("events", []):
        comp = (e.get("competitions") or [{}])[0]
        teams = {c.get("homeAway"): c.get("team") or {} for c in comp.get("competitors") or []}
        home, away = teams.get("home") or {}, teams.get("away") or {}
        if str(home.get("id")) != "3170":  # matchs à domicile seulement
            continue
        start = datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(PARIS)
        if start < now - timedelta(hours=4):
            continue
        logo = (away.get("logos") or [{}])[0].get("href") or away.get("logo")
        link = next((l.get("href") for l in e.get("links") or [] if l.get("href")), None)
        league = (e.get("league") or {}).get("abbreviation") or "Ligue 2"
        out.append(_event(
            *STADE, id=f"dfco-{e.get('id')}", title=f"DFCO – {away.get('displayName', '?')}",
            category="sport", start=start, subtitle=f"Football · {league}", price=None,
            link=link or "https://www.dfco.fr", image=logo))
    return out


SOURCES = [("La Vapeur", fetch_vapeur), ("Zénith", fetch_zenith), ("DFCO", fetch_dfco)]


@cached(ttl=TTL)
async def get_programme() -> tuple[list[Event], set[str]]:
    """Événements réels des salles suivies et ensemble des salles effectivement récupérées."""
    now = datetime.now(PARIS)
    results = await asyncio.gather(*(fn(now) for _, fn in SOURCES), return_exceptions=True)
    events: list[Event] = []
    ok: list[str] = []
    failed: list[str] = []
    covered: set[str] = set()
    for (name, _), res, vid in zip(SOURCES, results, (VAPEUR[0], ZENITH[0], STADE[0])):
        if isinstance(res, Exception):
            log.warning("Programmation %s indisponible : %s", name, res)
            failed.append(name)
            continue
        ok.append(f"{name} {len(res)}")
        covered.add(vid)
        events.extend(res)
    status = "live" if ok else "error"
    msg = " · ".join(ok) + (f" — indisponible : {', '.join(failed)}" if failed else "")
    registry.record("venues", status, msg or "Aucune source joignable",
                    endpoint="lavapeur.com · zenith-dijon.fr · ESPN (cache 6 h)")
    return events, covered
