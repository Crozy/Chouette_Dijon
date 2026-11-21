"""Tests : décodage réel GTFS-RT Divia et Open-Meteo (ignorés si hors-ligne) + fallbacks."""
import socket

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import coach, gtfs_rt, sncf, velodi


def online(host: str) -> bool:
    try:
        socket.create_connection((host, 443), timeout=3).close()
        return True
    except OSError:
        return False


@pytest.fixture(scope="module")
def api():
    with TestClient(app) as c:
        yield c


@pytest.mark.skipif(not online("proxy.transport.data.gouv.fr"), reason="hors-ligne")
def test_divia_gtfs_rt_live(api):
    r = api.get("/api/transports/vehicles")
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["status"] == "live", body["meta"]
    for v in body["data"]:
        assert 47.0 < v["lat"] < 47.6 and 4.8 < v["lon"] < 5.3
        assert v["mode"] in ("tram", "bus") and v["color"].startswith("#")


@pytest.mark.skipif(not online("api.open-meteo.com"), reason="hors-ligne")
def test_open_meteo_live(api):
    body = api.get("/api/weather").json()
    assert body["meta"]["status"] == "live", body["meta"]
    assert len(body["data"]["daily"]) == 7
    assert body["data"]["hourly"]
    assert body["data"]["air"]["level"]


def test_board_merges_sources(api):
    body = api.get("/api/transports/board?direction=departures").json()
    modes = {e["mode"] for e in body["entries"]}
    assert {"train", "flixbus", "blablacar", "velodi"} <= modes
    assert body["entries"] == sorted(body["entries"][:-1], key=lambda e: e["time"]) + body["entries"][-1:]


def test_arrivals_board(api):
    body = api.get("/api/transports/board?direction=arrivals").json()
    assert body["direction"] == "arrivals" and body["entries"]


def test_other_endpoints(api):
    for path in ["/api/news", "/api/news/social", "/api/events", "/api/infos", "/api/transports/velodi",
                 "/api/transports/meeting-points", "/api/transports/lines", "/api/transports/stops", "/api/transports/traffic", "/api/transports/crowd", "/api/status", "/api/health"]:
        assert api.get(path).status_code == 200, path


def test_fallbacks_are_realistic():
    assert len(gtfs_rt.simulated_vehicles()) > 10
    stations = velodi.simulated_stations()
    assert all(0 <= s.bikes <= s.capacity for s in stations)
    deps = sncf.simulated_trains("departures")
    assert deps and all(e.platform in list("ABCDEFG") for e in deps)
    assert coach.coach_entries("departures")


def test_train_journey(api):
    entry = next(e for e in api.get("/api/transports/board?direction=departures").json()["entries"] if e["mode"] == "train")
    assert entry["journey_id"]
    j = api.get("/api/transports/journey", params={"id": entry["journey_id"]}).json()
    assert len(j["stops"]) >= 2
    assert sum(s["is_here"] for s in j["stops"]) == 1
    assert api.get("/api/transports/journey", params={"id": "sim:x:0:bad"}).status_code == 404


def test_crowd_is_an_estimate(api):
    d = api.get("/api/transports/crowd").json()["data"]
    assert d["estimated"] is True and "estimation" in d["method"].lower()
    assert d["zones"] and d["points"]
    assert all(0 <= z["score"] <= 1 for z in d["zones"])


def test_traffic_without_key_is_estimated(api, monkeypatch):
    from app.config import get_settings
    from app.cache import clear_cache
    monkeypatch.setattr(get_settings(), "tomtom_api_key", "")
    clear_cache()
    d = api.get("/api/transports/traffic").json()
    assert d["data"]["mode"] == "estimated" and d["meta"]["status"] == "simulated"
    assert api.get("/api/transports/traffic/tiles/12/2120/1460.png").status_code == 404


def test_coach_journey(api):
    entries = api.get("/api/transports/board?direction=arrivals").json()["entries"]
    entry = next(e for e in entries if e["mode"] in ("flixbus", "blablacar") and e["journey_id"])
    j = api.get("/api/transports/journey", params={"id": entry["journey_id"]}).json()
    here = [s for s in j["stops"] if s["is_here"]]
    assert len(here) == 1
    if entry["platform"].startswith("Q"):  # quai connu (horaires simulés)
        assert here[0]["platform"] == entry["platform"]


