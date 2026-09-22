# ITMS — Development Memory

> This file is intentionally a lightweight living project log. Update it after meaningful implementation work. Do not attempt to write the entire codebase into this file.

## Purpose

Memory.md keeps the coding agent aligned with the current implementation state when work moves between chats, agents, or sessions.

## Current Project

**Project:** ITMS — Intelligent Traffic Management System

**Core USP:** Predictive Rolling Green Corridor.

**Primary simulation:** SUMO + TraCI.

**Backend:** Node.js + TypeScript.

**Frontend:** Next.js + TypeScript.

**Database:** PostgreSQL + PostGIS.

**ML:** Python + XGBoost for traffic prediction.

## Current Phase

Phase 2 — Traffic Intelligence Layer — implemented and verified.

## Completed

- [x] Repository initialized
- [x] Documentation created
- [x] SUMO installed/configured (SUMO 1.27.1 via `pip install eclipse-sumo`)
- [x] Initial road network created (6 signalized intersections, 3x2 grid)
- [x] TraCI connection working (Node.js 24, TypeScript, raw TCP TraCI client)
- [x] Traffic collector working (per-step snapshots: vehicles, signals, queues)
- [x] PostgreSQL/PostGIS configured (Postgres 16 + PostGIS 3.4 via docker compose, host port 5433)
- [ ] Emergency vehicle implemented (scenario + vType exist; emergency management is Phase 3)
- [ ] A* routing implemented
- [ ] Traffic prediction dataset created
- [ ] XGBoost trained
- [ ] Prediction API implemented
- [ ] Green Corridor Engine implemented
- [ ] Signal optimizer implemented
- [ ] Closed-loop optimization working
- [ ] Command Center UI implemented
- [ ] Baseline scenario implemented (simulation-only baseline for comparison runs)
- [ ] ITMS scenario implemented
- [ ] Analytics implemented
- [ ] Final demo verified

## Current Architecture

```text
Fastify API (apps/api, Node.js 24 + TypeScript, run via native type stripping)
   ├── modules/simulation/          (Phase 1 control layer)
   │    ├── traci/                  raw TCP TraCI client (protocol-verified vs SUMO 1.27.1)
   │    ├── sumo-process            spawns headless SUMO on a free port (--remote-port)
   │    ├── network-loader          parses itms.net.xml into the network catalog
   │    └── simulation-manager      lifecycle, paced step loop, snapshots,
   │                                 setRedYellowGreenState, step/started/stopped hooks
   │         ↓
   │    SUMO + TraCI (remote mode, TCP)
   │
   ├── modules/traffic/             (Phase 2 intelligence layer)
   │    ├── metrics                 pure aggregation + congestion classification (unit-tested)
   │    ├── collector               per-step edge/approach reads → TrafficState
   │    └── traffic-service         lock-step collection, throttled persistence,
   │                                 paced WebSocket broadcast, run identity
   │
   ├── modules/websocket/           /ws endpoint + WsBus broadcast
   │
   └── database/                    (Phase 2)
        ├── db                      pg Pool wrapper (health, transactions)
        ├── migrate                 file-based SQL migration runner (schema_migrations)
        └── repositories/           network registry, simulation runs, traffic persistence
             ↓
        PostgreSQL 16 + PostGIS 3.4 (docker compose, host port 5433)

Python ML Service (Phase 4)
Next.js Command Center (Phase 7)
```

## Current Working Scenario

- `simulation/sumo/scenarios/baseline/`: 14 deterministic flows (cars, one bus
  flow, one truck flow) over a 6-intersection 3x2 signalized grid (I1..I6),
  600 s duration, boundary stubs W1/W2/E1/E2/S1/S2/S3/N1/N2/N3.
- `simulation/sumo/scenarios/emergency/`: same traffic plus one ambulance
  (vType `emergency`, vClass ambulance) departing at t=30 from the EMS
  station (W1) to the City Hospital (E2).
- Facilities POIs: hospital_central (near E2), ems_station_west (near W1),
  fire_station_south (near S3) in `simulation/sumo/network/facilities.add.xml`.
- Network built with netconvert from `itms.nod.xml` + `itms.edg.xml`
  (`npm run build:network`); generated `itms.net.xml` is committed.

## Current Database State

