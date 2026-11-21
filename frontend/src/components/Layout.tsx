import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useSettings } from '../settings'
import { HexLogo, Owl, TileStrip } from './ui'

/** Coque de la seule page hors carte : les Paramètres. */
export function SettingsShell({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const { skin } = useSettings()
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col">
      <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3">
        <div className="flex items-center gap-3">
          {skin === 'bourgogne' ? (
            <span className="w-10 h-10 rounded-full bg-[#E0A526] text-[#2A1218] flex items-center justify-center" role="img" aria-label="Chouette de Dijon"><Owl size={24} /></span>
          ) : (
            <span className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/40 text-accent flex items-center justify-center"><HexLogo /></span>
          )}
          <span className={skin === 'bourgogne' ? 'font-display text-[24px] font-bold tracking-[0.08em]' : 'font-display text-lg font-bold tracking-[0.12em]'}>DIJON HUB</span>
        </div>
        <button type="button" onClick={onBack}
          className="flex items-center gap-2 h-11 px-4 rounded-xl bg-accent text-on-accent text-sm font-semibold">
          <ArrowLeft size={18} aria-hidden /> Retour à la carte
        </button>
      </header>
      {skin === 'bourgogne' ? <TileStrip /> : <div className="h-px bg-line" />}
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 flex flex-col gap-5">{children}</main>
    </div>
  )
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-3">
      <div>
        <h1 className="t-page m-0">{title}</h1>
        {subtitle && <p className="mt-1.5 mb-0 text-muted text-sm">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}
