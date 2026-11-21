import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { usePolling } from '../../../hooks/usePolling'
import { dayNum, dayShort, hhmm, monthShort } from '../../../format'
import type { ApiResponse, EventCategory, HubEvent } from '../../../types'
import { EventImage, Empty, Skeleton } from '../../ui'
import { CATEGORY_COLOR as TINT, CATEGORY_LABEL } from '../../../pages/shared'
import { Panel } from '../Panel'
import type { PanelProps } from './types'

const RANGES: [number, string][] = [[1, 'Demain'], [3, 'Week-end'], [7, '7 j'], [30, '30 j'], [365, 'Tout']]

export function EventsPanel({ onClose, style, className, onLocate, selectedId }: PanelProps & {
  /** Clic sur un événement localisé : le placer sur la carte */
  onLocate?: (e: HubEvent) => void
  selectedId?: string | null
}) {
  const { data, loading } = usePolling<ApiResponse<HubEvent[]>>('/api/events', 1800000)
  const [cat, setCat] = useState<'all' | EventCategory>('all')
  const [range, setRange] = useState(30)
  const limit = Date.now() + range * 86400000 + 86400000
  const events = (data?.data ?? []).filter((e) => (cat === 'all' || e.category === cat) && new Date(e.start).getTime() <= limit)
  const cats = ['all', ...Object.keys(CATEGORY_LABEL)] as ('all' | EventCategory)[]

  return (
    <Panel title="Agenda" subtitle="Sorties culturelles et sportives · OpenAgenda" meta={data?.meta} onClose={onClose} style={style} className={className}>
      <div className="flex border border-line rounded-lg overflow-hidden" role="group" aria-label="Période">
        {RANGES.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)}
            className={`flex-1 h-8 text-xs font-medium ${range === k ? 'bg-accent text-on-accent' : 'bg-bg text-muted hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 -mt-1">
        {cats.map((c) => (
          <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}
            className={`pill shrink-0 whitespace-nowrap ${cat === c ? 'pill-on' : 'pill-off'}`}>
            {c === 'all' ? 'Tout' : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      {loading && !data ? <Skeleton h={360} /> : events.length === 0 ? (
        <Empty>Aucun événement dans cette catégorie pour la période choisie.</Empty>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          <li className="text-[11px] text-muted -mb-0.5">Touchez un événement pour voir son lieu sur la carte.</li>
          {events.map((e) => {
            const located = e.lat != null && e.lon != null
            const on = selectedId === e.id
            return (
            <li key={e.id}>
              <button
                type="button"
                disabled={!located || !onLocate}
                aria-pressed={on}
                onClick={() => onLocate?.(e)}
                title={located ? 'Voir le lieu sur la carte' : 'Lieu non localisé'}
                className={`inner w-full text-left flex gap-3 items-stretch overflow-hidden !p-0 enabled:cursor-pointer enabled:hover:ring-1 enabled:hover:ring-accent ${on ? 'ring-2 ring-accent' : ''}`}
              >
              <div className="w-[58px] shrink-0 flex flex-col items-center justify-center text-white py-2" style={{ background: TINT[e.category] }}>
                <span className="font-mono text-[10px] uppercase opacity-90">{dayShort(e.start)}</span>
                <span className="t-big leading-none" style={{ fontSize: 'calc(22px * var(--ds-big))' }}>{dayNum(e.start)}</span>
                <span className="font-mono text-[10px] opacity-90">{monthShort(e.start)}</span>
              </div>
              <div className="flex-1 min-w-0 py-2 pr-2 flex flex-col gap-0.5">
                <span className="text-[11px] font-bold tracking-wide uppercase truncate" style={{ color: TINT[e.category] }}>
                  {CATEGORY_LABEL[e.category]}{e.subtitle ? <span className="normal-case font-semibold"> · {e.subtitle}</span> : null}
                </span>
                <span className="text-[14px] font-semibold leading-snug">
                  {e.title}
                </span>
                <span className="text-xs text-muted truncate flex items-center gap-1">
                  {located && <MapPin size={12} className="shrink-0 text-accent" aria-hidden />}
                  <span className="truncate">{e.venue} · <span className="font-mono">{hhmm(e.start)}</span>{e.price ? ` · ${e.price}` : ''}</span>
                </span>
              </div>
              {e.image && <EventImage src={e.image} className="w-[64px] shrink-0 self-stretch" />}
              </button>
            </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
