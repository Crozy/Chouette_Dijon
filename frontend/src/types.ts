/** scheduled = horaires officiels prévus (pas du temps réel) */
export type SourceStatus = 'live' | 'scheduled' | 'simulated' | 'error'

export interface SourceMeta {
  source: string
  label: string
  status: SourceStatus
  updated_at: string
  message?: string | null
  latency_ms?: number | null
  endpoint?: string | null
}

export interface ApiResponse<T> {
  meta: SourceMeta
  data: T
}

export interface Vehicle {
  id: string
  line: string
  route_id: string
  mode: 'tram' | 'bus'
  color: string
  text_color: string
  lat: number
  lon: number
  bearing?: number | null
  speed_kmh?: number | null
  headsign?: string | null
  next_stop?: string | null
  status?: string | null
}

export interface LineShape {
  line: string
  color: string
  coordinates: [number, number][]
  route_id?: string
  mode?: 'tram' | 'bus'
  direction?: number | null
}

export interface StopLine {
  line: string
  color: string
  text_color: string
  mode: 'tram' | 'bus'
}

export interface TransitStop {
  id: string
  name: string
  lat: number
  lon: number
  mode: 'tram' | 'bus'
  lines: StopLine[]
  wheelchair: boolean
}

export interface VelodiStation {
  id: string
  name: string
  lat: number
  lon: number
  bikes: number
  docks: number
  capacity: number
  is_renting: boolean
}

export interface MeetingPoint {
  id: string
  kind: 'train' | 'coach' | 'carpool'
  name: string
  lat: number
  lon: number
  description: string
}

export type BoardMode = 'train' | 'flixbus' | 'blablacar' | 'velodi'

export interface BoardEntry {
  id: string
  mode: BoardMode
  operator: string
  number?: string | null
  time: string
  delay_min: number
  place: string
  via?: string | null
  platform?: string | null
  status: 'on_time' | 'delayed' | 'boarding' | 'cancelled' | 'info'
  status_label: string
  source_status: SourceStatus
  base_time?: string | null
  journey_id?: string | null
}

export interface JourneyStop {
  name: string
  arrival?: string | null
  departure?: string | null
  base_arrival?: string | null
  base_departure?: string | null
  delay_min: number
  platform?: string | null
  is_here: boolean
  state: 'passed' | 'current' | 'upcoming'
}

export interface Journey {
  id: string
  operator: string
  number?: string | null
  origin: string
  destination: string
  cancelled: boolean
  delay_min: number
  source_status: SourceStatus
  stops: JourneyStop[]
}

export interface Board {
  direction: 'departures' | 'arrivals'
  entries: BoardEntry[]
  sources: SourceMeta[]
}

export interface NewsItem {
  id: string
  source: string
  title: string
  link?: string | null
  summary?: string | null
  published?: string | null
  image?: string | null
}

export interface SocialPost {
  id: string
  account: string
  text: string
  link?: string | null
  published?: string | null
  via: string
}

export interface Weather {
  current: {
    temperature: number
    apparent_temperature: number
    humidity: number
    wind_speed: number
    wind_gusts?: number | null
    wind_direction?: string | null
    pressure?: number | null
    weather_code: number
    label: string
    icon: string
    is_day: boolean
  }
  hourly: { time: string; temperature: number; precipitation_probability: number; weather_code: number; icon: string }[]
  daily: {
    date: string
    temp_min: number
    temp_max: number
    precipitation_probability: number
    weather_code: number
    label: string
    icon: string
    sunrise?: string | null
    sunset?: string | null
  }[]
  air?: { european_aqi?: number | null; level: string; pm2_5?: number | null; pm10?: number | null; no2?: number | null; o3?: number | null } | null
  air_meta?: SourceMeta | null
}

export type EventCategory = 'concert' | 'sport' | 'expo' | 'spectacle' | 'famille' | 'autre'

export interface HubEvent {
  id: string
  title: string
  category: EventCategory
  venue: string
  start: string
  price?: string | null
  link?: string | null
  image?: string | null
  lat?: number | null
  lon?: number | null
  address?: string | null
  /** Position déduite du nom du lieu (approximative) */
  location_approx?: boolean
  venue_id?: string | null
  subtitle?: string | null
  ticket?: string | null
  /** Statut propre à l'événement (programmation réelle d'une salle) */
  source_status?: SourceStatus | null
}

/** Salle / lieu connu, positionné sur la carte */
export interface Venue {
  id: string
  name: string
  short: string
  kind: 'salle' | 'sport' | 'expo'
  lat: number
  lon: number
  upcoming: number
}

export interface Alert {
  id: string
  level: 'perturbation' | 'deviation' | 'travaux' | 'info'
  scope: string
  title: string
  text: string
  period?: string | null
}

export interface Infos {
  alerts: Alert[]
  numbers: { label: string; number: string; emergency: boolean }[]
}

export interface TrafficInfo {
  mode: 'live' | 'estimated'
  level: number
  label: string
  tiles?: string | null
}

/** Affluence : toujours une ESTIMATION, jamais une mesure. */
export interface CrowdZone {
  name: string
  lat: number
  lon: number
  score: number
  level: string
  reasons: string[]
}

export interface CrowdData {
  generated_at: string
  estimated: boolean
  method: string
  points: { lat: number; lon: number; weight: number }[]
  zones: CrowdZone[]
}
