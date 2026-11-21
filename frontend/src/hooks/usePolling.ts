import { useCallback, useEffect, useRef, useState } from 'react'

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

/** Récupère une URL et la rafraîchit toutes les `intervalMs` millisecondes (pause si l'onglet est masqué). */
export function usePolling<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const urlRef = useRef(url)
  urlRef.current = url

  const load = useCallback(async () => {
    const u = urlRef.current
    if (!u) return
    try {
      const d = await getJson<T>(u)
      if (urlRef.current === u) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    load()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [url, intervalMs, load])

  return { data, error, loading, refresh: load }
}
