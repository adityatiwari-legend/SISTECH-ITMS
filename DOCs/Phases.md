# ITMS — 7-Phase Implementation Plan

## Intelligent Traffic Management System

**PS:** IS-8 — Software AI & Intelligent Systems / Smart Mobility  
**Core USP:** Predictive Rolling Green Corridor  
**Primary Simulation:** SUMO + TraCI  
**Backend:** Node.js + TypeScript  
**Frontend:** Next.js + TypeScript  
**Database:** PostgreSQL + PostGIS  
**ML:** Python + XGBoost

---

# 0. Development Philosophy

ITMS must be built from the core traffic system outward.

Do **not** start with the dashboard.

The dependency chain is:

```text
PHASE 1
Digital Traffic World
        ↓
PHASE 2
Traffic Intelligence
        ↓
PHASE 3
Emergency + Routing
        ↓
PHASE 4
AI Traffic Prediction
        ↓
PHASE 5
Predictive Green Corridor
        ↓
PHASE 6
Closed-Loop Optimization
        ↓
PHASE 7
Command Center + Final Product
```

Every phase must produce a working, testable output.

A feature is not considered complete because its UI exists. It is complete only when:

```text
UI / API
   ↓
Business Logic
   ↓
Simulation / Database
   ↓
Real Result
   ↓
Tested
```

---

# PHASE 1 — DIGITAL TRAFFIC WORLD

## Objective

Create the virtual city in which the entire ITMS system will operate.

SUMO is the traffic simulation environment and acts as the project's digital traffic twin.

---

## 1.1 Environment Setup

Install and configure:

```text
Node.js
TypeScript
Python
PostgreSQL
PostGIS
SUMO
TraCI
Git
Docker
```

Create the initial repository:

```text
itms/
├── apps/
├── services/
├── simulation/
├── packages/
├── data/
├── docs/
└── README.md
```

---

## 1.2 Create Initial Traffic Network

Start with a controlled network rather than importing an entire city.

Target:

```text
6–10 intersections
```

Example:

```text
        I1 ───── I2 ───── I3
        │        │        │
        │        │        │
        I4 ───── I5 ───── I6
        │        │        │
        │        │        │
        I7 ───── I8 ───── I9
```

Each intersection must have:

- Roads
- Lanes
- Traffic lights
- Signal phases
- Allowed movements

---

## 1.3 Add Traffic

Create:

- Cars
- Buses/trucks if useful
- Different routes
- Different traffic volumes
- Normal traffic patterns

The first target is not realism.

The target is a stable and controllable simulation.

---

## 1.4 Add Emergency Infrastructure

Add:

```text
Hospital
Emergency starting point
Optional fire station
Optional police station
```

---

## 1.5 TraCI Integration

Create the first Node.js simulation controller.

The backend must be able to:

```text
GET vehicle position
GET vehicle speed
GET traffic-light state
GET queue information
SET traffic-light state
```

Basic architecture:

```text
Node.js
   ↓
TraCI
   ↓
SUMO
   ↓
Traffic Simulation
```

---

## 1.6 Phase 1 Tests

### Test 1

SUMO loads successfully.

### Test 2

Vehicles move.

### Test 3

Traffic signals operate.

### Test 4

Node.js connects through TraCI.

### Test 5

Node.js reads a vehicle position.

### Test 6

Node.js changes one traffic signal.

### Test 7

Vehicles react to the changed signal.

---

## Phase 1 Output

A working virtual traffic world:

```text
SUMO City
+
Traffic
+
Signals
+
Routes
+
Emergency Location
+
Hospital
+
Node.js/TraCI Control
```

---

## Phase 1 Definition of Done

Phase 1 is complete only when:

> Node.js can connect to SUMO, read traffic information, change a signal, and observe vehicles responding to that change.

---

# PHASE 2 — TRAFFIC INTELLIGENCE LAYER

## Objective

Make the application understand what is happening inside the simulated city.

Currently SUMO knows the traffic state. ITMS must collect, process, store, and expose that information.

---

# 2.1 Traffic Data Collector

Build:

```text
SUMO
 ↓
TraCI
 ↓
Traffic Collector
```

Collect at a fixed simulation interval.

For every relevant road/intersection:

```text
vehicle_count
average_speed
queue_length
traffic_density
flow_rate
signal_state
signal_phase
timestamp
```

---

# 2.2 Traffic Processing

Calculate:

### Vehicle Count

Number of vehicles currently present.

### Average Speed

Average speed of vehicles on a road/segment.

