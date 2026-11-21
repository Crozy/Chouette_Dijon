/** Couches MapLibre de la carte (fonctions pures, sans état React). */
import maplibregl from 'maplibre-gl'
import type { LayerKey } from '../../settings'
import type { AntennaData, CrowdData, LineShape, TrafficInfo, TransitStop } from '../../types'

export const CENTER: [number, number] = [5.0415, 47.322]

/** Fonds de carte gratuits CARTO, sans clé API. */
export function styleUrl(skin: string, mode: string) {
  if (mode === 'dark') return 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
  return skin === 'bourgogne'
    ? 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
    : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
}

export const FILTERS: { key: LayerKey; label: string; color: string }[] = [
  { key: 'train', label: 'Trains', color: 'rgb(var(--c-ink))' },
  { key: 'tram', label: 'Trams', color: '#AB0672' },
  { key: 'bus', label: 'Bus', color: '#EA619F' },
  { key: 'velo', label: 'Vélos Vélodi', color: 'rgb(var(--c-live))' },
  { key: 'flixbus', label: 'FlixBus', color: '#73D700' },
  { key: 'blablacar', label: 'BlaBlaCar', color: '#2D9CDB' },
  { key: 'culture', label: 'Salles & lieux', color: '#8E2442' },
  { key: 'antennas', label: 'Antennes', color: '#8B5CF6' },
  { key: 'traffic', label: 'Circulation', color: '#FF9F0A' },
  { key: 'crowd', label: 'Affluence (estimée)', color: '#FF5E3A' },
]

export interface RouteRef {
  route_id: string
  line: string
  color: string
}

// ---------- Circulation & affluence (sous les lignes Divia et les noms de rues) ----------
export const TRAFFIC_COLORS = ['#34C759', '#FF9F0A', '#FF3B30', '#A1081A']

/** Insère sous nos tracés / arrêts s'ils existent, sinon sous les noms de rues du fond de carte. */
export function overlayBefore(map: maplibregl.Map) {
  return ['bus-lines', 'tram-lines', 'route-casing', 'bus-stops', 'roadname_minor'].find((id) => map.getLayer(id))
}

export function addTraffic(map: maplibregl.Map, info: TrafficInfo | null, dark: boolean) {
  if (!info) return
  const live = info.mode === 'live' && !!info.tiles
  const wantSource = live ? `traffic-live-${dark ? 'dark' : 'light'}` : 'estimated'
  if (map.getLayer('traffic') && map.getLayer('traffic')?.metadata !== wantSource) {
    map.removeLayer('traffic')
    if (map.getSource('traffic-live')) map.removeSource('traffic-live')
  }
  if (live) {
    if (!map.getSource('traffic-live')) {
      map.addSource('traffic-live', {
        type: 'raster', tileSize: 256, maxzoom: 18,
        tiles: [`${window.location.origin}${info.tiles}${dark ? '?dark=1' : ''}`],
        attribution: '© TomTom',
      })
    }
    if (!map.getLayer('traffic')) {
      // Opacité réduite pour que les tracés des lignes Divia restent lisibles par-dessus
      map.addLayer({ id: 'traffic', type: 'raster', source: 'traffic-live', metadata: wantSource, paint: { 'raster-opacity': 0.65 } }, overlayBefore(map))
    }
    return
  }
  // Estimation : grands axes du fond de carte colorés selon un niveau horaire (pas une mesure)
  if (!map.getSource('protomaps')) return
  const factor: maplibregl.ExpressionSpecification = ['match', ['get', 'kind_detail'],
    ['motorway', 'motorway_link', 'trunk', 'trunk_link'], 1.0, ['primary', 'primary_link'], 0.95,
    ['secondary', 'secondary_link'], 0.8, 0.6]
  // Petite variation d'une voie à l'autre (déterministe) pour éviter un aplat uniforme
  const variation: maplibregl.ExpressionSpecification = ['-', ['*', ['%', ['length', ['coalesce', ['get', 'name'], '']], 7], 0.05], 0.15]
  const value: maplibregl.ExpressionSpecification = ['+', ['*', info.level, factor], variation]
  const color: maplibregl.ExpressionSpecification = ['step', value, TRAFFIC_COLORS[0], 0.35, TRAFFIC_COLORS[1], 0.6, TRAFFIC_COLORS[2], 0.85, TRAFFIC_COLORS[3]]
  // Seuls les axes chargés (orange / rouge) sont dessinés : un réseau entier coloré en vert « fluide »
  // noyait les tracés des lignes de bus et de tram.
  const filter: maplibregl.FilterSpecification = ['all',
    ['in', ['get', 'kind_detail'], ['literal', ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary']]],
    ['>=', value, 0.35]]
  if (map.getLayer('traffic')) {
    map.setPaintProperty('traffic', 'line-color', color)
    map.setFilter('traffic', filter)
    return
  }
  map.addLayer({
    id: 'traffic', type: 'line', source: 'protomaps', 'source-layer': 'roads', metadata: 'estimated', minzoom: 10, filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 2, 17, 4], 'line-opacity': 0.55 },
  }, overlayBefore(map))
}

