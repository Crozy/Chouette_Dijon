import { useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { hhmm } from '../format'
import type { Board, BoardEntry } from '../types'
import { SourceBadge, Skeleton } from './ui'

const STATUS: Record<BoardEntry['status'], string> = {
  on_time: 'text-live',
  delayed: 'text-sim',
  boarding: 'text-accent',
  cancelled: 'text-danger line-through',
  info: 'text-live',
}

export type StationKind = 'train' | 'coach'

const KIND = {
  train: { label: 'Gare SNCF', source: 'sncf', noun: 'train', place: 'Voie', modes: ['train'] },
  coach: { label: 'Gare routière', source: 'coach', noun: 'car', place: 'Quai', modes: ['flixbus', 'blablacar'] },
} as const

/** Cadre « Départs / Arrivées » d'une gare (SNCF ou routière), affiché sur la carte. */
export function StationBoard({ kind = 'train', title, onClose, onSelect, selectedId, className = '', style }: {
  kind?: StationKind
  title: string
  onClose: () => void
  /** Clic sur un train : affiche son parcours. */
  onSelect?: (e: BoardEntry) => void
  selectedId?: string | null
  className?: string
  style?: CSSProperties
}) {
  const [direction, setDirection] = useState<'departures' | 'arrivals'>('departures')
  const { data, loading, error } = usePolling<Board>(`/api/transports/board?direction=${direction}`, 60000)
  const k = KIND[kind]
  // Gare routière : cars FlixBus / BlaBlaCar Bus uniquement (le covoiturage a ses propres points de RDV)
  const trains = (data?.direction === direction ? data.entries : [])
    .filter((e) => (k.modes as readonly string[]).includes(e.mode) && e.operator !== 'Covoiturage')
  const sncf = data?.sources.find((s) => s.source === k.source)

  return (
    <section
      aria-label={`Départs et arrivées — ${title}`}
      style={style}
      className={`flex flex-col bg-surface border border-ring rounded-xl shadow-2xl overflow-hidden ${className}`}
    >
      <header className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-accent">
            {k.label} <SourceBadge meta={sncf} />
          </div>
          <div className="t-card mt-0.5 truncate">{title}</div>
        </div>
        <button type="button" aria-label="Fermer" onClick={onClose} className="w-7 h-7 shrink-0 flex items-center justify-center text-muted hover:text-ink"><X size={16} /></button>
      </header>

      <div role="tablist" aria-label="Sens" className="mx-3.5 mb-2 grid grid-cols-2 border border-line rounded-lg overflow-hidden bg-bg">
        {(['departures', 'arrivals'] as const).map((d) => (
          <button
            key={d}
            role="tab"
            type="button"
            aria-selected={direction === d}
            onClick={() => setDirection(d)}
            className={`h-8 font-mono text-[11px] font-bold tracking-[0.1em] ${direction === d ? 'bg-time text-bg' : 'text-muted hover:text-ink'}`}
          >
            {d === 'departures' ? 'DÉPARTS' : 'ARRIVÉES'}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-board border-t border-line">
        {loading && trains.length === 0 ? (
          <div className="p-3"><Skeleton h={200} /></div>
        ) : error && trains.length === 0 ? (
          <p className="m-0 p-5 text-center text-sm text-muted">Horaires indisponibles pour le moment.</p>
        ) : trains.length === 0 ? (
          <p className="m-0 p-5 text-center text-sm text-muted">Aucun {k.noun} {direction === 'departures' ? 'au départ' : "à l'arrivée"} prochainement.</p>
        ) : (
          <ul className="m-0 p-0 list-none">
            {trains.map((e, i) => (
              <li key={e.id} className="border-b border-line/60">
                <button
                  type="button"
                  disabled={!e.journey_id || !onSelect}
                  aria-pressed={selectedId === e.id}
                  aria-label={`${e.operator} ${e.number ?? ''} ${direction === 'departures' ? 'vers' : 'de'} ${e.place}, ${hhmm(e.time)} — voir le parcours`}
                  onClick={() => onSelect?.(e)}
                  className={`w-full text-left grid grid-cols-[48px_minmax(0,1fr)_auto] gap-x-2.5 items-center px-3.5 py-2 enabled:cursor-pointer enabled:hover:bg-accent/10 ${selectedId === e.id ? 'bg-accent/15 shadow-[inset_3px_0_0_rgb(var(--c-accent))]' : i % 2 ? 'bg-board-alt' : ''}`}
                >
                <span className="font-mono font-bold text-time text-[15px]">{hhmm(e.time)}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold truncate">{e.place}</span>
                  <span className="block text-[11px] text-muted truncate">
                    {e.operator}{e.number ? ` ${e.number}` : ''}{e.via ? ` · ${e.via}` : ''}
                  </span>
                  <span className={`block font-mono text-[11px] font-bold ${STATUS[e.status]}`}>{e.status_label}</span>
                </span>
                <span className="flex flex-col items-center">
                  <span className="text-[9px] uppercase tracking-wider text-muted">{k.place}</span>
                  <span className="min-w-[30px] text-center font-mono font-bold text-sm border border-ring rounded-md px-1 py-0.5 bg-surface text-time">{e.platform ?? '—'}</span>
                </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {kind === 'coach' && sncf?.status === 'scheduled' && (
        <p className="m-0 px-3.5 py-1.5 text-[10px] text-muted border-t border-line">
          Horaires prévus par les opérateurs, sans retards en temps réel · Données FlixBus et BlaBlaCar Bus (ODbL, transport.data.gouv.fr)
        </p>
      )}
    </section>
  )
}
