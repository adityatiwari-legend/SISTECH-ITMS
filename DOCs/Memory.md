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

Phase 7 — Command Center + Final Product — implemented and verified. All 7 phases complete.

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
- [x] Traffic prediction dataset created (40 SUMO runs, 36,000 rows, train/val/test by run)
- [x] XGBoost trained (4 horizon models, bundle + metadata + report on disk)
- [x] Prediction API implemented (FastAPI POST /predict + GET /health; Node client + fallback)
- [x] Green Corridor Engine implemented (planner + safety constraints + rolling executor)
- [x] Signal optimizer implemented (conflict-free RYG states from net.xml link mapping)
- [x] Closed-loop optimization working (loop scheduler, hysteresis-guarded re-routing,
      corridor re-plan triggers, multi-emergency priority policy, metrics + comparison)
- [x] Command Center UI implemented (apps/web: 9 pages over REST + WebSocket)
- [x] Baseline scenario implemented (simulation-only baseline for comparison runs)
- [x] ITMS scenario implemented (comparison runner: identical initial conditions)
- [x] Analytics implemented (measured aggregates + per-run charts)
- [x] Final demo verified (final integration audit: full 20-step E2E passed)

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
   ├── modules/prediction/          (Phase 4)
   │    ├── prediction-client       typed HTTP client (timeout/unavailable/no_model/
   │    │                            invalid_input/invalid_response mapping)
   │    └── prediction-service      periodic per-junction predictions from live traffic,
   │                                 Rule-9 fallback (recent valid → deterministic),
   │                                 cache/staleness, DB persistence, prediction:update
   ├── modules/corridor/            (Phase 5 — the core USP)
   │    ├── corridor-planner        deterministic green windows from ETA + signal state
   │    │                            + predictions (modes: switch/extend/noop/PENDING)
   │    ├── safety-constraints      8 explicit checks (priority, window/red bounds,
   │    │                            clearance, conflict-free state, downstream
   │    │                            capacity, corridor conflict, bounded override)
   │    └── corridor-service        lifecycle (PLANNING→VALIDATING→ACTIVE→REPLANNING→
   │                                 COMPLETED/CANCELLED/FAILED), rolling per-step
   │                                 executor (apply/clearance/restore/replan),
   │                                 corridor:created/corridor:update events
   │
   ├── modules/loop/                (Phase 6)
   │    └── closed-loop-service     sim-time cadence loop: monitoring, prediction
   │                                 refresh, A* route re-eval with hysteresis +
   │                                 safeguards, corridor re-plan trigger
   │
   ├── modules/metrics/             (Phase 6)
   │    └── metrics-recorder        per-step sampling (city summary, per-vehicle
   │                                 SUMO timeLoss), per-run finalization to
   │                                 simulation_metrics
   │
   ├── modules/scenarios/           (Phase 6)
   │    └── scenario-comparison-    sequential baseline vs ITMS runs with identical
   │      service                    initial conditions + delta comparison; APIs:
   │                                 POST /api/scenarios/compare, GET .../:id,
   │                                 GET /api/scenarios/runs
   │
   ├── modules/websocket/           /ws endpoint + WsBus broadcast (traffic/vehicle/signal/
   │                                 emergency:created, emergency:update, route:updated,
   │                                 prediction:update, corridor:created, corridor:update,
   │                                 route:switched, comparison:update, system:alert)
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

Implemented (Phases 2-6). `itms` database (dev) and `itms_test` (tests) on
Postgres 16 + PostGIS 3.4, host port 5433 (native PostgreSQL 18 occupies
5432 on this machine). Migrations: 001_phase2.sql (simulation_runs,
intersections (PostGIS Point), roads, road_segments (PostGIS LineString),
traffic_signals, signal_phases, vehicles (run-scoped registry),
traffic_snapshots, signal_snapshots), 002_phase3.sql (emergency_vehicles,
emergency_events, routes, route_segments), 003_phase4.sql
(traffic_predictions with run identity, source ml|fallback, model_version),
004_phase5.sql (green_corridors, corridor_signals with planned windows,
applied states, applied/passed timestamps), 005_phase6.sql
(simulation_metrics per run (mode baseline|itms), emergency_route_switches,
activated/arrived sim-time columns on emergency_vehicles). BIGINT ids are
parsed as numbers at the pg boundary (setTypeParser for OID 20).

