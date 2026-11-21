import { useState } from 'react'
import { Moon, RefreshCw, Sun } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { HexLogo, Owl, SourceBadge } from '../components/ui'
import { getJson, usePolling } from '../hooks/usePolling'
import { useSettings, type LayerKey, type Mode, type Skin } from '../settings'
import type { SourceMeta } from '../types'

const LAYERS: [LayerKey, string, string][] = [
  ['train', 'Trains', 'rgb(var(--c-ink))'], ['tram', 'Trams', '#AB0672'], ['bus', 'Bus', '#EA619F'],
  ['velo', 'Vélos Vélodi', 'rgb(var(--c-live))'], ['flixbus', 'FlixBus', '#73D700'], ['blablacar', 'BlaBlaCar', '#2D9CDB'],
  ['culture', 'Salles & lieux', '#8E2442'], ['antennas', 'Antennes mobiles', '#8B5CF6'], ['traffic', 'Circulation', '#FF9F0A'], ['crowd', 'Affluence (estimation)', '#FF5E3A'],
]

/** Aperçu miniature d'un thème (indépendant du thème courant). */
const PREVIEW: Record<Skin, Record<Mode, { bg: string; card: string; ink: string; accent: string; font: string }>> = {
  tech: {
    dark: { bg: '#0B1120', card: '#131C31', ink: '#E2E8F0', accent: '#22D3EE', font: "'Space Grotesk', sans-serif" },
    light: { bg: '#F1F5F9', card: '#FFFFFF', ink: '#0F172A', accent: '#0891B2', font: "'Space Grotesk', sans-serif" },
  },
  bourgogne: {
    dark: { bg: '#1A0E12', card: '#27151C', ink: '#F4EBDD', accent: '#E0A526', font: "'Cormorant Garamond', serif" },
    light: { bg: '#F6F0E6', card: '#FFFDF8', ink: '#2A1218', accent: '#8E2442', font: "'Cormorant Garamond', serif" },
  },
}

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative w-11 h-[26px] rounded-full border shrink-0 ${on ? 'border-accent bg-accent/30' : 'border-line bg-bg'}`}>
      <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full transition-all ${on ? 'left-[21px] bg-accent' : 'left-[3px] bg-muted'}`} />
    </button>
  )
}

