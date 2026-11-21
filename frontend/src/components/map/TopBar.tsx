import { useEffect, useState } from 'react'
import { Bell, Maximize2, Minimize2, Moon, Sun } from 'lucide-react'
import { useSettings } from '../../settings'
import { usePolling } from '../../hooks/usePolling'
import { temp } from '../../format'
import type { ApiResponse, Infos, SourceMeta, Weather } from '../../types'
import { HexLogo, Owl, WeatherIcon } from '../ui'
import { AQI_COLOR } from '../../pages/shared'
import { UI } from './nav'

function Clock({ compact }: { compact: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const time = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: compact ? undefined : '2-digit' })
  const date = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <span className="flex flex-col items-end leading-none px-1" aria-live="off">
      <span className="font-mono text-[17px] font-bold text-time">{time}</span>
      {!compact && <span className="text-[10px] text-muted mt-0.5">{date}</span>}
    </span>
  )
}

const BTN = 'h-10 rounded-lg border border-line bg-surface text-ink flex items-center justify-center gap-1.5'

/** Barre haute flottante : identité, météo, heure, état des flux, thème, alertes, plein écran. */
export function TopBar({ mobile, onWeather, onAlerts, onSettings }: {
  mobile: boolean
  onWeather: () => void
  onAlerts: () => void
  onSettings: () => void
}) {
  const { skin, mode, update } = useSettings()
  const sources = usePolling<SourceMeta[]>('/api/status', 20000).data
  const infos = usePolling<ApiResponse<Infos>>('/api/infos', 120000).data
  const weather = usePolling<ApiResponse<Weather>>('/api/weather', 600000).data?.data
  const alertCount = infos?.data.alerts.filter((a) => a.level !== 'info').length ?? 0
  const live = sources?.filter((s) => s.status === 'live' || s.status === 'scheduled').length ?? 0
  const degraded = sources?.some((s) => s.status === 'error')

  // Plein écran natif (mode kiosque)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  return (
    <header
      className="absolute z-40 flex items-center justify-between gap-2 px-2 py-1.5 bg-surface/95 backdrop-blur border border-line rounded-xl shadow-lg"
      style={{ left: UI.gap, right: UI.gap, top: UI.gap, height: UI.top - UI.gap * 1.5 }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {skin === 'bourgogne' ? (
          <span className="w-9 h-9 shrink-0 rounded-full bg-[#E0A526] text-[#2A1218] flex items-center justify-center" role="img" aria-label="Chouette de Dijon">
            <Owl size={22} />
          </span>
        ) : (
          <span className="w-9 h-9 shrink-0 rounded-lg bg-accent/10 border border-accent/40 text-accent flex items-center justify-center"><HexLogo /></span>
        )}
        <div className="min-w-0 leading-none">
          <h1 className={`m-0 truncate ${mobile ? 'sr-only' : skin === 'bourgogne' ? 'font-display text-[21px] font-bold tracking-[0.03em]' : 'font-display text-base font-bold tracking-[0.06em]'}`}>Chouette Dijon</h1>
          {!mobile && <div className={skin === 'bourgogne' ? 'font-display italic text-[13px] text-accent mt-0.5' : 'text-[11px] text-muted mt-0.5'}>La métropole en temps réel</div>}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {weather && (
          <button type="button" onClick={onWeather} className={`${BTN} px-2.5`} title="Météo et qualité de l'air"
            aria-label={`Météo : ${temp(weather.current.temperature)}, ${weather.current.label}. Ouvrir la météo`}>
            <WeatherIcon icon={weather.current.icon} size={20} />
            <span className="font-mono font-bold text-[15px]">{temp(weather.current.temperature)}</span>
            {weather.air && !mobile && (
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: AQI_COLOR(weather.air.european_aqi) }} title={`Qualité de l'air : ${weather.air.level}`} />
            )}
          </button>
        )}
        <Clock compact={mobile} />
        {!mobile && (
          <button type="button" onClick={onSettings} title="État des sources de données"
            className={`h-10 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 ${degraded ? 'border-sim/50 bg-sim/10' : 'border-live/45 bg-live/10'}`}>
            <span className={`w-2 h-2 rounded-full ${degraded ? 'bg-sim' : 'bg-live'}`} />
            Flux <span className="font-mono">{live}/{sources?.length ?? 0}</span>
          </button>
        )}
        <button type="button" onClick={() => update({ mode: mode === 'dark' ? 'light' : 'dark' })} className={`${BTN} w-10 text-accent`}
          aria-label={mode === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}>
          {mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button type="button" onClick={onAlerts} className={`${BTN} w-10 relative text-accent`} aria-label={`Alertes et urgences (${alertCount})`}>
          <Bell size={18} />
          {alertCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-accent text-on-accent font-mono text-[11px] font-bold flex items-center justify-center px-1">{alertCount}</span>
          )}
        </button>
        {!mobile && (
          <button type="button" onClick={toggleFull} className={`${BTN} w-10`} aria-label={full ? 'Quitter le plein écran' : 'Plein écran (mode borne)'}>
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        )}
      </div>
    </header>
  )
}