## Current ML State

Implemented (Phase 4), in services/prediction/ (Python only here):
- Dataset: data/generate_dataset.py runs 40 deterministic SUMO scenarios
  (demand 0.3-2.2x, two route mixes, demand periods 7-22h, ~50% of runs have
  a signal all-red incident of varying duration/junction; TraCI
  subscriptions; collection every 2 s). Output:
  data/traffic/processed/training_dataset.csv — 36,000 rows, one per
  (run, junction, t): vehicle_count, avg_speed_mps, queue_length, density,
  flow_rate_per_hour (junction outflow from edge-departure turnover),
  signal_phase, signal_green_fraction, cycle_position_s, hour, day_of_week,
  count/queue lag features + target_count_{30,60,90,120}.
- Split: run-level 70/15/15 (seeded, deterministic, no run spans splits —
  temporal-leakage safe).
- Model: one XGBRegressor per horizon (+30/+60/+90/+120 s), params in
  models/model_metadata.json; bundle traffic_prediction_xgb_h{h}.json.
- MEASURED test metrics (held-out runs gen01,07,08,14,15,17):
  +30s  MAE 3.580  RMSE 5.159  R2 0.911
  +60s  MAE 4.605  RMSE 6.881  R2 0.873
  +90s  MAE 4.969  RMSE 8.343  R2 0.846
  +120s MAE 6.942  RMSE 11.830 R2 0.739
  Inference latency (measured, 2000 calls): 1.01 ms one horizon,
  4.53 ms all four horizons. Full report: evaluation/evaluation_report.json.
- API: FastAPI POST /predict (pydantic validation) + GET /health;
  predictions are vehicle counts per junction approach, clamped >= 0.

## Current UI State

Not implemented yet (Phase 7 by plan).

## Last Completed Task

Phase 7 — Command Center + Final Product: the polished operator UI
(apps/web, Next.js 15 + React 19 + TypeScript + Tailwind + Framer Motion +
MapLibre GL + Recharts + WebSocket) exposing the entire real system:
- `/` Command Center: MapLibre live map (~65%, empty dark style, GeoJSON
  layers: base roads, congestion overlay, corridor glow/route, signal dots
  colored by live RYG state with click popups, facility POIs parsed from
  facilities.add.xml, normal vehicles low-key, emergency vehicle glowing)
  plus the priority-ordered panel stack (active emergency dominant, corridor
  chain 🚑→🟢→🟢→🏥 reflecting REAL per-signal statuses, signals grid, AI
  decision panel from live prediction/corridor state).
- `/traffic`, `/emergencies` (+ creation flow), `/signals` (table with
  labels + corridor association), `/corridors` (real chain + schedule +
  activate/cancel), `/simulator` (start/pause/resume/reset/speed 1-10x +
  scenario builder with type/origin/destination/priority/traffic level/mode
  + baseline-vs-ITMS runner with table + bar chart), `/analytics` (measured
  aggregates + per-run charts from recorded runs only), `/decisions` (AI
  trace merging persisted DB events with live WS events), `/settings`
  (component health + read-only settings, no secrets).
- Backend supporting additions: POST /api/simulation/speed + /reset,
  GET /api/network/geometry, GET /api/decisions, GET /api/analytics,
  GET /api/system, traffic-level scenarios (emergency_low/high route files
  + migration 006: scenario CHECK extension + persisted comparisons table).
