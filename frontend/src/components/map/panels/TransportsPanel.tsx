import { Bike, Bus, TrainFront } from 'lucide-react'
import type { ApiResponse, MeetingPoint, SourceMeta, VelodiStation } from '../../../types'
import { SourceBadge } from '../../ui'

export interface ActiveLine {
  line: string
  route_id: string
  mode: 'tram' | 'bus'
  color: string
  text: string
  n: number
  headsigns: Set<string>
}

/** Panneau Transports : gares, lignes en service, Vélodi, covoiturage. */
export function TransportsContent({ lines, counts, vehiclesMeta, selectedLine, onLine, onStation, velodi, points }: {
  lines: ActiveLine[]
  counts: { tram: number; bus: number }
  vehiclesMeta?: SourceMeta | null
  selectedLine: string | null
  onLine: (l: ActiveLine) => void
  onStation: (kind: 'gare' | 'cars') => void
  velodi: ApiResponse<VelodiStation[]> | null
  points: ApiResponse<MeetingPoint[]> | null
}) {
  const bikes = velodi?.data.reduce((s, x) => s + x.bikes, 0)
  const docks = velodi?.data.reduce((s, x) => s + x.docks, 0)
  const carpool = points?.data.filter((p) => p.kind === 'carpool') ?? []

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onStation('gare')} className="inner p-3 flex flex-col items-start gap-1 text-left hover:ring-1 hover:ring-accent">
          <TrainFront size={18} className="text-accent" aria-hidden />
          <span className="text-sm font-semibold">Gare SNCF</span>
          <span className="text-[11px] text-muted">Départs, arrivées, parcours</span>
        </button>
        <button type="button" onClick={() => onStation('cars')} className="inner p-3 flex flex-col items-start gap-1 text-left hover:ring-1 hover:ring-accent">
          <Bus size={18} className="text-[#73D700]" aria-hidden />
          <span className="text-sm font-semibold">Gare routière</span>
          <span className="text-[11px] text-muted">FlixBus, BlaBlaCar Bus</span>
        </button>
      </div>

      <section className="flex flex-col gap-1.5" aria-label="Lignes en service">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-semibold">Lignes en service</h3>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="font-mono">{counts.tram} trams · {counts.bus} bus</span> <SourceBadge meta={vehiclesMeta} />
          </span>
        </div>
        <p className="m-0 text-[11px] text-muted">Touchez une ligne pour voir son parcours sur la carte.</p>
        <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
          {lines.length === 0 && <li className="py-3 text-sm text-muted">Aucun véhicule en service pour le moment.</li>}
          {lines.map((l) => {
            const on = selectedLine === l.line
            return (
              <li key={l.line}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onLine(l)}
                  className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left border ${on ? 'bg-accent/15 border-accent' : 'border-transparent hover:bg-surface2'}`}
                >
                  <span className={`shrink-0 min-w-[34px] h-[24px] px-1.5 flex items-center justify-center font-mono text-[11px] font-bold ${l.mode === 'tram' ? 'rounded-md' : 'rounded-full'}`}
                    style={{ background: l.color, color: l.text }}>{l.line}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13px] text-ink">{l.headsigns.size ? [...l.headsigns].join(' · ') : '—'}</span>
                    <span className="block text-[11px] text-muted">{l.mode === 'tram' ? 'Tram' : 'Bus'} · {l.n} en service</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="inner p-3 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-semibold flex items-center gap-1.5"><Bike size={16} aria-hidden /> Vélodi</h3>
          <SourceBadge meta={velodi?.meta} />
        </div>
        <p className="m-0 text-[13px] text-ink2">
          <span className="font-mono font-bold">{bikes ?? '—'}</span> vélos disponibles · <span className="font-mono font-bold">{docks ?? '—'}</span> bornettes libres
          <span className="text-muted"> · {velodi?.data.length ?? 0} stations</span>
        </p>
      </section>

      {carpool.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-sm font-semibold">Rendez-vous covoiturage</h3>
          {carpool.map((p) => (
            <div key={p.id} className="inner p-2.5">
              <div className="text-[13px] font-semibold">{p.name.replace('RDV covoiturage — ', '')}</div>
              <div className="text-xs text-muted mt-0.5">{p.description}</div>
            </div>
          ))}
        </section>
      )}
    </>
  )
}