export function addCrowd(map: maplibregl.Map, data: CrowdData | null) {
  if (!data) return
  const points: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: data.points.map((p) => ({ type: 'Feature', properties: { weight: p.weight }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
  }
  const zones: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: data.zones.map((z) => ({
      type: 'Feature', properties: { name: z.name, level: z.level, score: z.score, reasons: JSON.stringify(z.reasons) },
      geometry: { type: 'Point', coordinates: [z.lon, z.lat] },
    })),
  }
  const src = map.getSource('crowd') as maplibregl.GeoJSONSource | undefined
  if (src) {
    src.setData(points)
    ;(map.getSource('crowd-zones') as maplibregl.GeoJSONSource | undefined)?.setData(zones)
    return
  }
  map.addSource('crowd', { type: 'geojson', data: points })
  map.addSource('crowd-zones', { type: 'geojson', data: zones })
  // Carte de chaleur façon « zones animées »
  map.addLayer({
    id: 'crowd-heat', type: 'heatmap', source: 'crowd', maxzoom: 18,
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 15, 1.4],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 16, 13, 28, 16, 60],
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(255,214,102,0)', 0.2, 'rgba(255,214,102,0.35)', 0.45, 'rgba(255,159,10,0.55)', 0.7, 'rgba(255,94,58,0.7)', 1, 'rgba(220,38,38,0.8)'],
      'heatmap-opacity': 0.75,
    },
  }, overlayBefore(map))
  // Zones cliquables (quasi invisibles) pour expliquer l'estimation
  map.addLayer({
    id: 'crowd-zones', type: 'circle', source: 'crowd-zones', filter: ['>=', ['get', 'score'], 0.25],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 8, 15, 22],
      'circle-color': '#FF5E3A', 'circle-opacity': 0.01,
    },
  })
}

export function applyOverlayState(map: maplibregl.Map, layers: Record<LayerKey, boolean>) {
  const vis = (on: boolean) => (on ? 'visible' : 'none')
  if (map.getLayer('traffic')) map.setLayoutProperty('traffic', 'visibility', vis(layers.traffic))
  for (const id of ['crowd-heat', 'crowd-zones']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis(layers.crowd))
  }
}

export const LINE_LAYERS = ['bus-lines', 'tram-lines'] as const

export function addLines(map: maplibregl.Map, shapes: LineShape[]) {
  if (!shapes.length) return
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: shapes.map((s) => ({
      type: 'Feature',
      properties: { line: s.line, color: s.color, route_id: s.route_id ?? '', mode: s.mode ?? 'tram' },
      geometry: { type: 'LineString', coordinates: s.coordinates },
    })),
  }
  const src = map.getSource('lines') as maplibregl.GeoJSONSource | undefined
  if (src) {
    src.setData(data)
    return
  }
  map.addSource('lines', { type: 'geojson', data })
  // Les tracés passent sous les arrêts, s'ils sont déjà affichés
  const before = map.getLayer('bus-stops') ? 'bus-stops' : undefined
  const layout = { 'line-cap': 'round', 'line-join': 'round' } as const
  // Bus : fins et discrets ; trams : plus épais, par-dessus
  map.addLayer({
    id: 'bus-lines', type: 'line', source: 'lines', filter: ['==', ['get', 'mode'], 'bus'], layout,
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 15, 3], 'line-opacity': 0.6 },
  }, before)
  map.addLayer({
    id: 'tram-lines', type: 'line', source: 'lines', filter: ['==', ['get', 'mode'], 'tram'], layout,
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 6], 'line-opacity': 0.85 },
  }, before)
  // Ligne du véhicule sélectionné : liseré blanc + trait épais
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'lines', filter: ['==', ['get', 'line'], '\u0000'], layout,
    paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 6, 15, 11], 'line-opacity': 0.9 },
  }, before)
  map.addLayer({
    id: 'route-highlight', type: 'line', source: 'lines', filter: ['==', ['get', 'line'], '\u0000'], layout,
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 15, 7] },
  }, before)
}