- Live E2E verification: full operator flow driven through the exact REST
  endpoints the UI uses — start → traffic → emergency #5 → route 5 segs →
  corridor 3 ACTIVE (3 junctions commanded, 7 applied rows in DB) →
  comparison job (baseline 162s vs ITMS 82s, deltas persisted) → analytics
  shows avgTimeSavedS=80 (measured) → decision trace 43 real events →
  speed 5x verified live (25 sim s in 5 wall s) → reset verified.
- All 13 static pages generated; production build ✓; lint clean; web
  typecheck strict ✓; backend suite 126/126 ✓.

## Current Task

None (Phase 7 done — all phases complete).

## Files Changed

Phase 7 (this session):
- apps/web/ (new Next.js app): package.json (+ framer-motion, maplibre-gl, recharts),
  app/layout.tsx (Inter + JetBrains Mono fonts, ItmsProvider, AppShell),
  app/globals.css (Design.md tokens: #080B12/#0F141D/#202938 + semantic colors,
  panel/grid styles, emergency pulse, MapLibre popup theming),
  app/page.tsx (Command Center), app/{traffic,emergencies,signals,corridors,
  simulator,analytics,decisions,settings}/page.tsx,
  components/AppShell.tsx (nav/topbar/KPI bar + mobile drawer),
  components/CityMap.tsx (MapLibre GeoJSON live map, SUMO-meter display transform),
  components/panels.tsx, components/ui.tsx,
  lib/api.ts (typed REST client), lib/store.tsx (REST+WS live store + trace),
  lib/format.ts, .env.example, README.md, scripts.typecheck
- apps/api/src/modules/simulation/: simulation-manager.ts (+ setPace, paceMultiplier
  in snapshot), routes.ts (+ /speed, /reset)
- apps/api/src/modules/system/: routes.ts, overview.ts, geometry.ts (new endpoints)
- apps/api/src/modules/scenarios/scenario-comparison-service.ts (+ persistComparison)
- apps/api/src/database/repositories/metrics-repository.ts (+ insertComparison,
  listCompletedComparisons)
- apps/api/src/database/migrations/006_phase7.sql
- apps/api/src/config.ts (+ emergency_low/high scenario paths)
- packages/types/src/index.ts (+ DecisionEvent, SystemOverview, AnalyticsResponse,
  NetworkGeometryResponse, TrafficLevel, scenario ids, paceMultiplier)
- simulation/sumo/scenarios/emergency/emergency-{low,high}.rou.xml + .sumocfg (new)
- package.json (root scripts), README.md

Phase 6/5/4/3/2/1: see previous entries and git history.

## Tests Run

- `npm run typecheck` (apps/api + @itms/types + web) — pass
- `npm run build:web` (Next.js production build, 13 pages) — ✓ Compiled successfully
- `npm run lint` (web eslint) — 0 errors, 0 warnings
- `npm run build:network` (netconvert) — pass
- `npm run test:api` (`node --test --test-concurrency=1 "test/*.test.ts"`) — 126/126 pass
  (codec 16, metrics 11, network-loader 5, config 6, routing 12, corridor planner+
  safety 17, loop re-eval 4, TraCI client 7, manager 9, vehicle-reaction 1,
  pipeline 3, API+WS 4, emergency 2, prediction-client 12, prediction integration 4,
  corridor integration 4, closed-loop integration 7)