Implemented (Phase 2). `itms` database (dev) and `itms_test` (tests) on
Postgres 16 + PostGIS 3.4, host port 5433 (native PostgreSQL 18 occupies
5432 on this machine). Schema via migration `001_phase2.sql`:
simulation_runs, intersections (PostGIS Point), roads, road_segments
(PostGIS LineString), traffic_signals, signal_phases, vehicles (run-scoped
registry), traffic_snapshots, signal_snapshots — indexed on run/segment/
signal/time. Geometry uses SRID 0 because the SUMO network is not
geo-referenced (projParameter "!").

## Current ML State

Not implemented yet (Phase 4).

## Current UI State

Not implemented yet (Phase 7 by plan).

## Last Completed Task

Phase 2 — Traffic Intelligence Layer: the pipeline
SUMO → TraCI → TrafficCollector → TrafficProcessor (deterministic metrics +
congestion classification) → PostgreSQL/PostGIS → Traffic APIs → WebSocket
events, verified with unit tests, real-SUMO + real-PostgreSQL integration
tests, and a live server run.

## Current Task

None (Phase 2 done).

## Files Changed

Phase 2 (this session):
- apps/api/src/database/: db.ts (pg Pool wrapper), migrate.ts (runner), migrations/001_phase2.sql
- apps/api/src/database/repositories/: network-repository.ts, run-repository.ts, traffic-repository.ts
- apps/api/src/modules/traffic/: metrics.ts, collector.ts, traffic-service.ts, routes.ts
- apps/api/src/modules/websocket/: ws-bus.ts, routes.ts
- apps/api/src/modules/simulation/: network-loader.ts (new), simulation-manager.ts (extended: completed
  status, onStep/onStarted/onStopped/onDisconnect listeners, getTraCIClient, TraCI onClosed wiring)
- apps/api/src/modules/simulation/traci/: constants.ts (+ edge command/response, occupancy), client.ts (+ onClosed)
- apps/api/src/config.ts (DATABASE_URL required, network path, traffic intervals, congestion thresholds)
- apps/api/src/: app.ts (websocket plugin + traffic routes), main.ts (DB + migrations + wiring)
- apps/api/test/: helpers.ts (test harness, DB helpers), metrics.test.ts, network-loader.test.ts,
  config.test.ts, pipeline.integration.test.ts (new), api.integration.test.ts (rewritten with harness)
- apps/api/.env.example (DB + traffic settings), apps/api/.env (local, gitignored)
- docker-compose.yml (postgis alpine image, host port 5433), docker/.env (local, gitignored)
- README.md (Phase 2 usage), packages/types/src/index.ts (traffic types)

Phase 1 (previous sessions): see git history / prior entries — apps/api
simulation+traci modules, packages/types, simulation/sumo network+scenarios,
root scaffolding.

## Tests Run

- `npm run typecheck` (apps/api + @itms/types) — pass
- `npm run build:network` (netconvert) — pass
- `npm test` (`node --test --test-concurrency=1 "test/*.test.ts"`) — 64/64 pass (~75 s):
  - codec/reader unit tests (16)
  - traffic metrics unit tests: count/speed/queue/density/flow calculations, congestion
    classification levels + threshold configurability, city summary, input validation (11)
  - network-loader unit tests: 16 junctions, 34 segments, 17 roads, 6 signals with 4 phases,
    lane shapes, no geo-reference (5)
  - config unit tests: DATABASE_URL required/validated, congestion threshold overrides +
    monotonicity validation (6)
  - TraCI client integration vs real SUMO (7)
  - simulation manager integration incl. missing-SUMO-binary path, pause/resume freeze (9)
  - vehicle-reaction acceptance: vehicle stops after I2 forced to red (1)
  - pipeline integration (real SUMO + real PostgreSQL, skipped clearly if DB unreachable) (3):
    collection correctness vs live state, congestion from forced red, exact persistence match,
    run identity (running→completed / disconnected→failed), vehicle registry, system:alert,
    stale-after-stop behavior, registry endpoints empty-before-start (no fabricated data)
  - API integration: Phase 1 contract preserved + Phase 2 traffic APIs + WebSocket event
    delivery of all three event types with live payloads (4)
- Live server check (real node process + dockerized PostGIS): boot → idle/stale → start
  emergency → /api/traffic fresh (simTime 8, 15 vehicles, avg speed 9.2 m/s) → /api/traffic/roads
  17 → /api/traffic/intersections 16 → WS client received vehicle:update, signal:update,
  traffic:update with live payloads → DB had 238 segment snapshots / 42 signal snapshots /
  42 vehicle registry rows / run `1:emergency:running` → set I2 all-red → queues grew to 13
  halted, city level CRITICAL (derived from simulation data) → stop → run status `completed`.

