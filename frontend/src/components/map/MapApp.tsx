import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import maplibregl from 'maplibre-gl'
import { Locate, Minus, Plus, X } from 'lucide-react'
import { useSettings, type LayerKey } from '../../settings'
import { usePolling } from '../../hooks/usePolling'
import { dayLong, hhmm } from '../../format'
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../../pages/shared'
import type {
  AntennaData, AntennaStation, ApiResponse, BoardEntry, CrowdData, HubEvent, LineShape, Venue, MeetingPoint, TrafficInfo, TransitStop, Vehicle, VelodiStation,
} from '../../types'
import { EventImage, SourceBadge } from '../ui'
import { StationBoard } from '../StationBoard'
import { JourneyPanel } from '../JourneyPanel'
import {
  CENTER, FILTERS, STOP_LAYERS, TRAFFIC_COLORS, addAntennas, addCrowd, addLines, addStops, addTraffic, applyAntennaState, applyLineState,
  applyOverlayState, styleUrl, type RouteRef,
} from './layers'
import { UI, useIsMobile, type PanelId } from './nav'
import { TopBar } from './TopBar'
import { Rail } from './Rail'
import { Panel } from './Panel'
import { TransportsContent, type ActiveLine } from './panels/TransportsPanel'
import { NewsPanel } from './panels/NewsPanel'
import { WeatherPanel } from './panels/WeatherPanel'
import { EventsPanel } from './panels/EventsPanel'
import { InfosPanel } from './panels/InfosPanel'
import { VenuePanel } from './panels/VenuePanel'
import { AntennasPanel, GENERATIONS, OPERATORS, type AntennaFilter } from './panels/AntennasPanel'

/** Icône du tram rose de Dijon (public/tram-dijon.svg). */
const TRAM_ICON = `<img class="mk-tram-icon" src="/tram-dijon.svg" alt="" draggable="false" />`

const STATION_TITLE = { gare: 'Gare de Dijon-Ville', cars: 'Gare routière de Dijon' } as const

interface Selected {
  id: string
  kind: string
  title: string
  lines: string[]
  /** Ligne à surligner sur la carte (véhicule ou ligne Divia sélectionné). */
  route?: RouteRef
  /** Lien externe (fiche de l'événement…) */
  link?: string | null
  ticket?: string | null
  image?: string | null
}

const EVENT_ICON: Record<HubEvent['category'], string> = {
  concert: '♪', sport: '⚽', expo: '🖼', spectacle: '🎭', famille: '★', autre: '●',
}

const VENUE_LOOK: Record<Venue['kind'], [string, string]> = {
  salle: ['#8E2442', '♪'], sport: ['#A87A12', '⚽'], expo: ['#2F6B4F', '🖼'],
}

interface Tracked {
  marker: maplibregl.Marker
  el: HTMLElement
  from: [number, number]
  to: [number, number]
}

