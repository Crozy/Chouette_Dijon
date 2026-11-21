import { useEffect, useState } from 'react'
import type { LayerKey } from '../../settings'
import { CalendarDays, CloudSun, Newspaper, RadioTower, SlidersHorizontal, TramFront, TriangleAlert, type LucideIcon } from 'lucide-react'

/** Panneaux affichables par-dessus la carte (un seul à la fois). */
/** `lieu:<id>` = programmation d'une salle (adresse #/lieu/<id>) */
export type FixedPanel = 'transports' | 'actus' | 'meteo' | 'agenda' | 'infos' | 'antennes' | 'gare' | 'cars'
export type PanelId = FixedPanel | `lieu:${string}`

/** Entrées du rail d'icônes. « settings » quitte la carte pour la page Paramètres. */
export const RAIL: { id: PanelId | 'settings'; label: string; icon: LucideIcon }[] = [
  { id: 'transports', label: 'Transports', icon: TramFront },
  { id: 'actus', label: 'Actualités', icon: Newspaper },
  { id: 'meteo', label: 'Météo', icon: CloudSun },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'infos', label: 'Infos & Urgences', icon: TriangleAlert },
  { id: 'antennes', label: 'Antennes', icon: RadioTower },
  { id: 'settings', label: 'Paramètres', icon: SlidersHorizontal },
]

export const PANEL_TITLES: Record<FixedPanel, string> = {
  transports: 'Transports', actus: 'Actualités', meteo: 'Météo', agenda: 'Agenda', infos: 'Infos & Urgences',
  antennes: 'Antennes mobiles', gare: 'Gare SNCF', cars: 'Gare routière',
}

const PANELS = Object.keys(PANEL_TITLES) as FixedPanel[]

/**
 * Couches mises en avant par chaque section du rail.
 * - `only` : la carte se concentre sur le sujet (les autres couches sont masquées) ;
 * - `add`  : les couches sont ajoutées à ce qui est déjà affiché.
 * Les filtres en haut de la carte permettent toujours d'ajouter d'autres couches ensuite.
 * Sections sans contenu géographique (actus, météo, infos) : la carte ne change pas.
 */
export const SECTION_LAYERS: Partial<Record<FixedPanel | 'lieu', { mode: 'only' | 'add'; layers: LayerKey[] }>> = {
  transports: { mode: 'only', layers: ['train', 'tram', 'bus', 'velo', 'flixbus', 'blablacar'] },
  antennes: { mode: 'only', layers: ['antennas'] },
  agenda: { mode: 'only', layers: ['culture'] },
  lieu: { mode: 'add', layers: ['culture'] },
  gare: { mode: 'add', layers: ['train'] },
  cars: { mode: 'add', layers: ['flixbus'] },
}

export function sectionLayers(p: PanelId | null) {
  if (!p) return undefined
  return SECTION_LAYERS[p.startsWith('lieu:') ? 'lieu' : (p as FixedPanel)]
}

export function panelTitle(p: PanelId) {
  return p.startsWith('lieu:') ? 'Programmation' : PANEL_TITLES[p as FixedPanel]
}
/** Anciennes adresses de pages → panneau correspondant. */
const LEGACY: Record<string, FixedPanel> = { news: 'actus', weather: 'meteo', events: 'agenda' }

export type Route = { view: 'settings' } | { view: 'map'; panel: PanelId | null }

export function parseHash(hash: string): Route {
  const [id, arg] = hash.replace(/^#\/?/, '').split(/[?]/)[0].split('/')
  if (id === 'settings') return { view: 'settings' }
  if (id === 'lieu' && arg && /^[a-z0-9-]+$/.test(arg)) return { view: 'map', panel: `lieu:${arg}` }
  const panel = (PANELS as string[]).includes(id) ? (id as FixedPanel) : LEGACY[id] ?? null
  return { view: 'map', panel }
}

export function hashFor(route: Route) {
  if (route.view === 'settings') return '#/settings'
  if (!route.panel) return '#/'
  return route.panel.startsWith('lieu:') ? `#/lieu/${route.panel.slice(5)}` : `#/${route.panel}`
}

/** Vrai sous 640 px de large (rail en bas, panneaux en tiroir). */
export function useIsMobile() {
  const query = '(max-width: 639px)'
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMobile(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return mobile
}

/** Géométrie de l'interface (px), partagée par la carte et ses panneaux. */
export const UI = {
  gap: 12,
  top: 68, // sous la barre haute
  rail: 52, // largeur du rail (desktop) / hauteur de la barre du bas (mobile)
  panel: 360,
  journey: 320,
}
