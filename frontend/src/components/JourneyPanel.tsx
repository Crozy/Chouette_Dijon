import { Fragment, type CSSProperties } from 'react'
import { Bus, TrainFront, X } from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { hhmm } from '../format'
import type { BoardEntry, Journey, JourneyStop } from '../types'
import { SourceBadge, Skeleton } from './ui'

const DONE = 'rgb(var(--c-accent))'
const TODO = 'rgb(var(--c-line))'

function journeyUrl(e: BoardEntry) {
  const q = new URLSearchParams({ id: e.journey_id ?? '', delay: String(e.delay_min ?? 0) })
  if (e.base_time) q.set('ref', e.base_time)
  return `/api/transports/journey?${q}`
}

/** Heure affichée : théorique barrée + heure réelle en cas de retard. */
function StopTime({ base, real, delay }: { base?: string | null; real?: string | null; delay: number }) {
  if (!real) return null
  if (delay > 0 && base) {
    return (
      <span className="flex flex-col leading-tight">
        <span className="text-[11px] text-muted line-through">{hhmm(base)}</span>
        <span className="text-sim">{hhmm(real)}</span>
      </span>
    )
  }
  return <span>{hhmm(real)}</span>
}

/** Cadre « parcours du train » : frise verticale des gares déjà desservies et à venir. */
export function JourneyPanel({ entry, onClose, className = '', style }: { entry: BoardEntry; onClose: () => void; className?: string; style?: CSSProperties }) {
  const isTrain = entry.mode === 'train'
  const { data, loading, error } = usePolling<Journey>(entry.journey_id ? journeyUrl(entry) : null, 30000)
  const j = data && data.id === entry.journey_id ? data : null
  const stops = j?.stops ?? []
  // Le train roule entre la dernière gare passée et la suivante
  const movingAfter = stops.findIndex((s, i) => s.state === 'passed' && stops[i + 1]?.state === 'upcoming')
  const notStarted = stops.length > 0 && stops.every((s) => s.state === 'upcoming')
  const arrived = stops.length > 0 && stops.every((s) => s.state === 'passed' || (s === stops[stops.length - 1] && s.state !== 'upcoming'))

  const scheduled = j?.source_status === 'scheduled'
  const statusLabel = j?.cancelled ? 'Supprimé' : j && j.delay_min > 0 ? `Retard +${j.delay_min} min` : scheduled ? 'Horaire prévu' : "À l'heure"
  const statusCls = j?.cancelled ? 'text-danger border-danger/40' : j && j.delay_min > 0 ? 'text-sim border-sim/40' : scheduled ? 'text-accent border-accent/40' : 'text-live border-live/40'

  return (
    <section aria-label={`Parcours du ${isTrain ? 'train' : 'car'} ${entry.number ?? ''}`} style={style} className={`flex flex-col bg-surface border border-ring rounded-xl shadow-2xl overflow-hidden ${className}`}>
      <header className="px-3.5 pt-3 pb-2.5 border-b border-line">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-accent">
              Parcours <SourceBadge status={j?.source_status ?? entry.source_status} />
            </div>
            <div className="t-card mt-0.5 truncate">{entry.operator} <span className="font-mono text-muted text-sm">{entry.number}</span></div>
          </div>
          <button type="button" aria-label="Fermer le parcours" onClick={onClose} className="w-7 h-7 shrink-0 flex items-center justify-center text-muted hover:text-ink"><X size={16} /></button>
        </div>
        {j && (
          <>
            <div className="text-sm text-ink2 mt-1 truncate">{j.origin} → {j.destination}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className={`font-mono text-[11px] font-bold border rounded-full px-2 py-0.5 ${statusCls}`}>{statusLabel}</span>
              <span className="text-[11px] text-muted">
                {j.cancelled ? '' : notStarted ? 'Pas encore parti' : arrived ? 'Arrivé à destination' : 'En circulation'}{scheduled && !j.cancelled ? " (d'après l'horaire)" : ''}
              </span>
            </div>
          </>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3">
        {loading && !j ? (
          <Skeleton h={260} />
        ) : !j ? (
          <p className="m-0 py-6 text-center text-sm text-muted">{error ? 'Parcours indisponible pour ce train.' : 'Chargement…'}</p>
        ) : (
          <ol className="m-0 p-0 list-none" aria-label="Gares desservies">
            {stops.map((s, i) => (
              <Fragment key={`${s.name}-${i}`}>
                <StopRow placeLabel={isTrain ? 'Voie' : 'Quai'} stop={s} first={i === 0} last={i === stops.length - 1}
                  topDone={i > 0 && s.state !== 'upcoming'} bottomDone={i < stops.length - 1 && stops[i + 1].state !== 'upcoming'}
                  cancelled={j.cancelled} />
                {i === movingAfter && !j.cancelled && <MovingRow train={isTrain} from={s.name} to={stops[i + 1].name} />}
              </Fragment>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function Track({ top, bottom, topDone, bottomDone }: { top: boolean; bottom: boolean; topDone: boolean; bottomDone: boolean }) {
  const seg = (done: boolean) => (done ? { background: DONE } : { backgroundImage: `linear-gradient(${TODO} 50%, transparent 0)`, backgroundSize: '3px 8px' })
  return (
    <>
      {top && <span aria-hidden className="absolute left-1/2 -translate-x-1/2 top-0 h-1/2 w-[3px]" style={seg(topDone)} />}
      {bottom && <span aria-hidden className="absolute left-1/2 -translate-x-1/2 top-1/2 bottom-0 w-[3px]" style={seg(bottomDone)} />}
    </>
  )
}

function StopRow({ placeLabel, stop: s, first, last, topDone, bottomDone, cancelled }: {
  placeLabel: string; stop: JourneyStop; first: boolean; last: boolean; topDone: boolean; bottomDone: boolean; cancelled: boolean
}) {
  const passed = s.state === 'passed'
  const current = s.state === 'current'
  const big = s.is_here || first || last
  const dot = current
    ? 'w-4 h-4 bg-surface border-[3px] ring-4 ring-accent/25'
    : passed
      ? `${big ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} border-2`
      : `${big ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} bg-surface border-2`
  const label = current ? 'à quai' : passed ? 'desservie' : 'à venir'
  return (
    <li className="grid grid-cols-[46px_22px_minmax(0,1fr)] gap-x-2 items-stretch">
      <span className={`font-mono text-[13px] font-bold self-center text-right ${passed ? 'text-muted' : 'text-time'}`}>
        <StopTime base={s.base_departure ?? s.base_arrival} real={s.departure ?? s.arrival} delay={s.delay_min} />
      </span>
      <span className="relative flex items-center justify-center min-h-[44px]">
        <Track top={!first} bottom={!last} topDone={topDone} bottomDone={bottomDone} />
        <span aria-hidden className={`relative rounded-full ${dot}`}
          style={{ borderColor: passed || current ? DONE : 'rgb(var(--c-muted))', background: passed ? DONE : undefined }} />
      </span>
      <span className="self-center py-1.5 min-w-0">
        <span className={`block truncate ${s.is_here ? 'font-bold text-ink' : passed ? 'text-muted' : 'text-ink'} ${cancelled ? 'line-through' : ''} ${big ? 'text-sm' : 'text-[13px]'}`}>
          {s.name}
        </span>
        <span className="block text-[11px] text-muted">
          <span className="sr-only">{label} · </span>
          {s.is_here ? `Vous êtes ici${s.platform ? ` · ${placeLabel} ${s.platform}` : ''}` : current ? 'À l’arrêt' : ''}
          {!s.is_here && !current && s.arrival && s.departure ? `${hhmm(s.arrival)} → ${hhmm(s.departure)}` : ''}
        </span>
      </span>
    </li>
  )
}

function MovingRow({ train, from, to }: { train: boolean; from: string; to: string }) {
  return (
    <li className="grid grid-cols-[46px_22px_minmax(0,1fr)] gap-x-2 items-stretch" aria-label={`${train ? 'Train' : 'Car'} en route entre ${from} et ${to}`}>
      <span />
      <span className="relative flex items-center justify-center min-h-[34px]">
        <span aria-hidden className="absolute left-1/2 -translate-x-1/2 top-0 h-1/2 w-[3px]" style={{ background: DONE }} />
        <span aria-hidden className="absolute left-1/2 -translate-x-1/2 top-1/2 bottom-0 w-[3px]" style={{ backgroundImage: `linear-gradient(${TODO} 50%, transparent 0)`, backgroundSize: '3px 8px' }} />
        <span className="relative w-[22px] h-[22px] rounded-full bg-accent text-on-accent flex items-center justify-center shadow">
          {train ? <TrainFront size={13} /> : <Bus size={13} />}
        </span>
      </span>
      <span className="self-center text-[12px] font-semibold text-accent">En route</span>
    </li>
  )
}
