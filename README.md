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

### Traffic prediction (Phase 4)

The Python ML service (XGBoost) runs separately:

```bash
python -m pip install -r services/prediction/requirements.txt
cd services/prediction
python -m data.generate_dataset --runs 40 --out data          # dataset from SUMO runs
python -m training.train --dataset data/training_dataset.csv  # trains + evaluates
python -m uvicorn inference.service:app --port 8100           # POST /predict, GET /health
```

Point the backend at it via `PREDICTION_SERVICE_URL=http://127.0.0.1:8100`
in `apps/api/.env`. The backend then predicts traffic at +30/+60/+90/+120 s
for every signalized junction from live simulation state:

```bash
curl http://127.0.0.1:3000/api/predictions
```

Without the service the API reports `source: "unavailable"` and falls back
deterministically (recent valid prediction first, then a damped-trend
estimate) — traffic control is never interrupted. Measured model metrics
are in `services/prediction/evaluation/evaluation_report.json`.

### Green corridor (Phase 5 — the core USP)

```bash
# Requires an active emergency (route + ETA). The backend plans a
# conflict-free green window per upcoming junction from the emergency ETA,
# live signal state, predictions and downstream capacity, validates it with
# explicit safety constraints, activates it, and rolls it with the vehicle.
curl -X POST http://127.0.0.1:3000/api/corridors \
     -H "content-type: application/json" -d '{"eventId":1}'

curl http://127.0.0.1:3000/api/corridors          # list corridors
curl http://127.0.0.1:3000/api/corridors/1        # per-junction windows/states/status
curl -X POST http://127.0.0.1:3000/api/corridors/1/cancel \
     -H "content-type: application/json" -d '{"reason":"operator request"}'
curl -X POST http://127.0.0.1:3000/api/corridors/1/activate
```

Safety: corridor greens give green ONLY to the emergency approach (all other
movements red), yellow clearance is scheduled when cutting a live green,
green/red extension limits and downstream spillback/capacity are enforced,
and every commanded junction is restored to the normal program on passage
or at window end. Corridor timing bounds are configurable (`CORRIDOR_*` env
vars).

### Closed loop + baseline vs ITMS comparison (Phase 6)

The closed loop re-evaluates continuously (sim-time cadence, configurable
via `LOOP_*`/`ROUTE_SWITCH_*` env vars): prediction refresh, route
re-evaluation with hysteresis safeguards, corridor re-planning on route
change, multi-emergency priority policy.

```bash
# Baseline vs ITMS comparison (two sequential deterministic runs):
curl -X POST http://127.0.0.1:3000/api/scenarios/compare \
     -H "content-type: application/json" \
     -d '{"type":"ambulance","origin":"W1","destination":"E2","priority":"critical"}'
# -> 202 with a job id; poll:
curl http://127.0.0.1:3000/api/scenarios/compare/<jobId>
curl http://127.0.0.1:3000/api/scenarios/runs     # recorded run metrics
```

Measured example (6-junction network, ambulance W1→E2): baseline travel
162 s vs ITMS 82 s (−49.4%), avg vehicle delay 21.94 s vs 15.66 s, avg queue
25.59 vs 21.78, avg speed 6.09 vs 6.36 m/s, throughput 18.65 vs 31.86/h.
All values come from the simulation; rerunning reproduces them exactly.

## Tests

```bash
npm run typecheck         # TypeScript strict check (api + types)
npm run test:api          # unit + integration tests (SUMO + PostgreSQL required)
npm run test:prediction   # Python ML pipeline tests (pytest; SUMO + deps required)
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
- Phase 4 — AI Traffic Prediction: complete.
- Phase 5 — Predictive Rolling Green Corridor: complete.
- Phase 6 — Closed-Loop Optimization: complete.
- Phase 7 — Command Center: complete (`apps/web`, Next.js).

## Command Center (apps/web)

```bash
cd apps/web
cp .env.example .env.local     # NEXT_PUBLIC_API_URL
npm run dev                    # http://localhost:3001
```

Pages: `/` Command Center (live map + emergency/corridor/signals/AI panels),
`/traffic`, `/emergencies`, `/signals`, `/corridors`, `/simulator`
(controls + scenario builder + baseline vs ITMS runner), `/analytics`,
`/decisions` (AI decision trace), `/settings` (system health).
Everything reads real backend state (REST + WebSocket); loading/empty/error/
disconnected/stale states are rendered when data is not fresh.