- `npm run test:prediction` — 12/12 pass
- Live E2E (real backend + real frontend build + PostGIS + SUMO):
  - all 9 pages served with correct SSR content; loading/empty states render
    before hydration (verified per page)
  - operator flow via the UI's exact REST calls: start → traffic flows →
    emergency (5 segments) → corridor ACTIVE (3 junctions) → corridor_signals
    applied rows in DB → /api/decisions 43 real events → /api/analytics
    (measured: avgTimeSavedS 80 after the comparison) → comparison job
    completed (baseline 162s vs ITMS 82s, deltas persisted) → /api/system
    healthy → speed 5x live-verified → reset live-verified
  - WebSocket channel (the UI's live feed) verified in earlier phases and
    via the store's event handling; REST polls act as fallback
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

- Phase 1: Node.js ↔ TraCI ↔ SUMO control loop verified by tests.
- Phase 2: "what is happening right now" answered with measured data,
  persisted with run identity, streamed over WebSocket, safe degradation.
- Phase 3: real emergency vehicles travel origin→destination via dynamic
  A* routes with per-junction ETAs and arrival detection.
- Phase 4: real XGBoost predictions at +30/+60/+90/+120 s from live state
  with measured metrics and verified fallback behavior.
- Phase 5: predictive rolling green corridor coordinates multiple signals
  ahead of the vehicle with explicit safety constraints and restoration.
- Phase 6: continuous loop with hysteresis-guarded re-routing; measured,
  reproducible baseline vs ITMS comparison (162s → 82s emergency travel).
- Phase 7: the command center exposes all of it from the operator's
  perspective — live map with the moving corridor and dominant emergency
  vehicle, real panels/tables/charts/trace, working controls and scenario
  builder; MEASURED analytics (avg time saved 80 s per comparison) and no
  fabricated values anywhere. All 7 phases complete; the final flow
  Normal City → Emergency → Prediction → Route → ETA → Green Corridor →
  Signal Coordination → Re-optimization → Arrival → Measured Comparison
  runs end to end through the UI's own API calls.

## Known Issues

- SUMO binaries are provided via `pip install eclipse-sumo` on this machine;
  `sumo`/`netconvert` resolve through PATH. SUMO_BINARY/SUMO_HOME supported as fallbacks.
- TraCI coordinates are SUMO network coordinates (netOffset 0,0, not
  geo-referenced; geometry stored with SRID 0 deliberately).
- SUMO accepts only one TraCI connection per process; the API manages a
  single simulation at a time (by design). Comparison jobs run the two runs
  SEQUENTIALLY (baseline then ITMS, each with a fresh SUMO) for this reason.
- Pedestrian phases are not modeled in the network (sidewalks omitted); the
  corridor's bounded-override guarantee (Decision 25) stands in for them.
- A native PostgreSQL 18 Windows service occupies host port 5432; the ITMS
  database therefore maps to host port 5433 in docker-compose.yml.
- Integration tests run with --test-concurrency=1 because DB-backed test
  files share the itms_test database (parallel files would interfere).
- WebSocket vehicle:update sends the full vehicle list per broadcast
  (bounded, ~10-20 KB at current fleet size); fine for current scale.
- ETA while the vehicle crosses an intersection (internal edge) falls back
  to full-route ETAs; corridor passage detection uses the route index.
- Emergency vehicle spawn can be deferred by SUMO when the departure edge is
  blocked; the event stays "created" until insertion succeeds.
- Model quality is measured on the synthetic 6-junction network: horizon
  quality degrades with distance (+120s R2 0.74).
- The prediction service must be running for ML predictions
  (PREDICTION_SERVICE_URL); otherwise honest `unavailable` + deterministic
  fallback. Corridors/loop work without it (safety uses measured traffic).
- Comparison runs are compute-bound (~30-60 s wall each at full speed);
  the comparison job API is async (202 + poll) for that reason.
- Docker Desktop must be running for PostgreSQL.
- Node type stripping requires erasable-only TypeScript syntax in this repo
  (no enums/namespaces); enforced via tsconfig `erasableSyntaxOnly`.

## Next Task

Product complete (all 7 phases). Optional hardening ideas:
1. Interactive browser E2E (Playwright) over the command center flows.
2. Real pedestrian phases in the SUMO network + extended corridor safety engine.
3. Upstream-pressure / per-lane prediction features to improve +120s horizon.
4. API authentication for multi-user deployment (PRD non-functional note).
5. Comparison persistence expansion (multi-scenario matrix, reports page).

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

### Decision 23 (Phase 5)
Corridor green states are conflict-free by construction: the corridor state
gives green ONLY to the route approach's links (from the net.xml
<connection tl= linkIndex=> mapping) and red to everything else, so no
conflicting movement is ever green (Rules.md 8: never all-green). The safety
engine re-validates this from the entry's corridorLinkIndices.

