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

Phase 3 — Emergency Vehicle + Intelligent Routing — implemented and verified.

## Completed

- [x] Repository initialized
- [x] Documentation created
- [x] SUMO installed/configured (SUMO 1.27.1 via `pip install eclipse-sumo`)
- [x] Initial road network created (6 signalized intersections, 3x2 grid)
- [x] TraCI connection working (Node.js 24, TypeScript, raw TCP TraCI client)
- [x] Traffic collector working (per-step snapshots: vehicles, signals, queues)
- [x] PostgreSQL/PostGIS configured (Postgres 16 + PostGIS 3.4 via docker compose, host port 5433)
- [x] Emergency vehicle implemented (dynamic creation via API: ambulance, fire engine, police)
- [x] A* routing implemented (deterministic, congestion-adjusted, unit-tested)
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
   ├── modules/routing/             (Phase 3)
   │    ├── road-graph              junction/segment graph with live traffic weights
   │    ├── astar                   deterministic A* (binary heap, tie-break by id)
   │    └── route-engine            congestion-adjusted cost model + route validation
   │
   ├── modules/emergency/           (Phase 3)
   │    └── emergency-service       create workflow (validate→route→persist→spawn),
   │                                 per-step tracking, ETA per controlled junction,
   │                                 arrival detection via SUMO arrived-vehicle list
   │
   ├── modules/websocket/           /ws endpoint + WsBus broadcast (traffic/vehicle/signal/
   │                                 emergency:created, emergency:update, route:updated, alert)
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
- `simulation/sumo/scenarios/emergency/`: same traffic as baseline. Since
  Phase 3 the hardcoded ambulance (amb1) was REMOVED (documented in
  Decisions): emergency vehicles are created dynamically via
  POST /api/emergency, which routes with A* over live traffic and spawns
  the vehicle in SUMO.
- `simulation/sumo/network/emergency-fleet.add.xml` (loaded by both
  scenarios): vTypes emergency.ambulance / emergency.fireengine /
  emergency.police (vClasses emergency / authority per SUMO class list).
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

Phase 3 — Emergency Vehicle + Intelligent Routing: emergency events for
ambulance/fire engine/police created via POST /api/emergency are routed with
A* over congestion-adjusted travel times (live Phase 2 traffic), persisted
(emergency_vehicles, emergency_events, routes, route_segments), spawned in
SUMO with the computed route, tracked per step (position/speed/route index
from the simulation snapshots), given ETAs to every upcoming controlled
intersection and the destination, and arrival-detected via SUMO's
arrived-vehicle list — verified with unit + integration tests and a live
HTTP run (W1→E2 ambulance: route W1→I1→I2→I3→I6→E2, arrived at sim time ~195 s).

## Current Task

None (Phase 3 done).

## Files Changed

Phase 3 (this session):
- apps/api/src/modules/routing/: road-graph.ts, astar.ts, route-engine.ts (new)
- apps/api/src/modules/emergency/: emergency-service.ts, routes.ts (new)
- apps/api/src/database/migrations/002_phase3.sql (new)
- apps/api/src/database/repositories/emergency-repository.ts (new)
- apps/api/src/modules/simulation/traci/: constants.ts (+ route/vehicle lifecycle/sim id vars),
  codec.ts (+ string list, compound header, typed int encoders), client.ts (+ addRoute, getRouteEdges,
  addVehicle, removeVehicle, setVehicleRoute, getVehicleRouteId/Index/WaitingTime, arrived/pending id reads)
- apps/api/src/modules/simulation/simulation-manager.ts (+ addVehicleRoute/addVehicle/removeVehicle/
  getArrivedVehicleIds/getPendingVehicleIds gateway, catalog accessor)
- apps/api/src/modules/traffic/traffic-service.ts (+ getCurrentRunId, per-step road-graph weight refresh)
- apps/api/src/: app.ts (+ emergency routes), main.ts (+ routing/emergency wiring)
- packages/types/src/index.ts (+ emergency types, WS event types)
- simulation/sumo/network/emergency-fleet.add.xml (new); both sumocfgs load it;
  emergency.rou.xml: removed hardcoded amb1 + its route/vType (documented)
- apps/api/test/: helpers.ts (+ routing/emergency harness wiring), routing.test.ts (new, 12),
  emergency.integration.test.ts (new, 2), api.integration.test.ts (WS test extended to
  emergency events), manager.integration.test.ts (emergency-scenario test updated for dynamic flow)
- README.md (emergency API usage)

Phase 2: see previous entry; Phase 1: see git history / prior entries.

## Tests Run

