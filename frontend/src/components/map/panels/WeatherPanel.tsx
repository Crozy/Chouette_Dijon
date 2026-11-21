import { usePolling } from '../../../hooks/usePolling'
import { cap, dayLong, temp } from '../../../format'
import type { ApiResponse, Weather } from '../../../types'
import { Skeleton, SourceBadge, WeatherIcon } from '../../ui'
import { AQI_COLOR, AqiBar } from '../../../pages/shared'
import { Panel } from '../Panel'
import type { PanelProps } from './types'

export function WeatherPanel({ onClose, style, className }: PanelProps) {
  const { data } = usePolling<ApiResponse<Weather>>('/api/weather', 600000)
  const w = data?.data

  return (
    <Panel title="Météo & qualité de l'air" subtitle="Dijon · source Open-Meteo" meta={data?.meta} onClose={onClose} style={style} className={className}>
      {!w ? <Skeleton h={420} /> : (() => {
        const lo = Math.min(...w.daily.map((d) => d.temp_min)) - 1
        const hi = Math.max(...w.daily.map((d) => d.temp_max)) + 1
        const stats: [string, string][] = [
          ['Vent', `${Math.round(w.current.wind_speed)} km/h ${w.current.wind_direction ?? ''}`],
          ['Rafales', w.current.wind_gusts != null ? `${Math.round(w.current.wind_gusts)} km/h` : '—'],
          ['Humidité', `${w.current.humidity} %`],
          ['Pression', w.current.pressure != null ? `${Math.round(w.current.pressure)} hPa` : '—'],
          ['Lever', w.daily[0]?.sunrise ?? '—'],
          ['Coucher', w.daily[0]?.sunset ?? '—'],
        ]
        const pollutants: [string, number | null | undefined, number][] = [
          ['PM2.5', w.air?.pm2_5, 25], ['PM10', w.air?.pm10, 50], ['NO₂', w.air?.no2, 120], ['O₃', w.air?.o3, 130],
        ]
        return (
          <>
            <div className="flex items-center gap-4">
              <WeatherIcon icon={w.current.icon} size={64} strokeWidth={1.4} label={w.current.label} />
              <div>
                <div className="t-big" style={{ fontSize: 'calc(54px * var(--ds-big))' }}>{temp(w.current.temperature)}</div>
                <div className="text-muted text-sm mt-1">{w.current.label} · ressenti {temp(w.current.apparent_temperature)}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {stats.map(([l, v]) => (
                <div key={l} className="inner px-2.5 py-2">
                  <div className="text-[11px] text-muted">{l}</div>
                  <div className="font-mono text-[13px] font-bold mt-0.5">{v}</div>
                </div>
              ))}
            </div>

            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-sm font-semibold">Heure par heure</h3>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {w.hourly.map((h) => (
                  <div key={h.time} className="inner shrink-0 w-[46px] flex flex-col items-center gap-1 py-2">
                    <span className="font-mono text-[11px] text-muted">{new Date(h.time).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit' })}</span>
                    <WeatherIcon icon={h.icon} size={16} />
                    <span className="font-mono text-[13px] font-bold text-time">{temp(h.temperature)}</span>
                    <span className="font-mono text-[10px] text-rain">{h.precipitation_probability}%</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col">
              <h3 className="m-0 mb-1 text-sm font-semibold">7 prochains jours</h3>
              {w.daily.map((d, i) => (
                <div key={d.date} className="grid grid-cols-[84px_22px_30px_minmax(40px,1fr)_30px_36px] gap-2 items-center py-2 border-b border-line last:border-0 text-[13px]">
                  <span className="font-semibold truncate">{i === 0 ? "Aujourd'hui" : cap(dayLong(d.date + 'T12:00:00'))}</span>
                  <WeatherIcon icon={d.icon} size={18} label={d.label} />
                  <span className="font-mono text-muted text-right">{temp(d.temp_min)}</span>
                  <div className="relative h-1.5 bg-surface2 rounded">
                    <div className="absolute inset-y-0 rounded bg-accent"
                      style={{ left: `${((d.temp_min - lo) / (hi - lo)) * 100}%`, width: `${((d.temp_max - d.temp_min) / (hi - lo)) * 100}%` }} />
                  </div>
                  <span className="font-mono font-bold">{temp(d.temp_max)}</span>
                  <span className="font-mono text-[11px] text-rain text-right">{d.precipitation_probability}%</span>
                </div>
              ))}
            </section>

            {w.air && (
              <section className="flex flex-col gap-2.5">
                <div className="flex justify-between items-center gap-2">
                  <h3 className="m-0 text-sm font-semibold">Qualité de l'air</h3>
                  <SourceBadge meta={w.air_meta} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="t-big" style={{ fontSize: 'calc(36px * var(--ds-big))', color: AQI_COLOR(w.air.european_aqi) }}>{w.air.european_aqi ?? '—'}</span>
                  <span className="text-sm font-semibold">{w.air.level}</span>
                  <span className="text-[11px] text-muted">indice européen</span>
                </div>
                <AqiBar air={w.air} />
                {pollutants.map(([name, val, max]) => (
                  <div key={name} className="flex items-center gap-2.5 text-[13px]">
                    <span className="w-[48px] font-semibold text-ink2">{name}</span>
                    <div className="flex-1 h-1.5 bg-surface2 rounded overflow-hidden">
                      <div className="h-full rounded bg-live" style={{ width: `${Math.min(100, ((val ?? 0) / max) * 100)}%` }} />
                    </div>
                    <span className="w-[80px] text-right font-mono text-muted">{val != null ? `${Math.round(val)} µg/m³` : '—'}</span>
                  </div>
                ))}
              </section>
            )}
          </>
        )
      })()}
    </Panel>
  )
}