export const STOP_LAYERS = ['bus-stops', 'tram-stops', 'route-stops'] as const
export const NO_MATCH: maplibregl.FilterSpecification = ['==', ['get', 'id'], '\u0000']

export function addStops(map: maplibregl.Map, stops: TransitStop[]) {
  if (!stops.length) return
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: stops.map((s) => ({
      type: 'Feature',
      properties: {
        id: s.id, name: s.name, mode: s.mode, wheelchair: s.wheelchair,
        color: s.lines[0]?.color ?? '#005CA9',
        lines: JSON.stringify(s.lines.map((l) => l.line)),
        // « |T1|L3| » : permet de tester rapidement si une ligne dessert l'arrêt
        lineKey: `|${s.lines.map((l) => l.line).join('|')}|`,
      },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  }
  const src = map.getSource('stops') as maplibregl.GeoJSONSource | undefined
  if (src) {
    src.setData(data)
    return
  }
  map.addSource('stops', { type: 'geojson', data })
  // Bus : petits points, visibles seulement en zoomant ; trams : plus gros, visibles plus tôt
  map.addLayer({
    id: 'bus-stops', type: 'circle', source: 'stops', minzoom: 14, filter: ['==', ['get', 'mode'], 'bus'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 17, 5],
      'circle-color': '#FFFFFF', 'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 14, 1.2, 17, 2],
    },
  })
  map.addLayer({
    id: 'tram-stops', type: 'circle', source: 'stops', minzoom: 11.5, filter: ['==', ['get', 'mode'], 'tram'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 2.5, 14, 4.5, 17, 7],
      'circle-color': '#FFFFFF', 'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11.5, 1.5, 17, 3],
    },
  })
  // Arrêts de la ligne sélectionnée, visibles à tous les niveaux de zoom
  map.addLayer({
    id: 'route-stops', type: 'circle', source: 'stops', filter: NO_MATCH,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 6],
      'circle-color': '#FFFFFF', 'circle-stroke-color': '#111111',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 15, 2.5],
    },
  })
}

export function applyLineState(map: maplibregl.Map, layers: Record<LayerKey, boolean>, route: RouteRef | null) {
  const vis = (on: boolean) => (on ? 'visible' : 'none')
  if (map.getLayer('route-stops')) {
    map.setLayoutProperty('bus-stops', 'visibility', vis(layers.bus))
    map.setLayoutProperty('tram-stops', 'visibility', vis(layers.tram))
    map.setFilter('route-stops', route ? ['in', `|${route.line}|`, ['get', 'lineKey']] : NO_MATCH)
    if (route) map.setPaintProperty('route-stops', 'circle-stroke-color', route.color)
    for (const id of ['bus-stops', 'tram-stops'] as const) {
      map.setPaintProperty(id, 'circle-opacity', route ? 0.25 : 1)
      map.setPaintProperty(id, 'circle-stroke-opacity', route ? 0.25 : 1)
    }
  }
  if (!map.getLayer('route-highlight')) return
  map.setLayoutProperty('bus-lines', 'visibility', vis(layers.bus))
  map.setLayoutProperty('tram-lines', 'visibility', vis(layers.tram))

  const match: maplibregl.FilterSpecification = !route
    ? ['==', ['get', 'line'], '\u0000']
    : route.route_id
      ? ['any', ['==', ['get', 'route_id'], route.route_id], ['all', ['==', ['get', 'route_id'], ''], ['==', ['get', 'line'], route.line]]]
      : ['==', ['get', 'line'], route.line]
  map.setFilter('route-casing', match)
  map.setFilter('route-highlight', match)

  // Quand une ligne est sélectionnée, les autres s'estompent
  for (const id of LINE_LAYERS) {
    map.setPaintProperty(id, 'line-opacity', route ? 0.15 : id === 'bus-lines' ? 0.6 : 0.85)
  }
}