export function SettingsPage() {
  const s = useSettings()
  const status = usePolling<SourceMeta[]>('/api/status', 20000)
  const [testing, setTesting] = useState(false)

  const testAll = async () => {
    setTesting(true)
    try {
      await getJson('/api/status/refresh', { method: 'POST' })
      await status.refresh()
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <PageHeader title="Paramètres" subtitle="Préférences enregistrées dans ce navigateur" />

      <section className="card flex flex-col gap-4">
        <h2 className="t-card m-0">Apparence</h2>
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))]">
          {(['bourgogne', 'tech'] as Skin[]).map((skin) => {
            const p = PREVIEW[skin][s.mode]
            const active = s.skin === skin
            return (
              <button key={skin} type="button" aria-pressed={active} onClick={() => s.update({ skin })}
                className={`text-left rounded-2xl border-2 p-3 flex flex-col gap-3 ${active ? 'border-accent' : 'border-line hover:border-ring'}`}>
                <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: p.bg, color: p.ink }}>
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: skin === 'bourgogne' ? '#E0A526' : 'transparent', color: skin === 'bourgogne' ? '#2A1218' : p.accent }}>
                      {skin === 'bourgogne' ? <Owl size={18} /> : <HexLogo size={18} />}
                    </span>
                    <span style={{ fontFamily: p.font, fontWeight: 700, fontSize: skin === 'bourgogne' ? 20 : 15, letterSpacing: '0.08em' }}>DIJON HUB</span>
                  </div>
                  {skin === 'bourgogne' && <div className="h-1.5 rounded" style={{ background: 'repeating-linear-gradient(90deg,#D9A21B 0 12px,#2F6B4F 12px 24px,#D9A21B 24px 36px,#141010 36px 48px)' }} />}
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-10 rounded-md p-1.5" style={{ background: p.card }}>
                        <div className="h-1.5 w-2/3 rounded" style={{ background: p.accent }} />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-ink">{skin === 'bourgogne' ? 'Bourgogne' : 'Control Center'}</div>
                  <div className="text-xs text-muted">
                    {skin === 'bourgogne' ? 'Lie-de-vin, moutarde de Dijon, tuiles vernissées, chouette' : 'Bleu nuit, cyan, esthétique « centre de contrôle »'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-ink2">Thème</span>
          <div className="flex border border-line rounded-xl overflow-hidden">
            {(['dark', 'light'] as Mode[]).map((m) => (
              <button key={m} type="button" aria-pressed={s.mode === m} onClick={() => s.update({ mode: m })}
                className={`h-10 px-4 flex items-center gap-2 text-sm font-medium ${s.mode === m ? 'bg-accent text-on-accent' : 'bg-bg text-muted hover:text-ink'}`}>
                {m === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                {m === 'dark' ? 'Sombre' : 'Clair'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-5 items-start">
        <section className="card flex-[1_1_380px] flex flex-col">
          <h2 className="t-card m-0 mb-2">Couches affichées par défaut</h2>
          {LAYERS.map(([k, label, color]) => (
            <div key={k} className="flex justify-between items-center gap-3 py-2 border-b border-line last:border-0">
              <span className="flex items-center gap-2.5 text-sm"><span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />{label}</span>
              <Switch label={label} on={s.layers[k]} onClick={() => s.update({ layers: { ...s.layers, [k]: !s.layers[k] } })} />
            </div>
          ))}
        </section>
        <section className="card flex-[1_1_380px] flex flex-col gap-3.5">
          <h2 className="t-card m-0">Rafraîchissement</h2>
          <div className="text-[13px] text-muted">Intervalle de mise à jour des positions des véhicules</div>
          <div className="flex border border-line rounded-xl overflow-hidden self-start">
            {[10, 15, 30, 60].map((sec) => (
              <button key={sec} type="button" aria-pressed={s.refreshSec === sec} onClick={() => s.update({ refreshSec: sec })}
                className={`h-10 px-4 font-mono text-[13px] font-bold ${s.refreshSec === sec ? 'bg-time text-bg' : 'bg-bg text-muted hover:text-ink'}`}>
                {sec} s
              </button>
            ))}
          </div>
          <div className="text-[13px] text-muted">Les autres flux ont leur propre cache côté serveur : Vélodi et gare 1 min, météo et actualités 10 min, événements 30 min.</div>
        </section>
      </div>

      <section className="card flex flex-col gap-3">
        <div className="flex justify-between items-center flex-wrap gap-2">
          <h2 className="t-card m-0">État des sources de données</h2>
          <button type="button" onClick={testAll} disabled={testing}
            className="h-9 px-3.5 rounded-xl border border-ring bg-bg text-time text-[13px] font-medium flex items-center gap-2 disabled:opacity-60">
            <RefreshCw size={14} className={testing ? 'animate-spin' : ''} /> {testing ? 'Test en cours…' : 'Tester toutes les sources'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.8fr)_100px_90px_80px] gap-3 px-3 py-2.5 text-[11px] font-bold tracking-[0.1em] uppercase bg-boardhead text-boardhead-ink rounded-lg">
              <span>Source</span><span>Détail</span><span>Statut</span><span>MAJ</span><span>Latence</span>
            </div>
            {status.data?.map((src) => (
              <div key={src.source} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.8fr)_100px_90px_80px] gap-3 items-center px-3 py-2.5 border-b border-line text-[13px]">
                <span className="flex flex-col min-w-0"><span className="font-semibold">{src.label}</span><span className="font-mono text-[11px] text-muted truncate">{src.endpoint}</span></span>
                <span className="text-muted text-xs">{src.message}</span>
                <SourceBadge meta={src} className="justify-self-start" />
                <span className="font-mono text-ink2">{new Date(src.updated_at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' })}</span>
                <span className="font-mono text-ink2">{src.latency_ms != null ? `${src.latency_ms} ms` : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
