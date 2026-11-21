const TZ = 'Europe/Paris'

export const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

export const dayShort = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'short' }).replace('.', '')

export const dayLong = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long' })

export const dayNum = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, day: '2-digit' })

export const monthShort = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, month: 'short' }).replace('.', '').toUpperCase()

export function ago(iso?: string | null): string {
  if (!iso) return ''
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} j`
}

export const temp = (v: number) => `${Math.round(v)}°`

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
