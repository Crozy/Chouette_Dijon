# CLAUDE.md — consignes pour travailler sur DIJON HUB

Présentation, installation, sources de données et API : voir `README.md`. Ce fichier ne contient que les règles de travail.

## Git
- **Un commit local après chaque changement** (un par demande), une fois le changement vérifié.
- Message en français, court, décrivant le changement.
- N'ajouter que les fichiers modifiés : jamais `.env`, `backend/data/`, `dist/`, `node_modules/`, `.venv/`.
- **Jamais de `push`** ni de dépôt distant sans demande explicite.

## Vérifier avant de commiter
- Frontend : `cd frontend && npx tsc --noEmit -p .` (et `npm run build` pour un changement important).
- Backend : `cd backend && .venv/bin/python -m pytest -q` (Python du venv, pas celui du système).
- En développement, le backend tourne avec `--reload` (port 8000) et Vite sur 5173 : inutile de les relancer, sauf après une modification de `.env` (le backend doit alors être redémarré).

## Organisation
- **L'interface est entièrement centrée sur la carte plein écran** (`frontend/src/components/map/`) : `MapApp.tsx` (carte et état), `layers.ts` (couches MapLibre), `TopBar`, `Rail`, `Panel`, et un panneau par contenu dans `panels/`. Seuls les Paramètres sont une page à part (`pages/SettingsPage.tsx`). Adresses : `#/`, `#/transports`, `#/gare`, `#/lieu/<id>`… (voir `map/nav.ts`).
- Backend FastAPI : un connecteur par source dans `backend/app/services/`, données de démonstration dans `backend/app/fallback/data.py`.

## Règles
- **Honnêteté des données** : toute donnée non mesurée en temps réel doit être signalée dans l'interface. Badges : `LIVE`, `PRÉVU` (horaires officiels sans temps réel), `SIMULÉ`. L'affluence et la circulation sans clé TomTom sont des **estimations** et doivent rester marquées comme telles.
- Chaque source doit avoir une solution de repli (données de démonstration) et déclarer son état via `registry.record(...)`.
- Les clés API restent côté serveur (`.env`), jamais dans le code ni dans le navigateur.
- Sources sans API officielle (La Vapeur, Zénith, ESPN) : interroger rarement (cache de 6 h), toujours citer la source et renvoyer vers la page officielle.
- Interface en français ; afficher l'heure en `Europe/Paris`.