### Queue Length

Number of vehicles waiting at an intersection.

### Traffic Density

Vehicles relative to road capacity.

### Flow Rate

Vehicles passing a segment per unit time.

---

# 2.3 Congestion Engine

Classify traffic:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Example:

```text
I1 → LOW
I2 → MEDIUM
I3 → HIGH
I4 → CRITICAL
```

The thresholds must be configurable rather than hard-coded throughout the application.

---

# 2.4 PostgreSQL + PostGIS

Store traffic state.

Core tables:

```text
roads
road_segments
intersections
traffic_signals
signal_phases
vehicles
traffic_snapshots
```

Use PostGIS for geographic objects and spatial queries.

---

# 2.5 Traffic APIs

Implement:

```text
GET /api/traffic
GET /api/traffic/roads
GET /api/traffic/intersections
GET /api/signals
GET /api/signals/:id
```

---

# 2.6 Real-Time Events

Create WebSocket events:

```text
traffic:update
vehicle:update
signal:update
```

The frontend will eventually consume these events.

---

# 2.7 Phase 2 Tests

Verify:

```text
[ ] Traffic is read from SUMO
[ ] Vehicle count is correct
[ ] Speed is calculated
[ ] Queue is calculated
[ ] Density is calculated
[ ] Congestion is classified
[ ] Data is stored
[ ] APIs return current state
[ ] WebSocket updates work
```

---

## Phase 2 Output

The system can now answer:

> "What is happening in the city right now?"

Example:

```text
I1 → LOW
I2 → HIGH
I3 → CRITICAL
I4 → MEDIUM
```

---

# PHASE 3 — EMERGENCY VEHICLE + INTELLIGENT ROUTING

## Objective

Introduce the emergency response layer.

Supported emergency vehicles:

```text
Ambulance
Fire Engine
Police Vehicle
```

---

# 3.1 Emergency Vehicle Model

Create:

```text
emergency_vehicles
```

Fields should include:

```text
id
vehicle_id
type
current_position
destination
speed
priority
status
created_at
```

---

# 3.2 Emergency Event

Create:

```text
emergency_events
```

An emergency event contains:

```text
event_id
vehicle_id
origin
destination
priority
status
created_at
```

---

# 3.3 Emergency API

Implement:

```text
POST /api/emergency
GET /api/emergency
GET /api/emergency/:id
```

---

# 3.4 Emergency Creation Flow

```text
Operator
   ↓
Create Emergency
   ↓
Select Vehicle
   ↓
Select Origin
   ↓
Select Destination
   ↓
Set Priority
   ↓
Create Event
```

---

# 3.5 Road Graph

Convert the road network into a graph.

```text
Nodes = Intersections
Edges = Road Segments
```

Each edge contains dynamic information:

```text
distance
speed
travel_time
traffic
capacity
```

---

# 3.6 Route Engine

Implement A*.

Initial route cost:

```text
distance
+
travel_time
+
current_congestion
```

Later integrate predicted congestion.

---

# 3.7 Candidate Route Comparison

Example:

```text
Route A
7.2 km
18 min

Route B
8.1 km
12 min

Route C
6.8 km
21 min
```

The route engine should select based on expected travel time, not distance alone.

---

# 3.8 Emergency ETA

Calculate ETA for:

- Destination
- Every upcoming intersection

Example:

```text
I1 → 18 sec
I2 → 37 sec
I3 → 59 sec
I4 → 82 sec
I5 → 104 sec
```

---

# 3.9 SUMO Emergency Vehicle

The backend must be able to:

```text
Create emergency vehicle
Assign route
Read position
Read speed
Update route
Detect arrival
```

---

# 3.10 Phase 3 Tests

```text
[ ] Emergency can be created
[ ] Emergency vehicle appears in SUMO
[ ] Origin is correct
[ ] Destination is correct
[ ] A* returns a valid route
[ ] Route is visualized
[ ] Emergency vehicle follows route
[ ] ETA is calculated
[ ] Arrival is detected
```

---

## Phase 3 Output

A functioning emergency route system:

```text
🚑
 ↓
A*
 ↓
Optimized Route
 ↓
🏥
```

---

# PHASE 4 — AI TRAFFIC PREDICTION

## Objective

Move from reactive traffic management to predictive traffic management.

The key question becomes:

> What will traffic look like when the emergency vehicle reaches the next intersection?

---

# 4.1 Generate Training Data

Use SUMO to produce traffic data.

Required features:

