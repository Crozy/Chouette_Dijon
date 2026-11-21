import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Skin = 'tech' | 'bourgogne'
export type Mode = 'dark' | 'light'
export type LayerKey = 'train' | 'tram' | 'bus' | 'velo' | 'flixbus' | 'blablacar' | 'culture' | 'traffic' | 'crowd'

export interface Settings {
  skin: Skin
  mode: Mode
  refreshSec: number
  layers: Record<LayerKey, boolean>
}

const DEFAULTS: Settings = {
  skin: 'bourgogne',
  mode: 'dark',
  refreshSec: 15,
  // Affichage sobre par défaut : l'essentiel (trams, gares, salles) ; le reste s'active depuis les filtres
  layers: { train: true, tram: true, bus: false, velo: false, flixbus: true, blablacar: false, culture: true, traffic: false, crowd: false },
}
const KEY = 'dijonhub.settings'
/** À incrémenter quand les couches par défaut changent : les anciens choix enregistrés sont alors réinitialisés. */
const LAYERS_VERSION = 2

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    // Paramètres d'URL prioritaires (?skin=tech&mode=light) — pratique pour un écran en mode kiosque
    const q = new URLSearchParams(window.location.search)
    const skin = q.get('skin')
    const mode = q.get('mode')
    if (skin === 'tech' || skin === 'bourgogne') raw.skin = skin
    if (mode === 'dark' || mode === 'light') raw.mode = mode
    const layers = raw.layersVersion === LAYERS_VERSION ? { ...DEFAULTS.layers, ...(raw.layers ?? {}) } : DEFAULTS.layers
    return { ...DEFAULTS, ...raw, layers }
  } catch {
    return DEFAULTS
  }
}

interface Ctx extends Settings {
  update: (patch: Partial<Settings>) => void
}

const SettingsContext = createContext<Ctx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.skin = settings.skin
    root.dataset.mode = settings.mode
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...settings, layersVersion: LAYERS_VERSION }))
    } catch {
      /* stockage indisponible (navigation privée) : on ignore */
    }
  }, [settings])

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))
  return <SettingsContext.Provider value={{ ...settings, update }}>{children}</SettingsContext.Provider>
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings hors SettingsProvider')
  return ctx
}
