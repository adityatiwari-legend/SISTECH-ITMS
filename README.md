# ITMS — Intelligent Traffic Management System

AI-powered traffic management and simulation platform with the core USP:
**Predictive Rolling Green Corridor** for emergency vehicles, operated on a
digital traffic twin built with SUMO.

## Repository layout

```text
itms/
├── apps/
│   ├── api/            Node.js + TypeScript backend (SUMO TraCI control, REST API)
│   └── web/            Next.js command center (later phase)
├── services/
│   └── prediction/     Python + XGBoost traffic prediction service (later phase)
├── packages/
│   ├── types/          Shared TypeScript types
│   └── algorithms/     A* and corridor algorithms (later phase)
├── simulation/
│   └── sumo/           SUMO network sources, scenarios and build scripts
├── data/               Traffic datasets (later phase)
└── DOCs/               PRD, Architecture, Rules, Phases, Design, Memory
```

## Prerequisites

- Node.js >= 24.7 (TypeScript is executed directly via type stripping)
- SUMO (headless `sumo` binary); easiest on Windows: `pip install eclipse-sumo`
  (also available via SUMO_HOME or `SUMO_BINARY` env var)
- PostgreSQL 16 + PostGIS 3.4 (from Phase 2 on); local development:
  `cp docker/.env.example docker/.env` (set a password), then
  `docker compose --env-file docker/.env up -d db`
  (host port 5433; a native PostgreSQL often occupies 5432)

## Quick start (Phase 1 + 2)

```bash
npm install
npm run build:network     # builds simulation/sumo/network/itms.net.xml
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL
npm run dev:api           # starts the API on http://127.0.0.1:3000
```

### Control the simulation

```bash
curl -X POST http://127.0.0.1:3000/api/simulation/start -d "{}" -H "content-type: application/json"
curl http://127.0.0.1:3000/api/simulation/state
curl http://127.0.0.1:3000/api/signals
curl http://127.0.0.1:3000/api/vehicles

# Force intersection I2 to all-red (state length = number of controlled links)
curl -X POST http://127.0.0.1:3000/api/signals/I2/state \
     -H "content-type: application/json" \
     -d '{"state":"rrrrrrrrrrrrrrrr"}'

curl -X POST http://127.0.0.1:3000/api/simulation/stop
```

### Traffic intelligence (Phase 2)

```bash
curl http://127.0.0.1:3000/api/traffic                  # live city state (+ stale/system flags)
curl http://127.0.0.1:3000/api/traffic/roads            # road registry (PostgreSQL)
curl http://127.0.0.1:3000/api/traffic/intersections    # intersection registry + live queues
```

WebSocket events (Node, browser or `websocat ws://127.0.0.1:3000/ws`):

```text
traffic:update   per-interval city state (segments, intersections, summary)
vehicle:update   live vehicle list (from SUMO)
signal:update    live signal states/queues
system:alert     simulation disconnect / database problems
```

Collection runs in lock-step with the simulation; persistence is throttled
(`TRAFFIC_PERSIST_EVERY_TICKS`, default 5 s of sim time) and WebSocket
broadcasts are paced (`TRAFFIC_EVENT_INTERVAL_MS`, default 1000 ms).
Congestion thresholds are configurable via `TRAFFIC_CONGESTION_*` env vars.

The emergency scenario carries an ambulance from the EMS station (western
entry) to the City Hospital (eastern entry):

```bash
curl -X POST http://127.0.0.1:3000/api/simulation/start \
     -H "content-type: application/json" -d '{"scenario":"emergency"}'
```

### Emergency management (Phase 3)

```bash
# Create an emergency: the backend computes an A* route over live traffic
# and spawns the vehicle in SUMO. Requires a running simulation.
curl -X POST http://127.0.0.1:3000/api/emergency \
     -H "content-type: application/json" \
     -d '{"type":"ambulance","origin":"W1","destination":"E2","priority":"critical"}'

curl http://127.0.0.1:3000/api/emergency          # list events
curl http://127.0.0.1:3000/api/emergency/1        # detail: route, live position, ETAs, arrival
```

Supported types: `ambulance`, `fire_engine`, `police`; priorities:
`critical`, `high`, `normal`. Origin/destination are junction ids of the
network (I1..I6 plus boundary stubs). The detail response contains the
route (per-segment), the vehicle's live position/speed/route index, ETAs to
every upcoming controlled intersection and the destination, and the
detected arrival.

## Tests

```bash
npm run typecheck         # TypeScript strict check (api + types)
npm run test:api          # unit + integration tests (SUMO + PostgreSQL required)
```

Integration tests use a real headless SUMO process and the PostgreSQL test
database `itms_test` (create it once: `docker exec itms-db psql -U itms -d
postgres -c "CREATE DATABASE itms_test OWNER itms"` plus `CREATE EXTENSION
postgis;` in it). DB-backed tests are skipped automatically with a clear
note when the database is unreachable.

## Phase status

See `DOCs/Memory.md` for the current implementation state and next steps.

- Phase 1 — Digital Traffic World: complete.
- Phase 2 — Traffic Intelligence Layer: complete.
- Phase 3 — Emergency Vehicle + Intelligent Routing: complete.
- Next: Phase 4 — AI Traffic Prediction.