```text
timestamp
intersection_id
vehicle_count
average_speed
queue_length
traffic_density
flow_rate
signal_state
signal_phase
hour
day_of_week
```

Generate multiple scenarios with:

```text
Low traffic
Medium traffic
High traffic
Changing traffic
Different signal states
Different times
```

---

# 4.2 Dataset

Store:

```text
data/
└── traffic/
    ├── raw/
    ├── processed/
    └── training/
```

Do not train and test on the same simulation data.

Use separate training/validation/test datasets.

---

# 4.3 Feature Engineering

Create useful features:

```text
hour
minute
day_of_week
current_vehicle_count
current_speed
queue_length
density
flow_rate
signal_state
recent traffic history
```

---

# 4.4 Model

Initial model:

```text
XGBoost
```

Do not start with:

```text
LSTM
Transformer
GNN
Reinforcement Learning
```

unless the baseline model proves insufficient.

---

# 4.5 Prediction Target

Predict:

```text
traffic at +30 sec
traffic at +60 sec
traffic at +90 sec
traffic at +120 sec
```

Possible output:

```text
I3

NOW      → 52
+30 sec  → 61
+60 sec  → 73
+90 sec  → 81
+120 sec → 94
```

---

# 4.6 Model Evaluation

Measure:

```text
MAE
RMSE
R²
```

Also record:

```text
Inference latency
Prediction stability
```

Do not claim accuracy numbers until they are actually measured on held-out data.

---

# 4.7 Prediction API

Create a small Python service:

```text
POST /predict
```

Input:

```json
{
  "intersection_id": "I3",
  "vehicle_count": 61,
  "speed": 21,
  "queue_length": 17,
  "density": 0.72,
  "hour": 18
}
```

Output:

```json
{
  "30s": 68,
  "60s": 74,
  "90s": 83,
  "120s": 91
}
```

---

# 4.8 Integrate With Node.js

```text
SUMO
 ↓
Node.js
 ↓
Prediction Service
 ↓
Future Traffic
 ↓
Node.js
```

---

# 4.9 Phase 4 Tests

```text
[ ] Dataset generated
[ ] Train/test split exists
[ ] XGBoost trains
[ ] Metrics calculated
[ ] Model saved
[ ] Prediction API works
[ ] Node.js can call prediction service
[ ] Predictions use live simulation data
```

---

## Phase 4 Output

The system can now say:

> "The ambulance will reach this intersection in approximately 60 seconds, and traffic is predicted to become highly congested at that time."

---

# PHASE 5 — PREDICTIVE GREEN CORRIDOR

## Objective

Build the main USP:

> Predictive Rolling Green Corridor.

This phase combines:

```text
Emergency
+
Route
+
ETA
+
Current Traffic
+
Predicted Traffic
+
Signal State
```

---

# 5.1 Identify Corridor Intersections

From the emergency route:

```text
Route
 ↓
I1 → I2 → I3 → I4 → I5
```

Extract all controlled intersections.

---

# 5.2 Calculate Emergency Arrival Time

Example:

```text
I1 → 18 sec
I2 → 39 sec
I3 → 61 sec
I4 → 85 sec
I5 → 109 sec
```

---

# 5.3 Calculate Signal Windows

For every intersection, determine:

```text
Current phase
Current remaining time
Required green window
Emergency ETA
Cross traffic
Queue
Predicted traffic
```

---

# 5.4 Corridor Planner

Generate:

```text
I1 → GREEN 15–27 sec
I2 → GREEN 35–48 sec
I3 → GREEN 56–70 sec
I4 → GREEN 80–94 sec
I5 → GREEN 104–118 sec
```

These are example values; the real planner must calculate them.

---

# 5.5 Safety Constraints

Before applying the plan:

```text
Check emergency priority
Check conflicting traffic
Check pedestrian phase
Check maximum green extension
Check maximum red extension
Check queue spillback
Check downstream capacity
```

If invalid:

```text
Corridor Plan
    ↓
Safety Validation
    ↓
INVALID
    ↓
Recalculate
```

---

# 5.6 Signal Optimizer

Convert the corridor plan into SUMO signal commands.

```text
Green Corridor
 ↓
Signal Schedule
 ↓
Safety Validation
 ↓
TraCI
 ↓
SUMO
```

---

# 5.7 Rolling Corridor

The corridor must move with the emergency vehicle.

### State 1

```text
🚑

I1 🟢
I2 🟢
I3 🔴
I4 🔴
```

### State 2

```text
    🚑

I1 🔴
I2 🟢
I3 🟢
I4 🔴
```

