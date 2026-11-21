import { usePolling } from '../../../hooks/usePolling'
import { dayLong, hhmm } from '../../../format'
import type { ApiResponse, HubEvent, Venue } from '../../../types'
import { EventImage, Empty, Skeleton } from '../../ui'
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../../../pages/shared'
import { Panel } from '../Panel'
import type { PanelProps } from './types'

const KIND_LABEL: Record<Venue['kind'], string> = { salle: 'Salle de spectacle', sport: 'Équipement sportif', expo: "Lieu d'exposition" }

/** Jour (Europe/Paris) au format AAAA-MM-JJ, pour regrouper « aujourd'hui » / « plus tard ». */
const parisDay = (d: Date) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })

function EventRow({ e, showDate }: { e: HubEvent; showDate: boolean }) {
  const d = new Date(e.start)
  const when = showDate
    ? `${dayLong(e.start).slice(0, 3)}. ${d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' })} · ${hhmm(e.start)}`
    : hhmm(e.start)
  return (
    <li className="inner overflow-hidden !p-0 flex">
      {e.image
        ? <EventImage src={e.image} className="w-[92px] shrink-0 self-stretch min-h-[92px]" />
        : <div className="w-[6px] shrink-0" style={{ background: CATEGORY_COLOR[e.category] }} aria-hidden />}
      <div className="flex-1 min-w-0 p-3 flex flex-col gap-0.5">
        <span className="font-mono text-[13px] font-bold text-time">{when}</span>
        <span className="text-[14px] font-semibold leading-snug">{e.title}</span>
        <span className="text-[11px] font-semibold" style={{ color: CATEGORY_COLOR[e.category] }}>
          {e.subtitle ?? CATEGORY_LABEL[e.category]}
        </span>
        <span className="text-xs text-muted">
          {e.price ?? 'Tarif non communiqué'}
          {e.link && <> · <a href={e.link} target="_blank" rel="noreferrer" className="text-accent font-semibold">Infos ↗</a></>}
          {e.ticket && <> · <a href={e.ticket} target="_blank" rel="noreferrer" className="text-accent font-semibold">Billetterie ↗</a></>}
        </span>
      </div>
    </li>
  )
}

/** Programmation d'une salle : aujourd'hui, puis plus tard. */
export function VenuePanel({ venue, onClose, style, className }: PanelProps & { venue: Venue | null; venueId: string }) {
  const { data, loading } = usePolling<ApiResponse<HubEvent[]>>('/api/events', 1800000)
  const today = parisDay(new Date())
  const now = Date.now()
  const all = (data?.data ?? [])
    .filter((e) => venue && e.venue_id === venue.id && new Date(e.start).getTime() > now - 4 * 3600000)
    .sort((a, b) => a.start.localeCompare(b.start))
  // Badge : « LIVE » si la salle a sa vraie programmation, sinon l'état de l'agenda général
  const real = all.some((e) => e.source_status === 'live')
  const sourceSite = venue?.id === 'la-vapeur' ? 'lavapeur.com' : venue?.id === 'zenith-de-dijon' ? 'zenith-dijon.fr'
    : venue?.id === 'stade-gaston-gerard' ? 'ESPN (calendrier du DFCO)' : null
  const todays = all.filter((e) => parisDay(new Date(e.start)) === today)
  const later = all.filter((e) => parisDay(new Date(e.start)) > today)

  return (
    <Panel
      title={venue?.name ?? 'Lieu'}
      subtitle={venue ? `${KIND_LABEL[venue.kind]} · programmation` : undefined}
      meta={real ? null : data?.meta}
      status={real ? 'live' : undefined}
      onClose={onClose}
      style={style}
      className={className}
    >
      {loading && !data ? <Skeleton h={260} /> : !venue ? <Empty>Lieu inconnu.</Empty> : (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold">Aujourd'hui</h3>
            {todays.length === 0
              ? <p className="m-0 text-[13px] text-muted">Rien de programmé aujourd'hui.</p>
              : <ul className="m-0 p-0 list-none flex flex-col gap-2">{todays.map((e) => <EventRow key={e.id} e={e} showDate={false} />)}</ul>}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold">Plus tard</h3>
            {later.length === 0
              ? <p className="m-0 text-[13px] text-muted">Aucun autre événement connu dans l'agenda.</p>
              : <ul className="m-0 p-0 list-none flex flex-col gap-2">{later.map((e) => <EventRow key={e.id} e={e} showDate />)}</ul>}
          </section>
          {real && sourceSite && (
            <p className="m-0 text-[11px] text-muted">Programmation officielle du lieu · source : {sourceSite} · mise à jour toutes les 6 h</p>
          )}
          {!real && data?.meta.status !== 'live' && (
            <p className="m-0 text-[11px] text-muted">
              Agenda de démonstration : configurez OpenAgenda (<code className="font-mono">OPENAGENDA_KEY</code>) pour la vraie programmation.
            </p>
          )}
        </>
      )}
    </Panel>
  )
}
