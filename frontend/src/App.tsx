import { useCallback, useEffect, useState } from 'react'
import { MapApp } from './components/map/MapApp'
import { hashFor, panelTitle, parseHash, type PanelId, type Route } from './components/map/nav'
import { SettingsShell } from './components/Layout'
import { SettingsPage } from './pages/SettingsPage'

/**
 * Toute l'application se consulte sur la carte plein écran ; seuls les Paramètres sont une page à part.
 * Adresses : #/ (carte), #/actus, #/meteo, #/agenda, #/infos, #/transports, #/gare, #/cars, #/settings.
 */
export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Normalise les anciennes adresses (#/news → #/actus…) sans ajouter d'entrée d'historique
  useEffect(() => {
    const want = hashFor(route)
    if (window.location.hash !== want && !(want === '#/' && window.location.hash === '')) {
      history.replaceState(null, '', want)
    }
  }, [route])

  useEffect(() => {
    document.title = route.view === 'settings' ? 'Paramètres · Chouette Dijon'
      : route.panel ? `${panelTitle(route.panel)} · Chouette Dijon` : 'Chouette Dijon'
  }, [route])

  const go = useCallback((r: Route) => { window.location.hash = hashFor(r) }, [])
  const onPanel = useCallback((panel: PanelId | null) => go({ view: 'map', panel }), [go])

  if (route.view === 'settings') {
    return (
      <SettingsShell onBack={() => go({ view: 'map', panel: null })}>
        <SettingsPage />
      </SettingsShell>
    )
  }
  return <MapApp panel={route.panel} onPanel={onPanel} onSettings={() => go({ view: 'settings' })} />
}
