import type { ReactNode } from 'react'
import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudRainWind, CloudSnow, CloudSun, Moon, Sun,
  type LucideIcon,
} from 'lucide-react'
import type { SourceMeta, SourceStatus } from '../types'

export function SourceBadge({ status, meta, className = '' }: { status?: SourceStatus; meta?: SourceMeta | null; className?: string }) {
  const s = status ?? meta?.status ?? 'simulated'
  const style =
    s === 'live'
      ? 'text-live bg-live/10 border-live/40'
      : s === 'scheduled'
        ? 'text-accent bg-accent/10 border-accent/40'
        : s === 'simulated'
          ? 'text-sim bg-sim/10 border-sim/40'
          : 'text-danger bg-danger/10 border-danger/40'
  const label = s === 'live' ? '● LIVE' : s === 'scheduled' ? '◷ PRÉVU' : s === 'simulated' ? '◐ SIMULÉ' : '✕ ERREUR'
  return (
    <span className={`badge ${style} ${className}`} title={meta?.message ?? undefined}>
      {label}
    </span>
  )
}

export function CardHeader({ icon: Icon, title, meta, status, action }: {
  icon: LucideIcon
  title: string
  meta?: SourceMeta | null
  status?: SourceStatus
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon size={20} className="text-accent shrink-0" aria-hidden />
        <h2 className="t-card m-0">{title}</h2>
        {(meta || status) && <SourceBadge meta={meta} status={status} />}
      </div>
      {action}
    </div>
  )
}

export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] text-accent hover:text-accent-strong">
      {children}
    </button>
  )
}

const ICONS: Record<string, LucideIcon> = {
  sun: Sun, moon: Moon, 'cloud-sun': CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain,
  showers: CloudRainWind, snow: CloudSnow, storm: CloudLightning,
}
const ICON_COLOR: Record<string, string> = { sun: 'text-time', 'cloud-sun': 'text-time', rain: 'text-rain', showers: 'text-rain', drizzle: 'text-rain', storm: 'text-sim' }

export function WeatherIcon({ icon, size = 24, label, strokeWidth = 2 }: { icon: string; size?: number; label?: string; strokeWidth?: number }) {
  const Icon = ICONS[icon] ?? Cloud
  return <Icon size={size} strokeWidth={strokeWidth} className={ICON_COLOR[icon] ?? 'text-ink2'} aria-label={label} role={label ? 'img' : undefined} aria-hidden={label ? undefined : true} />
}

/** La chouette de Dijon (logo du skin Bourgogne). */
export function Owl({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 3l3 3h8l3-3v10a7 7 0 0 1-14 0V3z" />
      <circle cx="9" cy="10" r="2" />
      <circle cx="15" cy="10" r="2" />
      <path d="M11 13l1 1.5 1-1.5" />
      <path d="M9 17.5c1 .6 2 .9 3 .9s2-.3 3-.9" />
    </svg>
  )
}

export function HexLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2 3 7v10l9 5 9-5V7z" />
      <path d="M12 22V12" />
      <path d="M3 7l9 5 9-5" />
    </svg>
  )
}

/** Frise de tuiles vernissées bourguignonnes. */
export function TileStrip() {
  return (
    <svg width="100%" height="12" className="block" aria-hidden>
      <defs>
        <pattern id="tuiles" width="64" height="12" patternUnits="userSpaceOnUse">
          <rect width="64" height="12" fill="#5E1A2C" />
          <polygon points="0,6 8,0 16,6 8,12" fill="#D9A21B" />
          <polygon points="16,6 24,0 32,6 24,12" fill="#2F6B4F" />
          <polygon points="32,6 40,0 48,6 40,12" fill="#D9A21B" />
          <polygon points="48,6 56,0 64,6 56,12" fill="#141010" />
        </pattern>
      </defs>
      <rect width="100%" height="12" fill="url(#tuiles)" />
    </svg>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 py-6 text-center text-muted text-sm">{children}</p>
}

export function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="inner animate-pulse" style={{ height: h }} />
}

/** Photo d'illustration distante : chargement différé, masquée si elle ne charge pas. */
export function EventImage({ src, className = '', alt = '' }: { src?: string | null; className?: string; alt?: string }) {
  if (!src) return null
  return (
    <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer"
      onError={(e) => { e.currentTarget.style.display = 'none' }}
      // Logos (ex. écussons d'équipes) : affichés en entier plutôt que recadrés
      className={`${/logo/i.test(src) ? 'object-contain p-2' : 'object-cover'} bg-surface2 ${className}`} />
  )
}
