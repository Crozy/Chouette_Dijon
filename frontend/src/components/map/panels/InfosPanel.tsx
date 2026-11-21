import { usePolling } from '../../../hooks/usePolling'
import type { Alert, ApiResponse, Infos } from '../../../types'
import { Skeleton } from '../../ui'
import { Panel } from '../Panel'
import type { PanelProps } from './types'

const LEVEL: Record<Alert['level'], [string, string]> = {
  perturbation: ['PERTURBÉ', 'bg-sim text-bg'],
  deviation: ['DÉVIATION', 'bg-accent text-on-accent'],
  travaux: ['TRAVAUX', 'bg-line text-ink'],
  info: ['INFO', 'bg-live text-bg'],
}

export function InfosPanel({ onClose, style, className }: PanelProps) {
  const { data } = usePolling<ApiResponse<Infos>>('/api/infos', 120000)
  const urgent = data?.data.numbers.filter((n) => n.emergency) ?? []
  const useful = data?.data.numbers.filter((n) => !n.emergency) ?? []

  return (
    <Panel title="Infos & Urgences" subtitle="Alertes trafic, travaux et numéros utiles" meta={data?.meta} onClose={onClose} style={style} className={className}>
      <section aria-label="Numéros d'urgence" className="grid grid-cols-3 gap-2">
        {urgent.map((u) => (
          <a key={u.number} href={`${u.number === '114' ? 'sms' : 'tel'}:${u.number}`}
            className="flex flex-col gap-0.5 p-2.5 rounded-xl bg-emergency border border-danger/40 no-underline text-ink">
            <span className="t-big text-emergency-ink" style={{ fontSize: 'calc(24px * var(--ds-big))' }}>{u.number}</span>
            <span className="text-[11px] font-semibold leading-tight text-emergency-ink/90">{u.label}</span>
          </a>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold">Alertes en cours</h3>
        {!data ? <Skeleton h={200} /> : data.data.alerts.length === 0 ? (
          <p className="m-0 text-sm text-muted">Aucune perturbation signalée.</p>
        ) : data.data.alerts.map((a) => (
          <div key={a.id} className="inner flex flex-col gap-1 p-3">
            <div className="flex gap-1.5 items-center flex-wrap">
              <span className={`font-mono text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded ${LEVEL[a.level][1]}`}>{LEVEL[a.level][0]}</span>
              <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-surface border border-line">{a.scope}</span>
            </div>
            <span className="text-[14px] font-semibold">{a.title}</span>
            <p className="m-0 text-[13px] leading-relaxed text-muted">{a.text}</p>
            {a.period && <span className="font-mono text-[11px] text-muted">{a.period}</span>}
          </div>
        ))}
      </section>

      <section className="flex flex-col">
        <h3 className="m-0 mb-1 text-sm font-semibold">Numéros utiles</h3>
        {useful.map((u) => (
          <div key={u.number} className="flex justify-between items-center gap-3 py-2 border-b border-line last:border-0">
            <span className="text-[13px] text-ink2">{u.label}</span>
            <a href={`tel:${u.number}`} className="font-mono text-[13px] font-bold text-time no-underline whitespace-nowrap">{u.number}</a>
          </div>
        ))}
      </section>
    </Panel>
  )
}