### Decision 24 (Phase 5)
Window model per junction: switch (approach red → corridor green at
[eta-lead, eta+trail] with a yellow clearance step when a conflicting green
is live), extend (approach green but the normal switch is too early → hold
corridor green past the switch, bounded by maxGreenExtension), noop (normal
green covers the ETA → no command), PENDING (ETA beyond feasibility bounds →
planned later; this is what makes the corridor roll with the vehicle).

### Decision 25 (Phase 5)
Restoration always returns to the normal fixed-time program via TraCI
setProgram (TL_PROGRAM 0x23) — on passage, at window end, on cancel, on
completion and on failure. The junction is never left off-program
indefinitely; the bounded-override guarantee stands in for pedestrian
phases (this network models none — documented).

### Decision 26 (Phase 5)
PostgreSQL BIGINT (int8) is parsed as a number at the pg boundary
(setTypeParser OID 20): pg otherwise returns strings, which broke number-keyed
id lookups between the HTTP layer (real numbers) and in-memory maps (string
keys from pg rows). All ITMS ids are far below 2^53.

### Decision 27 (Phase 5)
Corridor window/clearance parameters are configuration (CORRIDOR_* env vars,
validated at startup): lead 5s, trail 12s, min window 8s, max window 30s,
max green extension 20s, max red extension 45s, clearance 3s, plan horizon
60s, replan drift threshold 4s, downstream occupancy limit 0.85.

### Decision 17 (Phase 4)
The dataset generator (SUMO + TraCI, Python) lives in the prediction service
(services/prediction/data) — it is part of the ML pipeline; the Node backend
consumes predictions over HTTP and contains no ML code (Rules.md 3).

### Decision 18 (Phase 4)
One XGBoost regressor per horizon (4 small models) instead of a single
horizon-as-feature model: simpler per-horizon evaluation, no horizon
interaction subtleties, and single-horizon inference stays ~1 ms.

### Decision 19 (Phase 4)
Run-level train/val/test split (seeded 70/15/15): rows from one SUMO run are
autocorrelated, so whole runs are the leakage-safe unit. Incident (forced
all-red) scenarios in ~50% of runs cover signal-disturbance dynamics.

### Decision 20 (Phase 4)
Prediction target is the junction's total approach vehicle count; congestion
implications are derived deterministically from predicted counts (corridor
engine decides in Phase 5) — the ML model predicts traffic, not decisions.

### Decision 21 (Phase 4)
The deterministic fallback extrapolates the measured 10 s count trend with
distance-damped growth and is always labelled source=fallback; stale/failed
ML predictions are distinguished in the API so nothing fake can look real.

### Decision 22 (Phase 4)
The predicted value is clamped >= 0 and rounded; the service validates all
inputs (pydantic) and maps every failure to a typed reason on the Node side
(unavailable/timeout/no_model/invalid_input/invalid_response).

### Decision 28 (Phase 6)
The control loop triggers on SIMULATION time cadence (loopEvalIntervalS /
routeReevalIntervalS), not wall clock — deterministic in reproducible runs
and correct in the wall-paced live server. Loop work runs as an awaited step
listener: fully serialized with the corridor executor and the traffic
collector; no concurrent optimization loops; route switches go through the
same manager gateway as all other SUMO commands (TraCI request chain
serializes).

### Decision 29 (Phase 6)
Route switching safeguards (all configurable): hysteresis threshold
max(8s, 15% of current ETA); cooldown 30s per emergency; max 3 switches per
emergency; no switch within 15s of the destination; no switch while the
vehicle crosses an intersection (routeIndex < 0); candidate must differ from
the remaining route. Every switch is persisted (emergency_route_switches)
and broadcast (route:switched) for explainability.