const frShort = (iso?: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''

/** Fiche d'une antenne : opérateurs, technologies, statut, pannes déclarées. */
function antennaCard(st: AntennaStation): Selected {
  const ops = st.operators.map((o) => {
    const five = o.systems.filter((s) => s.startsWith('5G')).map((s) => s.replace('5G NR ', ''))
    const status = o.status && o.status !== 'En service' ? ` (${o.status.toLowerCase()})` : ''
    return `${o.name} : ${o.generations.join(' · ')}${five.length ? ` — 5G ${five.join('/')} MHz` : ''}${status}`
  })
  const outages = st.outages.map((o) =>
    `⚠ ${o.operator} : ${o.kind === 'incident' ? 'incident' : 'maintenance'} — voix ${o.voice ?? '?'}, data ${o.data ?? '?'}${o.end ? `, fin prévue le ${frShort(o.end)}` : ''}`)
  return {
    id: `antenna-${st.id}`,
    kind: `Antenne · ${st.operators.length} opérateur${st.operators.length > 1 ? 's' : ''}`,
    title: st.address ?? `Station ${st.id}`,
    lines: [...outages, ...ops, [st.height ? `Hauteur ${st.height} m` : '', `Station ANFR ${st.id}`].filter(Boolean).join(' · ')],
  }
}

function veloColor(s: VelodiStation) {
  if (!s.is_renting || s.bikes === 0) return 'rgb(var(--c-danger))'
  if (s.bikes / Math.max(1, s.capacity) < 0.3) return 'rgb(var(--c-sim))'
  return 'rgb(var(--c-live))'
}

/** L'application : la carte plein écran, avec barre haute, rail d'icônes et panneaux. */
export function MapApp({ panel, onPanel, onSettings }: {
  panel: PanelId | null
  onPanel: (p: PanelId | null) => void
  onSettings: () => void
}) {
  // Les filtres de couches sont ceux des réglages : un choix fait sur la carte est mémorisé
  const { skin, mode, refreshSec, layers, update } = useSettings()
  const mobile = useIsMobile()
  const [selected, setSelected] = useState<Selected | null>(null)
  // Train / car choisi dans un tableau de gare → cadre « Parcours » à côté
  const [train, setTrain] = useState<BoardEntry | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const vehicleMarkers = useRef(new Map<string, Tracked>())
  const staticMarkers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLElement; layer: LayerKey | LayerKey[] }>())
  const shapesRef = useRef<LineShape[]>([])
  const layersRef = useRef(layers)
  layersRef.current = layers
  const selectedRoute = selected?.route ?? null
  const routeRef = useRef<RouteRef | null>(selectedRoute)
  routeRef.current = selectedRoute
  const styleReady = useRef(false)
  const currentStyle = useRef(styleUrl(skin, mode))
  const eventMarker = useRef<maplibregl.Marker | null>(null)
  const onPanelRef = useRef(onPanel)
  onPanelRef.current = onPanel

  const vehicles = usePolling<ApiResponse<Vehicle[]>>('/api/transports/vehicles', refreshSec * 1000)
  const velodi = usePolling<ApiResponse<VelodiStation[]>>('/api/transports/velodi', 60000)
  const points = usePolling<ApiResponse<MeetingPoint[]>>('/api/transports/meeting-points', 3600000)
  const shapes = usePolling<ApiResponse<LineShape[]>>('/api/transports/lines', 3600000)
  const stops = usePolling<ApiResponse<TransitStop[]>>('/api/transports/stops', 3600000)
  const stopsRef = useRef<TransitStop[]>([])
  const traffic = usePolling<ApiResponse<TrafficInfo>>('/api/transports/traffic', 60000)
  const crowd = usePolling<ApiResponse<CrowdData>>('/api/transports/crowd', 120000)
  const venues = usePolling<ApiResponse<Venue[]>>('/api/events/venues', 1800000)
  // Antennes : chargées seulement quand la couche ou la section est affichée
  const wantAntennas = layers.antennas || panel === 'antennes'
  const antennas = usePolling<ApiResponse<AntennaData>>(wantAntennas ? '/api/transports/antennas' : null, 3600000)
  const antennasRef = useRef<AntennaData | null>(null)
  const [antennaFilter, setAntennaFilter] = useState<AntennaFilter>({ ops: [...OPERATORS], gens: [...GENERATIONS], outagesOnly: false })
  const antennaFilterRef = useRef(antennaFilter)
  antennaFilterRef.current = antennaFilter
  const trafficRef = useRef<TrafficInfo | null>(null)
  const crowdRef = useRef<CrowdData | null>(null)
  const darkRef = useRef(mode === 'dark')
  darkRef.current = mode === 'dark'

  // --- Création de la carte
  useEffect(() => {
    if (!container.current) return
    const map = new maplibregl.Map({
      container: container.current,
      style: styleUrl(skin, mode),
      center: CENTER,
      zoom: 12.6,
      attributionControl: { compact: true },
      // Carte toujours orientée nord en haut et vue à plat : pas de rotation ni d'inclinaison
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    mapRef.current = map
    map.on('style.load', () => {
      styleReady.current = true
      addTraffic(map, trafficRef.current, darkRef.current)
      addCrowd(map, crowdRef.current)
      applyOverlayState(map, layersRef.current)
      addAntennas(map, antennasRef.current)
      applyAntennaState(map, layersRef.current.antennas, antennaFilterRef.current)
      addLines(map, shapesRef.current)
      addStops(map, stopsRef.current)
      applyLineState(map, layersRef.current, routeRef.current)
    })
    // Clic sur une zone d'affluence (estimation)
    map.on('click', 'crowd-zones', (e) => {
      const f = e.features?.[0]
      if (!f) return
      const p = f.properties as { name: string; level: string; reasons: string }
      setSelected({
        id: `crowd-${p.name}`, kind: 'Affluence estimée', title: p.name,
        lines: [`Niveau estimé : ${p.level}`, ...(JSON.parse(p.reasons) as string[]), '⚠ Estimation, pas une mesure réelle'],
      })
    })
    map.on('mouseenter', 'crowd-zones', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'crowd-zones', () => { map.getCanvas().style.cursor = '' })
    // Clic sur une antenne
    map.on('click', 'antennas', (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined
      const st = antennasRef.current?.stations.find((s) => s.id === id)
      if (st) setSelected(antennaCard(st))
    })
    map.on('mouseenter', 'antennas', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'antennas', () => { map.getCanvas().style.cursor = '' })
    // Clic sur un arrêt (couches dessinées dans le canevas, pas des marqueurs DOM)
    for (const id of STOP_LAYERS) {
      map.on('click', id, (e) => {
        const f = e.features?.[0]
        if (!f) return
        const p = f.properties as { id: string; name: string; mode: string; lines: string; wheelchair: boolean | string }
        const lines = JSON.parse(p.lines) as string[]
        setSelected({
          id: `stop-${p.id}`, kind: p.mode === 'tram' ? 'Arrêt de tram' : 'Arrêt de bus', title: p.name,
          lines: [`Ligne${lines.length > 1 ? 's' : ''} : ${lines.join(' · ')}`, String(p.wheelchair) === 'true' ? 'Accessible PMR' : ''].filter(Boolean),
        })
      })
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
    }
    return () => {
      map.remove()
      mapRef.current = null
      styleReady.current = false
      vehicleMarkers.current.clear()
      staticMarkers.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Changement de thème → changement de fond de carte
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const url = styleUrl(skin, mode)
    if (url === currentStyle.current) return // évite un rechargement inutile au premier rendu
    currentStyle.current = url
    styleReady.current = false
    map.setStyle(url)
  }, [skin, mode])

  // --- Tracés des lignes de tram et de bus
  useEffect(() => {
    if (!shapes.data) return
    shapesRef.current = shapes.data.data
    const map = mapRef.current
    if (map && styleReady.current) {
      addLines(map, shapes.data.data)
      applyLineState(map, layersRef.current, routeRef.current)
    }
  }, [shapes.data])

  // --- Circulation (TomTom temps réel ou estimation) et affluence estimée
  useEffect(() => {
    trafficRef.current = traffic.data?.data ?? null
    const map = mapRef.current
    if (map && styleReady.current) {
      addTraffic(map, trafficRef.current, mode === 'dark')
      applyOverlayState(map, layersRef.current)
    }
  }, [traffic.data, mode])

  useEffect(() => {
    crowdRef.current = crowd.data?.data ?? null
    const map = mapRef.current
    if (map && styleReady.current) {
      addCrowd(map, crowdRef.current)
      applyOverlayState(map, layersRef.current)
    }
  }, [crowd.data])

  useEffect(() => {
    const map = mapRef.current
    if (map && styleReady.current) applyOverlayState(map, layers)
  }, [layers])

  // --- Antennes mobiles
  useEffect(() => {
    antennasRef.current = antennas.data?.data ?? null
    const map = mapRef.current
    if (map && styleReady.current) {
      addAntennas(map, antennasRef.current)
      applyAntennaState(map, layers.antennas, antennaFilter)
    }
  }, [antennas.data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current
    if (map && styleReady.current) applyAntennaState(map, layers.antennas, antennaFilter)
  }, [layers.antennas, antennaFilter])

  // Ouvrir la section « Antennes » affiche la couche
  useEffect(() => {
    if (panel === 'antennes' && !layers.antennas) update({ layers: { ...layers, antennas: true } })
  }, [panel]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Arrêts de tram et de bus
  useEffect(() => {
    if (!stops.data) return
    stopsRef.current = stops.data.data
    const map = mapRef.current
    if (map && styleReady.current) {
      addStops(map, stops.data.data)
      applyLineState(map, layersRef.current, routeRef.current)
    }
  }, [stops.data])

  // --- Visibilité des tracés + surlignage de la ligne sélectionnée
  useEffect(() => {
    const map = mapRef.current
    if (map && styleReady.current) applyLineState(map, layers, selectedRoute)
  }, [layers, selectedRoute?.route_id, selectedRoute?.line, shapes.data, stops.data, skin, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Véhicules (animation douce entre deux positions)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !vehicles.data) return
    const seen = new Set<string>()
    for (const v of vehicles.data.data) {
      seen.add(v.id)
      const to: [number, number] = [v.lon, v.lat]
      let t = vehicleMarkers.current.get(v.id)
      if (!t) {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = `mk ${v.mode === 'tram' ? 'mk-tram' : 'mk-bus'}`
        const marker = new maplibregl.Marker({ element: el }).setLngLat(to).addTo(map)
        t = { marker, el, from: to, to }
        vehicleMarkers.current.set(v.id, t)
      } else {
        t.from = [t.marker.getLngLat().lng, t.marker.getLngLat().lat]
        t.to = to
      }
      if (v.mode === 'tram') {
        if (t.el.childElementCount !== 2) {
          t.el.innerHTML = `${TRAM_ICON}<span class="mk-tram-line"></span>`
        }
        const badge = t.el.lastElementChild as HTMLElement
        badge.textContent = v.line
        badge.style.background = v.color
        badge.style.color = v.text_color
      } else {
        t.el.textContent = v.line
        t.el.style.background = v.color
        t.el.style.color = v.text_color
      }
      t.el.dataset.layer = v.mode
      t.el.dataset.line = v.line
      t.el.setAttribute('aria-label', `${v.mode === 'tram' ? 'Tram' : 'Bus'} ${v.line} vers ${v.headsign ?? '?'}`)
      t.el.onclick = () =>
        setSelected({
          id: v.id, kind: v.mode === 'tram' ? 'Tram Divia' : 'Bus Divia', title: `${v.line} → ${v.headsign ?? '—'}`,
          route: { route_id: v.route_id, line: v.line, color: v.color },
          lines: [v.next_stop ? `Prochain arrêt : ${v.next_stop}` : '', v.status ?? '', v.speed_kmh != null ? `${Math.round(v.speed_kmh)} km/h` : ''].filter(Boolean),
        })
    }
    for (const [id, t] of vehicleMarkers.current) {
      if (!seen.has(id)) {
        t.marker.remove()
        vehicleMarkers.current.delete(id)
      }
    }
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 1200)
      for (const t of vehicleMarkers.current.values()) {
        t.marker.setLngLat([t.from[0] + (t.to[0] - t.from[0]) * k, t.from[1] + (t.to[1] - t.from[1]) * k])
      }
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [vehicles.data])

  // --- Stations Vélodi et points fixes (gare, gare routière, covoiturage)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const upsert = (id: string, lngLat: [number, number], layer: LayerKey | LayerKey[], build: (el: HTMLElement) => void) => {
      let s = staticMarkers.current.get(id)
      if (!s) {
        const el = document.createElement('button')
        el.type = 'button'
        build(el)
        const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map)
        s = { marker, el, layer }
        staticMarkers.current.set(id, s)
      }
      build(s.el)
    }
    for (const st of velodi.data?.data ?? []) {
      upsert(`velo-${st.id}`, [st.lon, st.lat], 'velo', (el) => {
        el.classList.add('mk', 'mk-velo')
        el.style.color = veloColor(st)
        el.style.borderColor = veloColor(st)
        el.textContent = `${st.bikes}/${st.capacity}`
        el.setAttribute('aria-label', `Vélodi ${st.name}`)
        el.onclick = () => setSelected({ id: `velo-${st.id}`, kind: 'Station Vélodi', title: st.name,
          lines: [`${st.bikes} vélo(s) disponible(s)`, `${st.docks} bornette(s) libre(s)`, st.is_renting ? '' : 'Hors service'].filter(Boolean) })
      })
    }
    for (const p of points.data?.data ?? []) {
      const layer: LayerKey | LayerKey[] = p.kind === 'train' ? 'train' : p.kind === 'coach' ? ['flixbus', 'blablacar'] : 'blablacar'
      upsert(`poi-${p.id}`, [p.lon, p.lat], layer, (el) => {
        el.classList.add('mk', 'mk-poi')
        const look = p.kind === 'train' ? ['rgb(var(--c-ink))', 'rgb(var(--c-bg))', 'SNCF']
          : p.kind === 'coach' ? ['#73D700', '#0B1120', 'Cars'] : ['#2D9CDB', '#FFFFFF', 'BBC']
        el.style.background = look[0]
        el.style.color = look[1]
        el.textContent = look[2]
        el.setAttribute('aria-label', p.kind === 'carpool' ? p.name : `${p.name} — départs et arrivées`)
        el.onclick = () => {
          // Gare SNCF / gare routière : tableau des départs-arrivées dans le panneau de gauche
          if (p.kind === 'train' || p.kind === 'coach') onPanelRef.current(p.kind === 'train' ? 'gare' : 'cars')
          else setSelected({ id: `poi-${p.id}`, kind: 'Covoiturage', title: p.name, lines: [p.description] })
        }
      })
    }
    // Salles et lieux : un clic ouvre leur programmation dans le panneau de gauche
    for (const v of venues.data?.data ?? []) {
      upsert(`venue-${v.id}`, [v.lon, v.lat], 'culture', (el) => {
        el.classList.add('mk', 'mk-venue')
        const [bg, icon] = VENUE_LOOK[v.kind]
        el.style.background = bg
        el.innerHTML = `<span aria-hidden="true">${icon}</span><b></b>`
        ;(el.lastElementChild as HTMLElement).textContent = v.short
        el.setAttribute('aria-label', `${v.name} — programmation${v.upcoming ? ` (${v.upcoming} à venir)` : ''}`)
        el.onclick = () => onPanelRef.current(`lieu:${v.id}`)
      })
    }
  }, [velodi.data, points.data, venues.data])

  // --- Visibilité selon les filtres + surlignage de la sélection
  const stationMarker = panel === 'gare' ? 'poi-gare' : panel === 'cars' ? 'poi-gare-routiere'
    : panel?.startsWith('lieu:') ? `venue-${panel.slice(5)}` : null
  useEffect(() => {
    for (const t of vehicleMarkers.current.values()) {
      const key = t.el.dataset.layer as LayerKey
      // Les véhicules de la ligne sélectionnée restent visibles même si leur couche est masquée
      t.el.style.display = layers[key] || t.el.dataset.line === selectedRoute?.line ? '' : 'none'
    }
    for (const s of staticMarkers.current.values()) {
      const keys = Array.isArray(s.layer) ? s.layer : [s.layer]
      s.el.style.display = keys.some((k) => layers[k]) ? '' : 'none'
    }
    for (const [id, t] of [...vehicleMarkers.current, ...staticMarkers.current]) {
      t.el.classList.toggle('mk-selected', selected?.id === id || stationMarker === id)
    }
  }, [layers, selected, selectedRoute?.line, stationMarker, vehicles.data, velodi.data, points.data, venues.data])

  const counts = useMemo(() => {
    const v = vehicles.data?.data ?? []
    return { tram: v.filter((x) => x.mode === 'tram').length, bus: v.filter((x) => x.mode === 'bus').length }
  }, [vehicles.data])

  // --- Lignes en service, regroupées à partir des véhicules
  const activeLines = useMemo(() => {
    const m = new Map<string, ActiveLine>()
    for (const v of vehicles.data?.data ?? []) {
      const e = m.get(v.line) ?? { line: v.line, route_id: v.route_id, mode: v.mode, color: v.color, text: v.text_color, n: 0, headsigns: new Set<string>() }
      e.n++
      if (v.headsign) e.headsigns.add(v.headsign)
      m.set(v.line, e)
    }
    return [...m.values()].sort((a, b) =>
      Number(b.mode === 'tram') - Number(a.mode === 'tram') || a.line.localeCompare(b.line, 'fr', { numeric: true }))
  }, [vehicles.data])

  // --- Géométrie : la zone de carte « libre » commence à droite des panneaux ouverts
  const panelLeft = UI.gap * 2 + UI.rail
  const freeLeft = mobile ? UI.gap
    : panelLeft + (panel ? UI.panel + UI.gap : 0) + (train ? UI.journey + UI.gap : 0)
  const sheetHeight = 'min(62dvh, 560px)'
  const panelStyle: CSSProperties = mobile
    ? { left: 0, right: 0, bottom: UI.rail, height: sheetHeight, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }
    : { left: panelLeft, top: UI.top, bottom: UI.gap, width: UI.panel, maxWidth: `calc(100vw - ${panelLeft + UI.gap}px)` }
  const journeyStyle: CSSProperties = mobile
    ? { ...panelStyle, zIndex: 35 }
    : { left: panelLeft + UI.panel + UI.gap, top: UI.top, bottom: UI.gap, width: UI.journey, maxWidth: `calc(100vw - ${panelLeft + UI.panel + UI.gap * 2}px)` }

  const selectLine = (l: ActiveLine) => {
    if (selected?.id === `line-${l.line}`) {
      setSelected(null)
      return
    }
    setSelected({
      id: `line-${l.line}`, kind: l.mode === 'tram' ? 'Ligne de tram' : 'Ligne de bus', title: `Ligne ${l.line}`,
      lines: [`${l.n} véhicule${l.n > 1 ? 's' : ''} en service`, l.headsigns.size ? `Vers ${[...l.headsigns].join(' · ')}` : ''].filter(Boolean),
      route: { route_id: l.route_id, line: l.line, color: l.color },
    })
    // Cadre la carte sur le parcours de la ligne, dans la zone non couverte par les panneaux
    const map = mapRef.current
    const coords = shapesRef.current
      .filter((s) => (l.route_id && s.route_id ? s.route_id === l.route_id : s.line === l.line))
      .flatMap((s) => s.coordinates)
    if (map && coords.length) {
      const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
      const padding = mobile
        ? { top: UI.top + 50, bottom: Math.min(window.innerHeight * 0.62, 560) + UI.rail + 20, left: 20, right: 20 }
        : { top: UI.top + 50, bottom: 40, left: freeLeft + 20, right: 60 }
      map.fitBounds(b, { padding, maxZoom: 15, duration: 800 })
    }
  }

  // --- Agenda : placer un événement sur la carte
  const locateEvent = (e: HubEvent) => {
    const map = mapRef.current
    if (!map || e.lat == null || e.lon == null) return
    const id = `event-${e.id}`
    if (selected?.id === id) {
      setSelected(null)
      return
    }
    const date = new Date(e.start)
    setSelected({
      id, kind: `Événement · ${e.subtitle ?? CATEGORY_LABEL[e.category]}`, title: e.title, link: e.link, ticket: e.ticket, image: e.image,
      lines: [
        e.venue, e.address ?? '',
        `${dayLong(e.start).replace(/^./, (c) => c.toUpperCase())} ${date.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' })} · ${hhmm(e.start)}`,
        e.price ?? '', e.location_approx ? 'Position déduite du nom du lieu' : '',
      ].filter(Boolean),
    })
    eventMarker.current?.remove()
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'mk-event'
    el.setAttribute('aria-label', `${e.title} — ${e.venue}`)
    el.innerHTML = `<div class="mk-event-pin" style="background:${CATEGORY_COLOR[e.category]}"><span aria-hidden="true">${EVENT_ICON[e.category]}</span></div>`
    eventMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([e.lon, e.lat]).addTo(map)
    const padding = mobile
      ? { top: UI.top + 50, bottom: Math.min(window.innerHeight * 0.62, 560) + UI.rail, left: 20, right: 20 }
      : { top: UI.top + 50, bottom: 40, left: freeLeft, right: 60 }
    map.flyTo({ center: [e.lon, e.lat], zoom: Math.max(map.getZoom(), 15), padding, duration: 900 })
  }

  // L'épingle disparaît quand la fiche de l'événement est fermée ou remplacée
  useEffect(() => {
    if (!selected?.id.startsWith('event-')) {
      eventMarker.current?.remove()
      eventMarker.current = null
    }
  }, [selected?.id])

  // Le parcours se ferme quand on change de panneau
  useEffect(() => { setTrain(null) }, [panel])

  // Échap : ferme le parcours, puis le panneau, puis la sélection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      if (train) setTrain(null)
      else if (panel) onPanel(null)
      else if (selected) setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [train, panel, selected, onPanel])

  const focusAntenna = (st: AntennaStation) => {
    setSelected(antennaCard(st))
    const padding = mobile
      ? { top: UI.top + 50, bottom: Math.min(window.innerHeight * 0.62, 560) + UI.rail, left: 20, right: 20 }
      : { top: UI.top + 50, bottom: 40, left: freeLeft, right: 60 }
    mapRef.current?.flyTo({ center: [st.lon, st.lat], zoom: 15, padding, duration: 900 })
  }

  const toggle = (id: PanelId) => onPanel(panel === id ? null : id)
  const close = () => onPanel(null)
  const showLegends = !(mobile && (panel || selected))

  return (
    <div className="fixed inset-0 overflow-hidden bg-surface2 text-ink">
      <div ref={container} className="absolute inset-0" role="region" aria-label="Carte de Dijon" />

      <TopBar mobile={mobile} onWeather={() => toggle('meteo')} onAlerts={() => toggle('infos')} onSettings={onSettings} />
      <Rail active={panel} mobile={mobile} onSelect={toggle} onSettings={onSettings} />

      {/* Filtres de couches */}
      <div
        className={`absolute z-20 flex gap-1.5 ${mobile ? 'overflow-x-auto flex-nowrap pb-1' : 'flex-wrap'}`}
        style={{ left: freeLeft, right: mobile ? 56 : 60, top: UI.top }}
        role="group" aria-label="Couches affichées"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={layers[f.key]}
            onClick={() => update({ layers: { ...layers, [f.key]: !layers[f.key] } })}
            className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 h-[30px] px-2.5 rounded-full text-xs font-medium border backdrop-blur shadow-sm ${layers[f.key] ? 'bg-surface/95 border-accent text-ink' : 'bg-bg/85 border-line text-muted'}`}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: f.color, opacity: layers[f.key] ? 1 : 0.35 }} />
            {f.label}
          </button>
        ))}
      </div>

      {/* Contrôles de la carte */}
      <div className="absolute z-20 flex flex-col gap-1.5" style={{ right: UI.gap, top: UI.top }}>
        <button type="button" aria-label="Zoomer" onClick={() => mapRef.current?.zoomIn()} className="w-9 h-9 rounded-lg border border-line bg-surface text-ink flex items-center justify-center shadow-sm"><Plus size={16} /></button>
        <button type="button" aria-label="Dézoomer" onClick={() => mapRef.current?.zoomOut()} className="w-9 h-9 rounded-lg border border-line bg-surface text-ink flex items-center justify-center shadow-sm"><Minus size={16} /></button>
        <button type="button" aria-label="Recentrer sur Dijon" onClick={() => mapRef.current?.flyTo({ center: CENTER, zoom: 12.6 })} className="w-9 h-9 rounded-lg border border-line bg-surface text-accent flex items-center justify-center shadow-sm"><Locate size={16} /></button>
      </div>

      {/* Légendes et état des sources */}
      {showLegends && (
        <div className="absolute z-10 flex flex-col items-end gap-1 text-[11px]"
          style={{ right: UI.gap, bottom: mobile ? UI.rail + UI.gap + 18 : 32, left: mobile ? UI.gap : undefined }}>
          <span className="flex items-center gap-1.5 bg-surface/90 border border-line rounded-full px-2 py-0.5">Divia <SourceBadge meta={vehicles.data?.meta} /> <span className="font-mono">{counts.tram} trams · {counts.bus} bus</span></span>
          {!mobile && <span className="flex items-center gap-1.5 bg-surface/90 border border-line rounded-full px-2 py-0.5">Vélodi <SourceBadge meta={velodi.data?.meta} /></span>}
          {layers.traffic && traffic.data && (
            <span className="flex items-center gap-1.5 bg-surface/90 border border-line rounded-full px-2 py-0.5"
              title={traffic.data.data.mode === 'live' ? 'Fluidité en temps réel (TomTom)' : "Estimation selon l'heure et le jour : ce n'est pas une mesure"}>
              Circulation
              <span className={`font-mono text-[10px] font-bold uppercase ${traffic.data.data.mode === 'live' ? 'text-live' : 'text-sim'}`}>{traffic.data.data.mode === 'live' ? 'Temps réel' : 'Estimation'}</span>
              <span className="flex h-1.5 w-14 rounded-full overflow-hidden" aria-hidden>{TRAFFIC_COLORS.map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}</span>
              <span className="text-muted">{traffic.data.data.label}{traffic.data.data.mode !== 'live' ? ' · seuls les axes chargés sont colorés' : ''}</span>
            </span>
          )}
          {layers.antennas && antennas.data && (
            <span className="flex items-center gap-1.5 bg-surface/90 border border-line rounded-full px-2 py-0.5"
              title="Registre ANFR (hebdomadaire) et pannes déclarées à l'Arcep (quotidien, pas de temps réel)">
              Antennes <SourceBadge meta={antennas.data.meta} />
              <span className="text-muted">
                {antennas.data.data.stations.length} stations · pannes du {antennas.data.data.outages_date ? new Date(`${antennas.data.data.outages_date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' }) : '—'}
              </span>
            </span>
          )}
          {layers.crowd && crowd.data && (
            <span className="flex items-center gap-1.5 bg-surface/90 border border-line rounded-full px-2 py-0.5" title={crowd.data.data.method}>
              Affluence <span className="font-mono text-[10px] font-bold uppercase text-sim">Estimation</span>
              <span className="text-muted">calme</span>
              <span className="h-1.5 w-14 rounded-full" style={{ background: 'linear-gradient(90deg, rgba(255,214,102,.5), #FF9F0A, #FF5E3A, #DC2626)' }} aria-hidden />
              <span className="text-muted">très animé</span>
            </span>
          )}
        </div>
      )}

      {/* Panneau actif (un seul à la fois) */}
      {panel === 'transports' && (
        <Panel title="Transports" subtitle="Divia, gares, Vélodi, covoiturage" meta={vehicles.data?.meta} onClose={close} style={panelStyle}>
          <TransportsContent lines={activeLines} counts={counts} vehiclesMeta={vehicles.data?.meta}
            selectedLine={selected?.id.startsWith('line-') ? selected.route?.line ?? null : null}
            onLine={selectLine} onStation={(k) => onPanel(k)} velodi={velodi.data} points={points.data} />
        </Panel>
      )}
      {panel === 'actus' && <NewsPanel onClose={close} style={panelStyle} />}
      {panel === 'meteo' && <WeatherPanel onClose={close} style={panelStyle} />}
      {panel === 'agenda' && (
        <EventsPanel onClose={close} style={panelStyle} onLocate={locateEvent}
          selectedId={selected?.id.startsWith('event-') ? selected.id.slice(6) : null} />
      )}
      {panel === 'infos' && <InfosPanel onClose={close} style={panelStyle} />}
      {panel === 'antennes' && (
        <AntennasPanel onClose={close} style={panelStyle} data={antennas.data} filter={antennaFilter}
          onFilter={setAntennaFilter} onFocus={focusAntenna} />
      )}
      {panel?.startsWith('lieu:') && (
        <VenuePanel key={panel} venueId={panel.slice(5)} venue={venues.data?.data.find((v) => v.id === panel.slice(5)) ?? null}
          onClose={close} style={panelStyle} />
      )}
      {(panel === 'gare' || panel === 'cars') && (
        <StationBoard
          key={panel}
          kind={panel === 'gare' ? 'train' : 'coach'}
          title={STATION_TITLE[panel]}
          onClose={close}
          onSelect={(e) => setTrain((t) => (t?.id === e.id ? null : e))}
          selectedId={train?.id}
          style={panelStyle}
          className="absolute z-30"
        />
      )}
      {train && (panel === 'gare' || panel === 'cars') && (
        <JourneyPanel key={train.id} entry={train} onClose={() => setTrain(null)} style={journeyStyle} className="absolute z-30" />
      )}

      {/* Fiche de l'élément sélectionné sur la carte */}
      {selected && (
        <div
          className="absolute z-20 bg-surface border border-ring rounded-xl px-3.5 py-3 shadow-2xl"
          style={mobile
            ? { left: UI.gap, right: UI.gap, bottom: (panel ? 0 : UI.rail) + UI.gap, display: panel ? 'none' : undefined }
            : { left: freeLeft, bottom: UI.gap, width: 280 }}
        >
          {selected.image && <EventImage src={selected.image} className="-mx-3.5 -mt-3 mb-2.5 w-[calc(100%+28px)] h-[140px] rounded-t-xl block" />}
          <div className="flex justify-between items-center gap-2">
            <span className="text-[11px] font-bold tracking-wider uppercase text-accent">{selected.kind}</span>
            <button type="button" aria-label="Fermer la fiche" onClick={() => setSelected(null)} className="w-7 h-7 flex items-center justify-center text-muted hover:text-ink"><X size={16} /></button>
          </div>
          <div className="t-card mt-0.5">{selected.title}</div>
          <div className="font-mono text-[13px] text-ink2 mt-1.5 flex flex-col gap-0.5">
            {selected.lines.map((l) => <span key={l}>{l}</span>)}
          </div>
          {(selected.link || selected.ticket) && (
            <div className="flex gap-3 mt-2 text-[13px] font-semibold">
              {selected.link && <a href={selected.link} target="_blank" rel="noreferrer" className="text-accent">Plus d'infos ↗</a>}
              {selected.ticket && <a href={selected.ticket} target="_blank" rel="noreferrer" className="text-accent">Billetterie ↗</a>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