### State 3

```text
        🚑

I1 🔴
I2 🔴
I3 🟢
I4 🟢
```

---

# 5.8 Phase 5 Tests

```text
[ ] Route intersections identified
[ ] ETA available
[ ] Signal windows calculated
[ ] Corridor generated
[ ] Safety validation works
[ ] Multiple signals coordinated
[ ] SUMO receives signal plan
[ ] Ambulance encounters coordinated greens
[ ] Corridor moves with vehicle
```

---

## Phase 5 Output

A working predictive green corridor:

```text
🚑 → 🟢 → 🟢 → 🟢 → 🟢 → 🏥
```

This is the project's central capability.

---

# PHASE 6 — CLOSED-LOOP OPTIMIZATION

## Objective

Turn the green corridor into a continuously adaptive system.

The system must not calculate a corridor once and forget it.

It must continuously observe the simulation and re-optimize.

---

# 6.1 Continuous Control Loop

```text
SUMO
 ↓
Traffic State
 ↓
Emergency Position
 ↓
Traffic Prediction
 ↓
Route/ETA
 ↓
Corridor
 ↓
Safety Validation
 ↓
Signal Control
 ↓
SUMO
 ↓
Repeat
```

---

# 6.2 Recalculation Interval

Start with a configurable interval such as:

```text
2–5 seconds
```

Do not hard-code this everywhere.

---

# 6.3 Dynamic Re-routing

If traffic changes significantly:

```text
Current Route
      ↓
Traffic changed
      ↓
Recalculate route
      ↓
Compare ETA
      ↓
Switch route if beneficial
```

The system must avoid unnecessary route oscillation.

Add a threshold or hysteresis so tiny changes do not cause constant route switching.

---

# 6.4 Corridor Re-optimization

Example:

Initial:

```text
I1 → 15 sec
I2 → 35 sec
I3 → 55 sec
I4 → 78 sec
```

Emergency slows down.

New:

```text
I1 → passed
I2 → 47 sec
I3 → 67 sec
I4 → 91 sec
```

The system recalculates the remaining corridor.

---

# 6.5 Multiple Emergency Vehicles

After the single-emergency case works, test:

```text
🚑 AMB-001
+
🚒 FIRE-001
```

The system must detect conflicts.

Possible policy:

```text
Critical emergency
    >
High emergency
    >
Normal traffic
```

Priority rules must be explicit and configurable.

---

# 6.6 Baseline Scenario

Create a scenario with:

```text
Normal routing
+
Normal signal timing
```

No ITMS intervention.

Record:

```text
Emergency travel time
Average delay
Queue length
Average speed
Throughput
```

---

# 6.7 ITMS Scenario

Same starting conditions:

```text
Traffic prediction
+
Dynamic routing
+
Green corridor
+
Signal optimization
```

Record the same metrics.

---

# 6.8 Comparison

Display:

```text
BASELINE
vs
ITMS
```

Metrics:

```text
Emergency travel time
Average traffic delay
Queue length
Average speed
Throughput
Signal changes
```

All values must come from actual simulation results.

---

# 6.9 Phase 6 Tests

```text
[ ] Traffic changes are detected
[ ] ETA is recalculated
[ ] Corridor can be updated
[ ] Route can be updated
[ ] Signal commands are updated
[ ] Emergency does not get stuck
[ ] Multiple emergencies are handled safely
[ ] Baseline simulation works
[ ] ITMS simulation works
[ ] Metrics are generated automatically
```

---

## Phase 6 Output

A closed-loop intelligent system:

```text
Traffic
 ↓
Predict
 ↓
Plan
 ↓
Control
 ↓
Observe
 ↓
Re-plan
 ↓
Control
 ↓
Repeat
```

---

# PHASE 7 — COMMAND CENTER + FINAL PRODUCT

## Objective

Expose the entire system through a polished operator command center and prepare the final demonstration.

The UI is built now because the underlying system is already functional.

---

# 7.1 Application Shell

Create:

```text
Command Center
Traffic
Emergencies
Signals
Corridors
Simulator
Analytics
AI Decision Trace
Settings
```

---

# 7.2 Command Center

The main screen should prioritize the live map.

