import type { EventCategory, Weather } from '../types'

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  concert: 'Concert', sport: 'Sport', expo: 'Expo', spectacle: 'Spectacle', famille: 'Famille', autre: 'Autre',
}

export const CATEGORY_COLOR: Record<EventCategory, string> = {
  concert: '#8E2442', sport: '#A87A12', expo: '#2F6B4F', spectacle: '#6B2D5C', famille: '#9A4A22', autre: '#475569',
}

const AQI_STEPS = ['#34D399', '#A3E635', '#FACC15', '#FB923C', '#F87171', '#C084FC']

export function aqiIndex(v?: number | null) {
  if (v == null) return -1
  return [20, 40, 60, 80, 100].findIndex((l) => v <= l) === -1 ? 5 : [20, 40, 60, 80, 100].findIndex((l) => v <= l)
}

export function AqiBar({ air }: { air: NonNullable<Weather['air']> }) {
  const idx = aqiIndex(air.european_aqi)
  return (
    <div className="inner p-3 flex flex-col gap-2">
      <div className="flex justify-between text-[13px]">
        <span className="text-muted">Qualité de l'air · indice européen</span>
        <span className="font-mono font-bold text-ink">{air.european_aqi ?? '—'} · {air.level}</span>
      </div>
      <div className="grid grid-cols-6 gap-[3px] h-2" aria-hidden>
        {AQI_STEPS.map((c, i) => <div key={c} className="rounded" style={{ background: c, opacity: i === idx ? 1 : 0.3 }} />)}
      </div>
    </div>
  )
}

export const AQI_COLOR = (v?: number | null) => AQI_STEPS[Math.max(0, aqiIndex(v))]