// ---------- Antennes mobiles (registre ANFR + pannes Arcep) ----------
export interface AntennaLayerFilter {
  ops: string[]
  gens: string[]
  outagesOnly: boolean
}

/** Couleur de chaque opérateur ; une antenne partagée est dessinée en anneaux concentriques. */
export const OPERATOR_COLORS: Record<string, string> = {
  Orange: '#FF7900', SFR: '#E2001A', 'Bouygues Telecom': '#0072CE', Free: '#FFFFFF',
}
const OPERATOR_ORDER = ['Orange', 'SFR', 'Bouygues Telecom', 'Free']
const RING_IDS = ['antennas', 'antennas-1', 'antennas-2', 'antennas-3'] as const
const ANTENNA_IDS = ['antennas-alert', ...RING_IDS] as const
const RING_SCALE = [1, 0.72, 0.48, 0.26]

function antennaFeatures(data: AntennaData, f: AntennaLayerFilter): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const s of data.stations) {
    if (f.outagesOnly && s.outages.length === 0) continue
    // Opérateurs retenus par les filtres (opérateur coché ET au moins une génération cochée)
    const ops = s.operators
      .filter((o) => f.ops.includes(o.name) && o.generations.some((g) => f.gens.includes(g)))
      .sort((a, b) => OPERATOR_ORDER.indexOf(a.name) - OPERATOR_ORDER.indexOf(b.name))
    if (!ops.length) continue
    const props: Record<string, unknown> = {
      id: s.id,
      has5g: ops.some((o) => o.generations.includes('5G')),
      outage: s.outages.some((o) => o.kind === 'incident') ? 'incident' : s.outages.length ? 'maintenance' : '',
    }
    ops.forEach((o, i) => { props[`c${i}`] = OPERATOR_COLORS[o.name] ?? '#94A3B8' })
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })
  }
  return { type: 'FeatureCollection', features }
}

/** Crée ou met à jour les couches d'antennes selon les filtres (opérateurs, générations, pannes). */
export function addAntennas(map: maplibregl.Map, data: AntennaData | null, f: AntennaLayerFilter) {
  if (!data) return
  const fc = antennaFeatures(data, f)
  const src = map.getSource('antennas') as maplibregl.GeoJSONSource | undefined
  if (src) {
    src.setData(fc)
    return
  }
  map.addSource('antennas', { type: 'geojson', data: fc })
  // Rayon selon le zoom (une expression « zoom » doit rester au premier niveau : on multiplie chaque palier)
  const radius = (k: number): maplibregl.ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 10, 3.5 * k, 13, 5.5 * k, 16, 10 * k]
  const before = overlayBefore(map)
  // Panne : cercle autour du point (rouge = incident, jaune = maintenance)
  map.addLayer({
    id: 'antennas-alert', type: 'circle', source: 'antennas', minzoom: 10, filter: ['!=', ['get', 'outage'], ''],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': radius(1.9), 'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 3, 'circle-stroke-color': ['match', ['get', 'outage'], 'incident', '#DC2626', '#FACC15'],
    },
  }, before)
  RING_IDS.forEach((id, i) => {
    map.addLayer({
      id, type: 'circle', source: 'antennas', minzoom: 10, filter: ['has', `c${i}`],
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': radius(RING_SCALE[i]),
        'circle-color': ['get', `c${i}`],
        // Anneau extérieur : liseré violet si la 5G est présente ; fin trait sombre pour détacher les couleurs (dont le blanc de Free)
        'circle-stroke-color': i === 0 ? ['case', ['get', 'has5g'], '#8B5CF6', '#111827'] : '#111827',
        'circle-stroke-width': i === 0 ? ['case', ['get', 'has5g'], 2, 1] : 0.6,
      },
    }, before)
  })
}

export function applyAntennaState(map: maplibregl.Map, visible: boolean) {
  for (const id of ANTENNA_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  }
}
