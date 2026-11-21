# Chouette Dijon — la métropole en temps réel

Tableau de bord web temps réel pour la métropole de Dijon : transports (Divia, Vélodi, gare SNCF, gare routière, covoiturage), actualités locales, météo et qualité de l'air, agenda culturel et sportif, alertes et numéros utiles.

**2 skins × 2 modes**, au choix dans *Paramètres* (ou via l'URL) :

| Skin | Sombre | Clair |
|---|---|---|
| **Bourgogne** — lie-de-vin, moutarde de Dijon, tuiles vernissées, chouette, titres serif | `?skin=bourgogne&mode=dark` | `?skin=bourgogne&mode=light` |
| **Control Center** — bleu nuit, cyan, esthétique « centre de contrôle » | `?skin=tech&mode=dark` | `?skin=tech&mode=light` |

Le bouton soleil/lune de la barre supérieure bascule rapidement entre sombre et clair. Les préférences sont mémorisées dans le navigateur ; les paramètres d'URL sont pratiques pour un écran en mode kiosque.

## Démarrage rapide (Docker)

```bash
cp .env.example .env        # facultatif : ajoutez vos clés API
docker compose up -d --build
# → http://localhost:8080
```

## Développement local

Prérequis : Python 3.11+ et Node 18+.

```bash
# Backend (port 8000)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload

# Frontend (port 5173, /api relayé vers le backend)
cd frontend
npm install
npm run dev
```

Tests backend (dont décodage réel du GTFS-RT Divia et d'Open-Meteo, ignorés hors-ligne) :

```bash
cd backend && .venv/bin/python -m pytest
```

Documentation interactive de l'API : http://localhost:8000/docs

## Sources de données

Chaque connecteur bascule automatiquement sur un jeu de données réaliste si une clé manque ou si le flux est indisponible. L'interface l'indique par un badge **● LIVE**, **◐ SIMULÉ** ou **✕ ERREUR**, et l'état détaillé de chaque source est visible dans *Paramètres*.

| Module | Source | Clé | Sans clé / en panne |
|---|---|---|---|
| Bus & trams (positions) | GTFS-RT Divia — transport.data.gouv.fr | non | trams simulés le long des tracés réels |
| Lignes, couleurs, destinations, tracés | GTFS statique Divia (téléchargé au démarrage, cache disque 24 h) | non | tracés approximatifs |
| Vélodi | GBFS (`VELODI_GBFS_URL`) | URL | disponibilités simulées sur 20 stations |
| Trains Dijon-Ville | API SNCF / Navitia (`SNCF_API_KEY`) | oui | horaires TGV INOUI / TER / OUIGO / Lyria générés |
| FlixBus, BlaBlaCar Bus, covoiturage | données structurées locales (pas d'API publique) | — | toujours simulé |
| Météo + qualité de l'air | Open-Meteo | non | météo simulée |
| Presse locale | RSS : Le Bien Public, ici Bourgogne, Ville de Dijon (`RSS_FEEDS`) | non | articles d'exemple |
| Réseaux sociaux | flux RSS/Atom au choix (`SOCIAL_FEEDS` : Mastodon, RSS-Bridge…) | non | publications d'exemple |
| Événements | OpenAgenda (`OPENAGENDA_KEY` + `OPENAGENDA_AGENDA_UID`) | oui | agenda local (La Vapeur, Zénith, Musée des Beaux-Arts, DFCO…) |
| Alertes trafic | GTFS-RT Service Alerts (`DIVIA_GTFS_RT_ALERTS_URL`) | URL | alertes d'exemple |

> À noter : au moment de l'écriture, aucun flux GBFS public DiviaVélodi n'est référencé sur transport.data.gouv.fr. Les disponibilités Vélodi sont donc simulées tant que `VELODI_GBFS_URL` n'est pas renseignée. Les positions des stations de démonstration sont approximatives.

`FORCE_DEMO=true` force toutes les sources en mode simulé (démonstration hors-ligne).

## API

| Endpoint | Description | Cache |
|---|---|---|
| `GET /api/transports/vehicles` | positions bus/trams | 12 s |
| `GET /api/transports/lines` | tracés GeoJSON des trams | — |
| `GET /api/transports/velodi` | stations Vélodi | 60 s |
| `GET /api/transports/meeting-points` | gare, gare routière, points covoiturage | — |
| `GET /api/transports/board?direction=departures\|arrivals` | tableau Infogare unifié | 60 s |
| `GET /api/news`, `GET /api/news/social` | presse, réseaux sociaux | 10 min |
| `GET /api/weather` | météo + qualité de l'air | 10 min |
| `GET /api/events?category=` | agenda | 30 min |
| `GET /api/infos` | alertes + numéros utiles | 2 min |
| `GET /api/status`, `POST /api/status/refresh` | état des sources / test complet | — |

Chaque réponse suit le format `{ "meta": { "status": "live|simulated|error", … }, "data": … }`.

## Structure

```
backend/   FastAPI · httpx · gtfs-realtime-bindings · feedparser · cache TTL mémoire
  app/services/   un connecteur par source (avec fallback)
  app/fallback/   données de démonstration dijonnaises
frontend/  React · TypeScript · Vite · Tailwind · MapLibre GL · lucide-react
  src/index.css   variables de thème (2 skins × 2 modes)
docker-compose.yml   backend + frontend (nginx, proxy /api)
```

Fonds de carte : CARTO (Dark Matter, Positron, Voyager), sans clé API. © OpenStreetMap contributors.