- `npm run typecheck` (apps/api + @itms/types) — pass
- `npm run build:network` (netconvert) — pass
- `npm test` (`node --test --test-concurrency=1 "test/*.test.ts"`) — 78/78 pass (~90 s):
  - codec/reader unit tests (16)
  - traffic metrics unit tests (11)
  - network-loader unit tests (5)
  - config unit tests (6)
  - routing unit tests: A* path choice by travel time, reroute on expensive direct edge,
    unreachable goals, start==goal, unknown endpoints, determinism (tie-breaking), road graph
    structure, W1→E2 route validity/connectivity, congestion cost raise + speed floor,
    endpoint validation, disconnected-segment detection, all 30 grid pairs routable (12)
  - TraCI client integration vs real SUMO (7)
  - simulation manager integration (9)
  - vehicle-reaction acceptance (1)
  - pipeline integration (real SUMO + PostgreSQL) (3)
  - API integration: Phase 1 contract + Phase 2 traffic APIs + WS delivery of traffic/vehicle/
    signal/emergency:created/route:updated events (4)
  - emergency integration (real SUMO + PostgreSQL) (2): creation requires running sim (409),
    201 with full detail, route validity (origin/destination/connectivity/network existence),
    SUMO route equals computed route, vehicle appears with emergency vType, position updates,
    ETAs for controlled junctions + destination (monotone), arrival detected, DB rows for
    event/vehicle/route/route_segments; list/detail/404/400/422 errors; fire engine + police
    creation
- Live server check (real node process + dockerized PostGIS): start baseline → POST
  /api/emergency ambulance W1→E2 → 201: route `W1→I1→I2→I3→I6→E2` (5 edges, 717 m,
  est 110 s vs free-flow 52 s — congestion-adjusted), vehicle emv-baseline-1 created →
  status active with live position/speed from SUMO → ETAs I1 16.9s, I2 29.8s, I3 42.7s,
  I6 55.6s, E2 62.1s → ambulance traveled through SUMO → status arrived at sim time ~195 s →
  DB: emergency_events(1, arrived, W1→E2, critical), emergency_vehicles(ambulance, arrived),
  routes(astar, 5 edges, 717 m), route_segments(5 rows) → stop → idle.
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
- ETA while the vehicle crosses an intersection (internal edge) falls back
  to full-route ETAs (documented); refined per-edge progress tracking can be
  added later if needed (Phase 6 recalculation will recompute anyway).
- Emergency vehicle spawn can be deferred by SUMO when the departure edge is
  blocked; the event stays "created" until insertion succeeds (exposed in
  the API rather than faked as active).
- Node type stripping requires erasable-only TypeScript syntax in this repo
  (no enums/namespaces); enforced via tsconfig `erasableSyntaxOnly`.

## Next Task

Phase 4 — AI Traffic Prediction:
1. Generate training data with SUMO (multiple scenarios/traffic levels; use the Phase 2 collector + persistence to export features: timestamp, intersection_id, vehicle_count, average_speed, queue_length, density, flow_rate, signal_state/phase, hour, day_of_week).
2. Dataset layout data/traffic/{raw,processed,training} with train/val/test splits (never train and test on the same run).
3. Feature engineering + XGBoost model predicting traffic at +30/+60/+90/+120 s.
4. Evaluation (MAE/RMSE/R², inference latency) on held-out data — report only measured numbers.
5. Python prediction service (POST /predict) + Node.js client integration with fallback when the service is unavailable.

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

### Decision 12 (Phase 3)
The hardcoded ambulance (amb1) was removed from the emergency scenario:
emergency vehicles are created dynamically via POST /api/emergency, which
computes an A* route over live traffic and spawns the vehicle. This makes
baseline-vs-ITMS comparisons meaningful later (no always-present ambulance)
and exercises the real Phase 3 workflow.

### Decision 13 (Phase 3)
Routing edge cost is congestion-adjusted travel time in seconds:
effective speed = measured average speed (Phase 2) clamped to
[freeFlow*0.1, freeFlow]; no measured data => free flow. Effective speed is
capped at free flow so the straight-line/max-speed A* heuristic stays
admissible. A* tie-breaking is deterministic (f, then junction id).

### Decision 14 (Phase 3)
Origin/destination are junction ids; the vehicle is inserted at the start
of the first route edge (departPos base) — "origin junction" semantics.
All 30 junction pairs of the 3x2 grid are routable (unit-tested).

### Decision 15 (Phase 3)
SUMO vClasses for emergency types: ambulance/fire engine = "emergency",
police = "authority" (per SUMO's vehicle class list; "firetruck"/"police"
are not valid vClasses).

### Decision 16 (Phase 3)
Arrival detection uses SUMO's authoritative arrived-vehicle id list
(sim domain 0x7a) each step rather than inferring from edge position.

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
