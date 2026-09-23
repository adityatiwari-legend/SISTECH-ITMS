# ITMS — System Architecture

## 1. Architecture Principle

Build the system from the simulation/control layer upward:

SUMO → Traffic Data → Backend → Emergency → Routing → Prediction → Corridor → Signal Control → Closed Loop → UI → Analytics.

Do not build the polished dashboard before the core traffic-control loop works.

## 2. High-Level Architecture

```text
                         ┌─────────────────────┐
                         │     COMMAND CENTER  │
                         │       Next.js       │
                         └──────────┬──────────┘
                                    │
                          REST + WebSocket
                                    │
                                    ▼
                    ┌───────────────────────────┐
                    │      NODE.JS BACKEND      │
                    │                           │
                    │ Traffic                   │
                    │ Emergency                 │
                    │ Routing                   │
                    │ Prediction                │
                    │ Corridor                  │
                    │ Signals                   │
                    │ Simulation                │
                    │ Analytics                 │
                    └────────────┬──────────────┘
                                 │
             ┌───────────────────┼───────────────────┐
             ▼                   ▼                   ▼
      PostgreSQL            ML Service          SUMO + TraCI
       + PostGIS             XGBoost             Simulation
```

## 3. Technology Stack

### Frontend
- Next.js
- React
- TypeScript
- Tailwind CSS
- Framer Motion
- SUMO network SVG renderer (no external map provider; SUMO is the map)
- Recharts
- WebSocket

### Backend
- Node.js
- TypeScript
- Fastify or Express
- REST APIs
- WebSocket

### Database
- PostgreSQL
- PostGIS

### Simulation
- SUMO
- TraCI
- OpenStreetMap

### ML
- Python
- Pandas
- NumPy
- scikit-learn
- XGBoost

## 4. Backend Modules

```text
backend/
└── src/
    ├── modules/
    │   ├── traffic/
    │   ├── emergency/
    │   ├── routing/
    │   ├── prediction/
    │   ├── corridor/
    │   ├── signals/
    │   ├── simulation/
    │   └── analytics/
    ├── websocket/
    ├── database/
    └── main.ts
```

## 5. Simulation Structure

```text
simulation/
└── sumo/
    ├── network/
    ├── routes/
    ├── scenarios/
    │   ├── baseline/
    │   └── emergency/
    └── scripts/
```

## 6. ML Service

```text
services/
└── prediction/
    ├── data/
    ├── training/
    ├── models/
    ├── inference/
    ├── evaluation/
    └── main.py
```

The ML service exposes a prediction API to the Node backend.

## 7. Core Data Flow

```text
SUMO
 ↓
TraCI
 ↓
Traffic Collector
 ↓
Traffic State
 ↓
Prediction Service
 ↓
Route Engine
 ↓
Emergency ETA
 ↓
Green Corridor Engine
 ↓
Safety Constraint Engine
 ↓
Signal Optimizer
 ↓
TraCI
 ↓
SUMO
```

## 8. AI Responsibility

### ML
Traffic prediction.

### Algorithms
- A* route optimization
- ETA calculation
- Green corridor planning
- Signal scheduling
- Safety constraints

Do not use ML where deterministic algorithms are more appropriate.

## 9. Traffic Prediction

Input features:
- Timestamp
- Intersection ID
- Vehicle count
- Average speed
- Queue length
- Density
- Flow rate
- Signal state
- Signal phase
- Hour
- Day of week

Output:
- Future traffic at +30s
- +60s
- +90s
- +120s

Initial model: XGBoost.

## 10. Route Engine

Represent:

```text
Nodes = intersections
Edges = road segments
```

Dynamic edge cost:

```text
cost = travel_time × congestion_factor × predicted_congestion_factor
```

Use A* initially.

## 11. Emergency ETA

Initially:

```text
ETA = distance / predicted_speed
```

Calculate ETA for each upcoming intersection.

## 12. Green Corridor Engine

Input:
- Emergency route
- Emergency ETA
- Current signal state
- Predicted traffic
- Queue length
- Cross traffic
- Road capacity
- Downstream capacity

Output:
- Signal phase/timing schedule

## 13. Safety Constraints

The optimizer must enforce:
- Maximum green extension
- Maximum red extension
- Pedestrian safety
- Queue spillback prevention
- Downstream capacity
- Emergency priority
- Conflict prevention

If optimization fails, fall back to a safe signal strategy.

## 14. Database Tables

```text
users
roads
road_segments
intersections
traffic_signals
signal_phases
vehicles
emergency_vehicles
traffic_snapshots
traffic_predictions
emergency_events
routes
route_segments
green_corridors
corridor_signals
simulation_runs
simulation_metrics
```

## 15. API Surface

```text
GET  /api/traffic
GET  /api/traffic/roads
GET  /api/traffic/intersections

GET  /api/signals
GET  /api/signals/:id

GET  /api/vehicles
GET  /api/emergency
POST /api/emergency
GET  /api/emergency/:id

POST /api/routes/calculate

POST /api/corridors
GET  /api/corridors
GET  /api/corridors/:id
POST /api/corridors/:id/activate
POST /api/corridors/:id/cancel

POST /api/simulation/start
POST /api/simulation/pause
POST /api/simulation/reset
GET  /api/simulation/:id

GET  /api/predictions
GET  /api/analytics
```

## 16. WebSocket Events

```text
traffic:update
vehicle:update
emergency:created
emergency:update
route:updated
prediction:update
corridor:created
corridor:update
signal:update
simulation:update
analytics:update
system:alert
```

## 17. Repository

```text
itms/
├── apps/
│   ├── web/
│   └── api/
├── services/
│   └── prediction/
├── simulation/
│   └── sumo/
├── packages/
│   ├── types/
│   └── algorithms/
├── data/
├── docs/
├── docker/
├── PROJECT.md
├── PRD.md
├── Architecture.md
├── Rules.md
├── Phases.md
├── Design.md
└── Memory.md
```

## 18. First Technical Milestone

Create a 6-intersection SUMO network with:
- Signals
- Vehicles
- Routes
- One emergency vehicle
- One hospital

Then prove:

Node.js → TraCI → SUMO → signal change → vehicles respond.

Only after this works should the next layer be implemented.