Target layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ ITMS                    ● ONLINE                 LIVE 14:32  │
├──────────┬───────────────────────────────────────────┬───────┤
│ SIDEBAR  │                                           │ACTIVE │
│          │                                           │EVENT  │
│ Overview │                                           │       │
│ Traffic  │               LIVE MAP                    │🚑     │
│ Emergency│                                           │AMB104 │
│ Signals  │       🟢──🟢──🚑──🟢                     │       │
│ Corridor │                                           │ETA    │
│ Simulator│                                           │08:42  │
│ Analytics│                                           │       │
├──────────┴───────────────────────────────────────────┴───────┤
│ Vehicles │ Avg Speed │ Congestion │ Corridors │ Emergency │
└──────────────────────────────────────────────────────────────┘
```

---

# 7.3 Live Map

Display:

```text
Roads
Traffic density
Normal vehicles
Emergency vehicles
Signals
Hospitals
Green corridors
Congestion
```

Emergency vehicle must be visually dominant.

---

# 7.4 Emergency Panel

Show:

```text
AMB-104
AMBULANCE
CRITICAL

Destination
City Hospital

ETA
08:42

Distance
4.8 km

Corridor
ACTIVE

Intersections
7
```

Actions:

```text
VIEW ROUTE
OPTIMIZATION DETAILS
```

---

# 7.5 AI Decision Panel

Show why the system is making decisions.

Example:

```text
AI DECISION

Traffic Forecast
82%

Route
OPTIMIZED

Signals
7 coordinated

Last Recalculation
3 sec ago
```

---

# 7.6 AI Decision Trace

Timeline:

```text
14:32:01
Emergency AMB-104 detected.

14:32:02
Route calculated.

14:32:03
Traffic prediction generated.

14:32:04
I-103 predicted HIGH congestion.

14:32:05
Corridor optimization triggered.

14:32:06
7 signals scheduled.

14:32:10
Corridor recalculated.
```

This is important for explainability during judging.

---

# 7.7 Traffic Page

Show:

```text
Total Vehicles
Average Speed
Congested Roads
Average Queue
Traffic Flow
```

And:

```text
Traffic Map
Congested Road List
Traffic Trend
```

---

# 7.8 Emergency Page

Show active emergency events:

```text
AMB-104
Ambulance
CRITICAL
ETA 08:42
CORRIDOR ACTIVE
```

Click to inspect.

---

# 7.9 Corridor Page

Show:

```text
Corridor ID
Emergency Vehicle
Distance
Signals
Start Time
ETA
Status
Optimization State
```

Map:

```text
🚑 → 🟢 → 🟢 → 🟢 → 🟢 → 🏥
```

---

# 7.10 Signals Page

Display:

```text
Signal ID
Location
State
Queue
Mode
Emergency
```

Example:

```text
I-101
Main Road
GREEN
14 vehicles
NORMAL

I-102
Station Road
GREEN
7 vehicles
CORRIDOR
```

---

# 7.11 Simulator Page

Controls:

```text
START
PAUSE
RESET
```

Speed:

```text
1x
2x
5x
10x
```

Display the live SUMO simulation.

---

# 7.12 Scenario Builder

Allow:

```text
Emergency Type
Origin
Destination
Traffic Level
Scenario Mode
```

Then:

```text
RUN SCENARIO
```

---

# 7.13 Baseline vs ITMS

Show two simulations/results:

```text
┌──────────────────────┬──────────────────────┐
│ BASELINE             │ ITMS                 │
├──────────────────────┼──────────────────────┤
│ Travel Time          │ Travel Time          │
│ Avg Delay            │ Avg Delay            │
│ Queue Length         │ Queue Length         │
│ Avg Speed            │ Avg Speed            │
│ Signal Changes       │ Signal Changes       │
└──────────────────────┴──────────────────────┘
```

Never hard-code these values.

---

# 7.14 Analytics

Show:

```text
Emergency Trips
Average Response Time
Average Time Saved
Corridors Created
Average Traffic Delay
Average Speed
Throughput
```

Charts:

```text
Response Time
Traffic Delay
Queue Length
Average Speed
Throughput
```

---

# 7.15 UI Design

Use:

```text
Background: #080B12
Panel:      #0F141D
Border:     #202938
Text:       #F4F7FA
Muted:      #8B95A7
Success:    #22C55E
Warning:    #F59E0B
Critical:   #EF4444
Emergency:  #FF3B30
AI:         #8B5CF6
Info:       #38BDF8
```

Primary font:

```text
Inter
```

Technical font:

```text
JetBrains Mono
```

---

# 7.16 UX Priority

The interface must prioritize:

```text
1. Active Emergency
2. Green Corridor
3. Traffic Conditions
4. Signal States
5. AI Decisions
6. Analytics
```

The operator should understand the city's emergency state within seconds.

---

# 7.17 Final Integration

Connect:

```text
Frontend
 ↓