### Decision 30 (Phase 6)
Multi-emergency junction conflict policy (explicit): a junction ACTIVELY
commanded (applied window) by another corridor is never replaced; a pending
claim by a HIGHER-priority emergency wins (lower yields); a pending claim by
lower/equal priority may be taken over, protected by an apply-time occupancy
re-check. Equal priority resolves first-come (deterministic by corridor
activation order). Priority values: critical > high > normal.

### Decision 31 (Phase 6)
Comparison methodology: baseline and ITMS runs use the SAME scenario config
(deterministic SUMO seed, no --random), the SAME manual warm-up to
comparisonWarmupSeconds, and an emergency created with identical parameters
at the same sim time. Baseline = normal routing + normal signal timing (no
corridor, rerouting disabled); ITMS = prediction + dynamic re-routing +
green corridor. Metrics are sampled from the live simulation and persisted
per run with mode baseline|itms; the comparison reports deltas. Verified
reproducible: two comparison jobs produced identical measured values.

### Decision 32 (Phase 6)
Emergency travel time is measured in SIMULATION seconds from vehicle
activation to arrival (activated_sim_time_s / arrived_sim_time_s persisted
on emergency_vehicles); delay is SUMO's per-vehicle timeLoss (VAR_TIMELOSS
0x8c) sampled per interval; throughput is SUMO's cumulative arrived count
per sim hour. No metric is derived outside the simulation.

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

## Final Integration Status

**AUDIT DATE: 2026-09-23. RESULT: ALL 7 PHASES IMPLEMENTED AND VERIFIED — INTEGRATION APPROVED.**

### Phase classification

| Phase | Classification | Evidence |
| --- | --- | --- |
| 1 — Digital Traffic World | **IMPLEMENTED + VERIFIED** | 16 codec + 7 TraCI + 9 manager tests vs real SUMO; vehicle-reaction acceptance test; live 20-step E2E steps 1, 5 |
| 2 — Traffic Intelligence | **IMPLEMENTED + VERIFIED** | 11 metrics + 5 loader + 6 config tests; 3 pipeline tests (real SUMO + PostgreSQL, exact persistence match, run identity, disconnect→failed+alert); E2E steps 5, 14 |
| 3 — Emergency + Routing | **IMPLEMENTED + VERIFIED** | 12 routing unit tests (30 grid pairs), 2 emergency integration tests (route validity, SUMO route read-back, arrival); E2E steps 6, 7, 9, 13, 16 |
| 4 — AI Prediction | **IMPLEMENTED + VERIFIED** | 12 prediction-client tests + 4 integration (real uvicorn); MEASURED metrics (MAE 3.58–6.94, R² 0.911→0.739 by horizon; 1.01 ms/horizon); E2E step 8 (src=ml) |
| 5 — Green Corridor | **IMPLEMENTED + VERIFIED** | 17 planner/safety tests (all-green rejection, extension bounds, spillback, conflict policy) + 4 integration; E2E steps 10–12 |
| 6 — Closed Loop | **IMPLEMENTED + VERIFIED** | 4 loop re-eval tests + 7 closed-loop tests (hysteresis, multi-emergency, comparison determinism); E2E steps 14–19 |
| 7 — Command Center | **IMPLEMENTED + VERIFIED** (with the noted browser-E2E caveat below) | Production build ✓ (13 pages), lint clean, strict tsc ✓, SSR content per page, live-data flows via the UI's exact REST+WS calls; E2E steps 5, 20 |

