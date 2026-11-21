import { AlertTriangle } from 'lucide-react'
import type { AntennaData, AntennaStation, ApiResponse } from '../../../types'
import { Skeleton, SourceBadge } from '../../ui'
import { Panel } from '../Panel'
import { OPERATOR_COLORS as OPERATOR_COLOR } from '../layers'
import type { PanelProps } from './types'

export const OPERATORS = ['Orange', 'SFR', 'Bouygues Telecom', 'Free'] as const
export const GENERATIONS = ['2G', '3G', '4G', '5G'] as const

export interface AntennaFilter {
  ops: string[]
  gens: string[]
  outagesOnly: boolean
}

const frDate = (iso?: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

/** La station correspond-elle aux filtres (au moins un opérateur ET une génération cochés) ? */
export function matches(st: AntennaStation, f: AntennaFilter) {
  if (f.outagesOnly && st.outages.length === 0) return false
  return st.operators.some((o) => f.ops.includes(o.name) && o.generations.some((g) => f.gens.includes(g)))
}

function Toggle({ on, onClick, color, children }: { on: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`pill shrink-0 whitespace-nowrap flex items-center gap-1.5 ${on ? 'pill-on' : 'pill-off'}`}>
      {color && <span className="w-2 h-2 rounded-full" style={{ background: color, opacity: on ? 1 : 0.35 }} />}
      {children}
    </button>
  )
}

/** Section « Antennes » : filtres, chiffres, pannes déclarées et fraîcheur des données. */
export function AntennasPanel({ onClose, style, className, data, filter, onFilter, onFocus }: PanelProps & {
  data: ApiResponse<AntennaData> | null
  filter: AntennaFilter
  onFilter: (f: AntennaFilter) => void
  onFocus: (st: AntennaStation) => void
}) {
  const d = data?.data
  const shown = d?.stations.filter((s) => matches(s, filter)) ?? []
  const emitters = (name: string) => d?.stations.filter((s) => s.operators.some((o) => o.name === name)).length ?? 0
  const withGen = (g: string) => d?.stations.filter((s) => s.operators.some((o) => o.generations.includes(g))).length ?? 0
  const outages = d?.stations.filter((s) => s.outages.length > 0) ?? []
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <Panel title="Antennes mobiles" subtitle="Dijon et 15 km autour · Orange, SFR, Bouygues, Free" meta={data?.meta}
      onClose={onClose} style={style} className={className}>
      {!d ? <Skeleton h={320} /> : (
        <>
          <section className="flex flex-col gap-2" aria-label="Filtres">
            <div className="flex flex-wrap gap-1.5">
              {OPERATORS.map((o) => (
                <Toggle key={o} on={filter.ops.includes(o)} color={OPERATOR_COLOR[o]} onClick={() => onFilter({ ...filter, ops: flip(filter.ops, o) })}>
                  {o === 'Bouygues Telecom' ? 'Bouygues' : o} <span className="font-mono text-muted">{emitters(o)}</span>
                </Toggle>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GENERATIONS.map((g) => (
                <Toggle key={g} on={filter.gens.includes(g)} color={g === '5G' ? '#8B5CF6' : undefined} onClick={() => onFilter({ ...filter, gens: flip(filter.gens, g) })}>
                  {g} <span className="font-mono text-muted">{withGen(g)}</span>
                </Toggle>
              ))}
              <Toggle on={filter.outagesOnly} color="#DC2626" onClick={() => onFilter({ ...filter, outagesOnly: !filter.outagesOnly })}>
                Pannes seulement
              </Toggle>
            </div>
            <p className="m-0 text-[12px] text-muted">
              <span className="font-mono font-bold text-ink">{shown.length}</span> station{shown.length > 1 ? 's' : ''} affichée{shown.length > 1 ? 's' : ''} sur {d.stations.length}.
              Les chiffres indiquent le nombre de stations par opérateur et par génération.
            </p>
          </section>

          <section className="inner p-3 flex flex-col gap-1.5" aria-label="Légende">
            <h3 className="m-0 text-sm font-semibold">Légende</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-ink2">
              {OPERATORS.map((o) => (
                <span key={o} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border border-[#111827]" style={{ background: OPERATOR_COLOR[o] }} />{o}
                </span>
              ))}
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full border border-[#111827] flex items-center justify-center" style={{ background: OPERATOR_COLOR.Orange }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: OPERATOR_COLOR.Free }} />
                </span>Antenne partagée
              </span>
              <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#64748B] border-2 border-[#8B5CF6]" />avec 5G</span>
              <span className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full border-[3px] border-[#DC2626]" />Incident</span>
              <span className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full border-[3px] border-[#FACC15]" />Maintenance</span>
            </div>
            <span className="text-[11px] text-muted">Une antenne partagée par plusieurs opérateurs est dessinée en anneaux, un par opérateur.</span>
          </section>

          <section className="flex flex-col gap-2" aria-label="Pannes déclarées">
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold">Pannes et maintenances déclarées</h3>
              <SourceBadge status={d.outages_date ? 'live' : 'error'} />
            </div>
            {outages.length === 0 ? (
              <p className="m-0 text-[13px] text-muted">Aucune antenne déclarée en panne dans la zone.</p>
            ) : (
              <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                {outages.map((st) => st.outages.map((o, i) => (
                  <li key={`${st.id}-${i}`}>
                    <button type="button" onClick={() => onFocus(st)}
                      className="inner w-full text-left p-2.5 flex gap-2.5 items-start hover:ring-1 hover:ring-accent">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: o.kind === 'incident' ? '#DC2626' : '#F59E0B' }} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold">{o.operator} · {o.kind === 'incident' ? 'Incident' : 'Maintenance'}</span>
                        <span className="block text-[12px] text-muted truncate">{[st.address, o.commune].filter(Boolean).join(' · ')}</span>
                        <span className="block text-[11px] text-muted">
                          Voix {o.voice ?? '?'} · Data {o.data ?? '?'}{o.end ? ` · fin prévue ${frDate(o.end)}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                )))}
              </ul>
            )}
          </section>

          <section className="text-[11px] text-muted flex flex-col gap-1 border-t border-line pt-3">
            <span><b className="text-ink2">Antennes</b> : registre officiel de l'ANFR du {frDate(d.registry_date)} (mis à jour chaque semaine).</span>
            <span><b className="text-ink2">Pannes</b> : déclarées par les opérateurs à l'Arcep, fichier du {frDate(d.outages_date)}. Publication quotidienne avec 1 à 3 jours de décalage : <b>ce n'est pas du temps réel</b>.</span>
            <span>
              Pour aller plus loin : <a href="https://www.cartoradio.fr" target="_blank" rel="noreferrer" className="text-accent">cartoradio.fr</a> (mesures d'exposition)
              · <a href="https://monreseaumobile.arcep.fr" target="_blank" rel="noreferrer" className="text-accent">Mon réseau mobile</a> (couverture)
            </span>
          </section>
        </>
      )}
    </Panel>
  )
}