REST/WebSocket
 ↓
Node.js Backend
 ↓
Traffic / Emergency / Route / Prediction / Corridor
 ↓
PostgreSQL + PostGIS
 ↓
SUMO + TraCI
```

Verify that there are no fake UI-only states.

---

# 7.18 Final End-to-End Test

Perform the complete flow:

```text
START
 ↓
City simulation
 ↓
Normal traffic
 ↓
Create ambulance emergency
 ↓
Detect emergency
 ↓
Calculate route
 ↓
Predict traffic
 ↓
Calculate ETA
 ↓
Create corridor
 ↓
Validate corridor
 ↓
Change signals
 ↓
Ambulance moves
 ↓
Traffic changes
 ↓
Recalculate
 ↓
Corridor updates
 ↓
Ambulance reaches hospital
 ↓
Generate metrics
 ↓
Run baseline
 ↓
Compare baseline vs ITMS
```

---

# 7.19 Final Demo Sequence

The judge should see this:

### Step 1
Start the virtual city.

### Step 2
Show normal traffic.

### Step 3
Create an ambulance emergency.

### Step 4
Select hospital.

### Step 5
Show candidate routes.

### Step 6
Show predicted traffic.

### Step 7
Show selected route and ETA.

### Step 8
Generate green corridor.

### Step 9
Signals change before the ambulance arrives.

### Step 10
Ambulance moves through the corridor.

### Step 11
Traffic changes.

### Step 12
AI recalculates.

### Step 13
Corridor moves with ambulance.

### Step 14
Ambulance reaches hospital.

### Step 15
Run the same scenario without ITMS.

### Step 16
Show actual simulation metrics.

---

# PHASE 7 FINAL OUTPUT

A complete working ITMS platform containing:

```text
✓ Digital Traffic Twin
✓ Real-Time Traffic Intelligence
✓ Emergency Vehicle Management
✓ Dynamic Route Optimization
✓ AI Traffic Prediction
✓ Emergency ETA
✓ Predictive Green Corridor
✓ Signal Optimization
✓ Closed-Loop Re-optimization
✓ SUMO + TraCI Integration
✓ Command Center
✓ Live Map
✓ AI Decision Trace
✓ Scenario Simulator
✓ Baseline vs ITMS
✓ Performance Analytics
```

---

# FINAL 7-PHASE ARCHITECTURE

```text
                    ITMS
                     │
                     ▼
        ┌─────────────────────────┐
        │ PHASE 1                 │
        │ DIGITAL TRAFFIC WORLD   │
        │ SUMO + Roads + Signals  │
        └────────────┬────────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │ PHASE 2                 │
        │ TRAFFIC INTELLIGENCE    │
        │ Data + State + DB       │
        └────────────┬────────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │ PHASE 3                 │
        │ EMERGENCY + ROUTING     │
        │ Vehicle + A* + ETA      │
        └────────────┬────────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │ PHASE 4                 │
        │ AI TRAFFIC PREDICTION   │
        │ XGBoost                 │
        └────────────┬────────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │ PHASE 5                 │
        │ GREEN CORRIDOR          │
        │ Predict + Coordinate    │
        └────────────┬────────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │ PHASE 6                 │
        │ CLOSED-LOOP OPTIMIZATION│
        │ Observe + Re-optimize   │
        └────────────┬────────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │ PHASE 7                 │
        │ COMMAND CENTER          │
        │ UI + Analytics + Demo   │
        └─────────────────────────┘
```

---

# FINAL DEFINITION OF DONE

The project is complete only when the following end-to-end scenario works:

```text
🚑 Emergency
     ↓
Traffic understood
     ↓
Future traffic predicted
     ↓
Best route selected
     ↓
Emergency ETA calculated
     ↓
Upcoming intersections identified
     ↓
Green corridor generated
     ↓
Safety constraints checked
     ↓
Signals coordinated
     ↓
🚑 Moves through corridor
     ↓
Traffic changes
     ↓
AI re-evaluates
     ↓
Corridor re-optimized
     ↓
🏥 Emergency reaches destination
     ↓
Baseline vs ITMS measured
```

## The Core Rule

**Do not move to the next phase until the current phase has a working, testable output.**

The project's most important milestone is not the dashboard.

It is this:

```text
🚑
 ↓
AI
 ↓
🟢 → 🟢 → 🟢 → 🟢
 ↓
SUMO
 ↓
🚑 reaches destination
```

Once that works reliably, the rest of the product is built around it.