## Results

- Phase 1: Node.js can connect to SUMO via TraCI, read traffic information,
  change a signal, and observe vehicles responding — verified by tests.
- Phase 2: the backend answers "what is happening in the city right now?"
  with values measured from the running simulation (per-segment counts,
  speeds, queues, occupancy, flow from edge transitions; per-signal state,
  phase, timing, queues), persists them with run identity, classifies
  congestion from configurable thresholds, exposes typed APIs and paced
  WebSocket events, and degrades safely on SUMO disconnect or DB failure.

## Known Issues

- SUMO binaries are provided via `pip install eclipse-sumo` on this machine;
  `sumo`/`netconvert` resolve through PATH. SUMO_BINARY/SUMO_HOME supported as fallbacks.
- TraCI coordinates are SUMO network coordinates (netOffset 0,0, not
  geo-referenced; geometry stored with SRID 0 deliberately).
- SUMO accepts only one TraCI connection per process; the API manages a
  single simulation at a time (by design).
- Pedestrian phases are not yet modeled in the network (sidewalks omitted);
  pedestrian safety must be added to the corridor safety engine in Phase 5.
- A native PostgreSQL 18 Windows service occupies host port 5432; the ITMS
  database therefore maps to host port 5433 in docker-compose.yml.
- Integration tests run with --test-concurrency=1 because DB-backed test
  files share the itms_test database (parallel files would interfere).
- WebSocket vehicle:update sends the full vehicle list per broadcast
  (bounded, ~10-20 KB at current fleet size); fine for Phase 2 scale,
  revisit if the fleet grows orders of magnitude.
- Node type stripping requires erasable-only TypeScript syntax in this repo
  (no enums/namespaces); enforced via tsconfig `erasableSyntaxOnly`.

## Next Task

Phase 3 — Emergency Vehicle + Intelligent Routing:
1. Road graph from the network catalog (nodes = junctions, edges = segments, dynamic costs from live traffic).
2. A* route engine (deterministic, unit-tested; cost = travel time + congestion).
3. Emergency management: emergency_vehicles/emergency_events tables + POST/GET /api/emergency.
4. Emergency vehicle control in SUMO: spawn at origin (EMS station), assign route, read position/speed, update route, detect arrival at hospital.
5. ETA calculation to destination and each upcoming intersection.

## Decisions

### Decision 1
Use SUMO as the digital traffic twin.

### Decision 2
Use XGBoost for the first traffic prediction model.

### Decision 3
Use A* for route optimization.

### Decision 4
Implement Green Corridor as an optimization/decision engine, not an ML model.

### Decision 5
Use ML only where prediction is genuinely useful.

### Decision 6
Build the core traffic-control loop before polishing the UI.

### Decision 7 (Phase 2)
Traffic metrics come from SUMO edge-domain reads (count, halting, occupancy,
mean speed) instead of recomputing from lane reads; mean speed is gated on
vehicle count > 0 because SUMO reports the speed limit for empty edges.

### Decision 8 (Phase 2)
Flow rate is derived from observed vehicle edge transitions between ticks
(no SUMO detectors added yet); documented and deterministic.

### Decision 9 (Phase 2)
Congestion classification is a pure function over three real signals
(speed ratio, occupancy, queue length) with thresholds from configuration;
empty segments are always LOW.

### Decision 10 (Phase 2)
Geometry uses SRID 0 (undefined CRS) because the SUMO network is not
geo-referenced; switching to a geo-referenced SRID happens when map/GPS
support is added.

### Decision 11 (Phase 2)
In-lockstep collection: the simulation manager awaits the traffic
collector's reads after each step, so the API state is exactly at the last
simulated step; persistence is throttled and serialized off the step loop.

## Important Constraints

- Do not fabricate simulation metrics.
- Do not claim a feature works until tested.
- Do not hard-code live-looking values in the final demo.
- Do not turn every signal green for an emergency.
- Preserve pedestrian and traffic safety constraints.
- Keep frontend/backend/simulation/ML responsibilities separate.

## Agent Handoff Format

After each significant coding session, update:

```text
## Last Completed Task
...

## Current Task
...

## Files Changed
...

## Tests Run
...

## Results
...

## Known Issues
...

## Next Task
...
```

This section is the primary handoff area for the next coding session.