### Verified Features
- Node.js→TraCI→SUMO: start/pause/resume/reset/stop, speed 1–10× (live-verified), signal RYG control + program restore, vehicle injection/rerouting/removal, arrived-vehicle detection
- Traffic pipeline: per-step measured metrics (edge-domain reads + subscription turnover flow), congestion classification (configurable thresholds), throttled persistence with run identity, staleness/system flags in the API
- A* routing: deterministic, congestion-adjusted; all 30 junction pairs routable; live-verified reroute around congestion (route via I5 chosen over I3 during the E2E)
- Prediction service: real XGBoost (4 horizon models), pydantic validation, typed Node client, Rule-9 fallback (recent valid → deterministic), persisted with source/model_version
- Green corridor: corridor identification from the route, ETA-driven windows (switch/extend/noop/rolling-pending), 8 explicit safety checks (conflict-free by construction; all-green rejected), yellow clearance, apply-time occupancy re-check, restoration on passage/window-end/cancel/completion/failure
- Closed loop: serialized per-step control loop on sim-time cadence, hysteresis-guarded dynamic re-routing, corridor re-plan on route change (no full reset), multi-emergency priority policy
- Metrics/comparison: automatic sampling (city + per-vehicle SUMO timeLoss), per-run finalization to simulation_metrics, sequential baseline vs ITMS runs with identical initial conditions, delta computation, persisted comparison results
- API surface: 24 typed endpoints with consistent error envelopes; WebSocket events (traffic/vehicle/signal/prediction/corridor/route:switched/emergency/comparison/system:alert) — live-verified
- Database: 6 migrations, run-scoped records, indexes, PostGIS geometry (SRID 0 deliberate), BIGINT→number boundary parser

### Unverified Features
- **Browser-level interactive E2E (click-through of the real UI in a browser) was NOT executed** — no browser automation is available in this environment. Verified instead: SSR of all 9 pages, and every REST+WS channel the UI consumes. This remains the one audit gap; recommend a Playwright pass as the next hardening step.

### Known Bugs (found and FIXED during the audit)
1. **Comparison runner failed when a simulation was already running** ("Simulation is running; stop it first") — e.g. after an operator reset. FIXED: runSingle() now stops any active simulation before starting a run (sequential by design). Verified live with a retry job from a running state.

### Tests Run (this audit)
- `npm run typecheck` (api + types + web) — pass
- `npm run test:api` — 126/126 pass
- `npm run test:prediction` — 12/12 pass
- `npm run build:web` — ✓ Compiled successfully (13 pages)
- Full 20-step live E2E through the real stack (see below)

### Actual Results (20-step E2E, production build, real stack)
1–4 SUMO+backend+prediction+frontend up (uvicorn ready, DB healthy, PostGIS 3.4) · 5 traffic started (6 signals, 14 vehicles) · 6–7 emergency + A* route: 5 segments, 717 m, est 78 s vs free-flow 52 s (congestion-adjusted; path chosen via i2_i5 responding to live traffic) · 8 predictions src=ml, stale=false, 4 horizons · 9 ETAs per controlled junction: I1 +11.1s, I2 +26.7s, I5 +41.3s, I6 +54.2s, E2 +61.1s · 10–11 corridor 1 ACTIVE, 3 junctions, validation passed, 0 skips · 12 signal schedule persisted and applied (corridor green at I2/I5/I6 windows) · 13 vehicle moved (15.2 m/s on i2_i5) · 14 traffic change: I5 forced all-red · 15 re-optimization: all 3 corridor windows replanned (ETA drift), vehicle passed all junctions during corridor green, programs restored · 16 emergency arrived (travel 131 sim s) · 17–18 comparison: baseline run=3 travel 162 s / delay 21.94 s / queue 25.59 / speed 6.09 m/s / throughput 18.65/h / 0 signal changes vs ITMS run=4 travel 82 s / delay 15.66 s / queue 21.78 / speed 6.36 / throughput 31.86/h / 6 signal changes · 19 metrics auto-generated into simulation_metrics · 20 results served to the UI (analytics avgTimeSavedS = 80, decision trace, WS events live-verified).

### Remaining Work (optional hardening)
1. Playwright browser E2E (the one audit gap).
2. Real pedestrian phases in the SUMO network + extended corridor safety engine.
3. Upstream-pressure / per-lane prediction features (improve +120s horizon).
4. API authentication for multi-user deployment (PRD §7).
5. Comparison reports page / multi-scenario matrix.