def test_coach_gtfs_parsing():
    """Mini-flux GTFS : seules les courses desservant Dijon sont gardées, avec leur parcours."""
    import io
    import zipfile
    from datetime import datetime
    from app.services import coach_gtfs
    files = {
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nD,Dijon (Bus Station),47.3235,5.0279\nL,Lyon,45.75,4.85\nP,Paris,48.84,2.38\n",
        "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type\nR,FLIXBUS-eu,FlixBus N1,Paris - Lyon,3\n",
        "trips.txt": "route_id,service_id,trip_id\nR,S,T1\nR,S,T2\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                          "T1,08:00:00,08:00:00,P,1\nT1,11:00:00,11:10:00,D,2\nT1,13:00:00,13:00:00,L,3\n"
                          "T2,08:00:00,08:00:00,P,1\nT2,12:00:00,12:00:00,L,2\n",
        "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS,1,1,1,1,1,1,1,20200101,20991231\n",
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    feed = coach_gtfs.parse_feed(buf.getvalue(), "flixbus")
    assert [t.trip_id for t in feed.trips] == ["T1"]
    saved = dict(coach_gtfs.FEEDS)
    coach_gtfs.FEEDS.clear()
    coach_gtfs.FEEDS["flixbus"] = feed
    try:
        now = datetime(2026, 11, 20, 9, 0, tzinfo=coach_gtfs.PARIS)
        dep = [e for e in coach_gtfs.entries("departures", now) if e.journey_id and ":T1" in e.journey_id][0]
        assert dep.place == "Lyon" and dep.time.hour == 11 and dep.time.minute == 10 and dep.source_status == "scheduled"
        j = coach_gtfs.journey(dep.journey_id, now)
        assert [s.name for s in j.stops] == ["Paris", "Dijon (Bus Station)", "Lyon"] and j.stops[1].is_here
    finally:
        coach_gtfs.FEEDS.clear()
        coach_gtfs.FEEDS.update(saved)


def test_events_have_positions():
    from app.services import events
    evs = events.simulated_events()
    assert evs and all(e.lat is not None and e.lon is not None for e in evs)
    assert all(e.location_approx for e in evs)
    assert events.venue_position("Lieu inconnu") is None


def test_venues_and_programme(api):
    venues = api.get("/api/events/venues").json()["data"]
    ids = {v["id"] for v in venues}
    assert {"la-vapeur", "zenith-de-dijon"} <= ids and len(ids) == len(venues)
    evs = api.get("/api/events").json()["data"]
    assert any(e["venue_id"] == "la-vapeur" for e in evs)


def test_venue_programme_parsers(monkeypatch):
    """Analyse des réponses des trois sources (sans réseau)."""
    import asyncio
    from datetime import datetime
    from app.services import venues_programme as vp

    class R:
        def __init__(self, data, code=200): self._d, self.status_code = data, code
        def json(self): return self._d
        def raise_for_status(self): pass

    vapeur = {"data": {"programmes": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": [{
        "databaseId": 1, "title": "Bedouine", "uri": "/programme/bedouine/", "typesEvenements": {"nodes": [{"name": "Concerts"}]},
        "fieldsEvenement": {"sousTitre": "Folk", "imagePrincipale": {"srcSet": "https://x/a-300.jpg 300w, https://x/a-1024.jpg 1024w"},
            "dates": [{"dateDebut": "2027-02-05T00:00:00+00:00", "heureDebut": "20:30", "statut": None}],
            "tarifs": [{"prix": "15 €", "titre": ["Préventes"]}]}}]}}}
    zenith = [{"id": 9, "title": {"rendered": "FOREVER 90&rsquo;S"}, "link": "https://z/e/", "acf": {
        "subtitle": "Tournée", "image_cover": {"sizes": {"large": "https://z/i.jpg"}},
        "sessions": [{"session_date": "2027-10-29 20:00:00", "status_event": "on_sale", "ticketing": {"url_official": "https://z/t"}}]}}]
    espn = {"events": [
        {"id": "1", "date": "2026-12-04T19:00Z", "links": [{"href": "https://espn/m1"}], "competitions": [{"competitors": [
            {"homeAway": "home", "team": {"id": "3170", "displayName": "Dijon FCO"}},
            {"homeAway": "away", "team": {"id": "272", "displayName": "Sochaux", "logos": [{"href": "https://l/272.png"}]}}]}]},
        {"id": "2", "date": "2026-12-11T19:00Z", "competitions": [{"competitors": [
            {"homeAway": "home", "team": {"id": "9", "displayName": "Guingamp"}},
            {"homeAway": "away", "team": {"id": "3170", "displayName": "Dijon FCO"}}]}]}]}

    class C:
        async def post(self, url, json=None): return R(vapeur)
        async def get(self, url, params=None): return R(zenith if "zenith" in url else espn)
    monkeypatch.setattr(vp, "client", lambda: C())
    now = datetime(2026, 11, 21, 12, tzinfo=vp.PARIS)
    v = asyncio.run(vp.fetch_vapeur(now))[0]
    assert (v.title, v.start.hour, v.start.minute, v.venue_id) == ("Bedouine", 20, 30, "la-vapeur")
    assert v.image == "https://x/a-1024.jpg" and v.link == "https://www.lavapeur.com/programme/bedouine/" and v.category == "concert"
    z = asyncio.run(vp.fetch_zenith(now))[0]
    assert z.title == "FOREVER 90’S" and z.image == "https://z/i.jpg" and z.ticket == "https://z/t"
    d = asyncio.run(vp.fetch_dfco(now))
    assert len(d) == 1 and d[0].title == "DFCO – Sochaux" and d[0].image == "https://l/272.png"
