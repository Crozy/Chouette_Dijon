"""Alertes trafic (GTFS-RT Service Alerts si configuré) et numéros utiles."""
import logging

from google.transit import gtfs_realtime_pb2

from app.cache import cached
from app.config import get_settings
from app.fallback.data import ALERTS, NUMBERS
from app.models import Alert, Infos, SourceMeta, UsefulNumber
from app.services import gtfs_static, registry
from app.services.http import client

log = logging.getLogger(__name__)

EFFECT_LEVEL = {
    gtfs_realtime_pb2.Alert.DETOUR: "deviation",
    gtfs_realtime_pb2.Alert.REDUCED_SERVICE: "perturbation",
    gtfs_realtime_pb2.Alert.SIGNIFICANT_DELAYS: "perturbation",
    gtfs_realtime_pb2.Alert.NO_SERVICE: "perturbation",
    gtfs_realtime_pb2.Alert.STOP_MOVED: "deviation",
}


def _text(ts) -> str:
    for t in ts.translation:
        if t.language in ("fr", ""):
            return t.text
    return ts.translation[0].text if ts.translation else ""


def decode_alerts(payload: bytes) -> list[Alert]:
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(payload)
    out = []
    for ent in feed.entity:
        if not ent.HasField("alert"):
            continue
        a = ent.alert
        lines = []
        for ie in a.informed_entity:
            r = gtfs_static.STATE.routes.get(ie.route_id)
            if r and r.short_name not in lines:
                lines.append(r.short_name)
        out.append(Alert(id=ent.id, level=EFFECT_LEVEL.get(a.effect, "info"), scope=" · ".join(lines) or "Réseau",
                         title=_text(a.header_text) or "Information trafic", text=_text(a.description_text)))
    return out


def numbers() -> list[UsefulNumber]:
    return [UsefulNumber(label=label, number=num, emergency=em) for label, num, em in NUMBERS]


@cached(ttl=120)
async def get_infos() -> tuple[SourceMeta, Infos]:
    s = get_settings()
    fallback = [Alert(id=f"demo-{i}", level=lvl, scope=scope, title=title, text=text, period=period)
                for i, (lvl, scope, title, text, period) in enumerate(ALERTS)]
    if not s.divia_gtfs_rt_alerts_url or s.force_demo:
        msg = "Mode démo forcé" if s.force_demo else "Flux d'alertes non configuré — alertes d'exemple"
        return registry.record("alerts", "simulated", msg), Infos(alerts=fallback, numbers=numbers())
    try:
        with registry.timer() as t:
            resp = await client().get(s.divia_gtfs_rt_alerts_url)
            resp.raise_for_status()
        alerts = decode_alerts(resp.content)
        return registry.record("alerts", "live", f"{len(alerts)} alerte(s)", t.ms, s.divia_gtfs_rt_alerts_url), \
            Infos(alerts=alerts, numbers=numbers())
    except Exception as exc:  # noqa: BLE001
        log.warning("Alertes Divia indisponibles : %s", exc)
        return registry.record("alerts", "simulated", f"Flux indisponible ({exc.__class__.__name__})",
                               endpoint=s.divia_gtfs_rt_alerts_url), Infos(alerts=fallback, numbers=numbers())
