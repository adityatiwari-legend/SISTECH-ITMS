# SISTECH ITMS — Project Implementation & Status Report

**Intelligent Traffic Management System (ITMS) with Predictive Rolling Green Corridor & Mobile Ambulance Dispatch**

*Generated: September 2026*  
*Version: Production Hackathon Candidate*  

---

## Executive Summary

The **SISTECH ITMS** platform is a complete, real-time Intelligent Traffic Management System designed for Bhopal, India. It combines a microscopic traffic simulation digital twin (Eclipse SUMO + TraCI), a high-performance backend (Node.js / Fastify / TypeScript), an XGBoost predictive machine learning service (Python / FastAPI), a modern Command Center web interface (Next.js 15), and a Flutter Mobile Ambulance Driver Application (`SISTECH-APP`).

The system actively prevents gridlock and reduces emergency response times by demonstrating a verified **PREDICT → PREPARE → CLEAR → GREEN → PASS → RESTORE → ROLL FORWARD** cycle across traffic-light-controlled intersections.

---

## Architecture Overview

```
                      ┌──────────────────────────────────────────────┐
                      │          Flutter Mobile App                  │
                      │  - Driver Auth & GPS Telemetry (5 Hz)        │
                      │  - Emergency Creation & Camera Evidence      │
                      │  - Turn-by-Turn Navigation & Corridor Status │
                      └──────────────────────┬───────────────────────┘
                                             │ REST (HTTPS) + WebSocket (WSS)
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                Fastify Backend API (Port 3000)                                  │
│                                                                                                 │
│  ┌────────────────────────┐  ┌─────────────────────────┐  ┌──────────────────────────────────┐  │
│  │ Mobile Driver & Auth   │  │ Emergency Routing (A*)  │  │ Predictive Rolling Corridor      │  │
│  │ - JWT & scrypt hashing │  │ - Congestion-aware cost │  │ - Multi-signal synchronization   │  │
│  │ - GPS road projection  │  │ - Dynamic replanning    │  │ - Switch / Extend preemption     │  │
│  │ - Evidence upload      │  │ - Live intersection ETA │  │ - Yellow clearance safety bounds │  │
│  └───────────┬────────────┘  └────────────┬────────────┘  └────────────────┬─────────────────┘  │
│              │                            │                                │                    │
│              ▼                            ▼                                ▼                    │
│  ┌────────────────────────┐  ┌─────────────────────────┐  ┌──────────────────────────────────┐  │
│  │ AI Verification        │  │ Real-Time WebSocket Bus │  │ SUMO Simulation Manager          │  │
│  │ - Magic byte check     │  │ - 5 Hz vehicle telemetry│  │ - TraCI TCP socket (5 Hz)        │  │
│  │ - Auto green wave auth │  │ - Targeted filtering    │  │ - Bhopal OSM (478 junctions)     │  │
│  │ - Fraud flag & review  │  │ - Heartbeat & reconnect │  │ - 21 traffic-light signals       │  │
│  └────────────────────────┘  └─────────────────────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────┬──────────────────────────────────┬────────────────────────────┘
                                  │                                  │
            REST / JSON           │                                  │ TCP / TraCI
                                  ▼                                  ▼
      ┌──────────────────────────────────────────┐     ┌──────────────────────────────────────────┐
      │     XGBoost Prediction Microservice      │     │            Eclipse SUMO Twin             │
      │  - Python FastAPI (Port 8000)            │     │  - Real-world Bhopal OSM network         │
      │  - Horizons: 30s, 60s, 90s, 120s         │     │  - Vehicle physics & halting queues      │
      │  - Deterministic fallback model          │     │  - Dynamic route & phase control         │
      └──────────────────────────────────────────┘     └──────────────────────────────────────────┘
                                  ▲
                                  │ HTTP / WebSocket (Port 3001)
┌─────────────────────────────────┴───────────────────────────────────────────────────────────────┐
│                           Next.js 15 Web Command Center (Port 3001)                             │
│                                                                                                 │
│  - Live Map View: 5 Hz Vector SVG map, vehicle following, EmergencyMarker hero representation   │
│  - Active Corridor HUD: Live junction progression, current/next/upcoming ETAs                  │
│  - Simulator Studio: Baseline vs ITMS comparative benchmark runner with measured deltas         │
│  - Emergencies & AI Evidence Drawer: Photo evidence viewer with operator Approve / Reject       │
│  - Signals & Analytics: Real-time phase states, road segment congestion classification          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Status of Implemented & Working Modules

### 1. Road Network & Microscopic Simulation Twin (SUMO)
* **Status:** **Fully Implemented & Operational**
* **Digital Twin:** Real-world Bhopal OpenStreetMap (OSM) road network imported and converted into authoritative SUMO geometry:
  - **478** Junctions / Intersections
  - **883** Road Segments
  - **657** Physical Roads
  - **21** Real Traffic-Light Controlled Intersections
* **Coordinate Mapping:** Georeferenced UTM Zone 43N & WGS84 bidirectional transformation (SUMO meters $\leftrightarrow$ GPS Lat/Lng) via Proj4.
* **TraCI Protocol Client:**
  - Native binary TraCI socket client operating at **5 Hz** step frequency.
  - Controls traffic lights (`setSignalState`, `setSignalProgram`).
  - Vehicle lifecycle management: injection, routing edges, dynamic lane changing, and speed adjustments.
* **Simulation Lifecycle Scenarios:**
  - `baseline`: Standard uncoordinated fixed-time signal operation with mixed city traffic.
  - `emergency`: Baseline traffic with prioritized ambulance injection.
  - `emergency_low`: Low-density traffic condition for free-flow baselines.
  - `emergency_high`: Heavy gridlock scenario testing congestion relief.

---

### 2. Traffic Flow Aggregation & Congestion Classification
* **Status:** **Fully Implemented & Operational**
* **5 Hz Real-Time Telemetry:**
  - Real-time vehicle counting, average road speed (km/h), and halting queue length per lane.
  - Density (veh/km) and Flow Rate (veh/h) calculation across all active segments.
* **Congestion Classification:**
  - Categorizes segments into 4 deterministic tiers: `LOW` (Green), `MODERATE` (Blue/Yellow), `HIGH` (Orange), `CRITICAL` (Red).
  - Congestion levels are reflected live on both the web map SVG polylines and in the mobile app.

---

### 3. Dynamic A* Routing Engine
* **Status:** **Fully Implemented & Operational**
* **Travel-Time Cost Metric:** Uses congestion-adjusted travel times instead of simple hop count or static distance.
* **Dynamic Rerouting:**
  - Detects downstream queue buildup and automatically evaluates faster alternative paths around jammed segments.
  - Route switching applies hysteresis thresholds to prevent route flip-flopping.
* **ETA Estimator:** Computes absolute and remaining travel times to every downstream intersection and hospital destination.

---

### 4. Predictive Rolling Green Corridor (Priority Wave)
* **Status:** **Fully Implemented & Operational**
* **7-Stage Lifecycle:**
  $$\text{PREDICT} \longrightarrow \text{PREPARE} \longrightarrow \text{CLEAR} \longrightarrow \text{GREEN} \longrightarrow \text{PASS} \longrightarrow \text{RESTORE} \longrightarrow \text{ROLL FORWARD}$$
* **Safety Bounds & Signal Preemption:**
  - **Extend Mode:** Holds an already green light until the ambulance safely crosses.
  - **Switch Mode:** Early transitions opposing traffic to yellow clearance (3–4s safety buffer) before granting green.
  - Restricts cross-street red hold time to prevent downstream starvation.
* **Instant Signal Restoration:** Immediately restores passed intersections to their normal fixed-time cycle without leaving dangling priority states.
* **Robust Abort / Cancel:**
  - Operator abort (`POST /api/corridors/:id/cancel`) safely restores signals, logs the cancellation reason, and broadcasts cancellation across WebSockets.
  - Handles corridors whether in active memory runtime or database storage.

---

### 5. AI Machine Learning Prediction Service
* **Status:** **Fully Implemented & Operational**
* **Microservice:** Independent Python FastAPI service in `services/prediction/`.
* **Multi-Horizon XGBoost Models:**
  - Predicts queue build-up and vehicle count at **30s**, **60s**, **90s**, and **120s** intervals.
* **Resilient Fallback:**
  - If the Python prediction service is unreachable or starting, the Fastify backend automatically falls back to an internal deterministic trend model without crashing or interrupting simulation.

---

### 6. Mobile Driver Integration (`SISTECH-APP` & Backend)
* **Status:** **Fully Implemented & Operational**
* **Database Architecture (`007_mobile_integration.sql`):**
  - Schema for `drivers`, `driver_shifts`, `driver_locations`, `patient_evidence`, `ai_verifications`, and immutable `audit_events`.
* **Driver Endpoints:**
  - `POST /api/driver/login`: Authenticates drivers using `scrypt` password hashing and issues JWT tokens.
  - `POST /api/driver/select-vehicle`: Binds an active driver to a fleet unit (`AMB-UNIT-108`).
  - `POST /api/driver/location`: High-frequency mobile GPS ingestion (lat, lng, speed, heading) mapped directly onto the digital twin.
  - `POST /api/driver/emergency`: Direct dispatch by mobile drivers with origin/destination coordinates or hospital selection.
  - `GET /api/emergency/:id/route`: Returns the complete polyline path and road segments for mobile rendering.
  - `POST /api/emergency/:id/complete` & `/cancel`: Enforces driver ownership (`403 Forbidden` if caller is not the assigned driver).

---

### 7. AI Medical Photo Evidence Verification & Corridor Security
* **Status:** **Fully Implemented & Operational**
* **Camera Evidence Upload:**
  - `POST /api/emergency/:id/patient-image`: Multipart image upload with magic-byte file inspection (`JPEG`, `PNG`, `WEBP`) and a 15MB limit.
* **Anti-Fraud Security Logic:**
  - **`VERIFIED`**: Automatic authorization of the rolling green wave.
  - **`AI_FRAUD_FLAGGED`**: Holds green corridor activation, flags mission for manual review, and restricts preemption.
* **Operator Review Dashboard:**
  - `POST /api/admin/verifications/:id/approve`: Manual administrative override.
  - `POST /api/admin/verifications/:id/reject`: Rejection with audit reason logging.
  - Role-based authorization (`admin` / `operator`) strictly enforced.
* **Medical Privacy:** Patient evidence photos protected; anonymous access blocked.

---

### 8. Web Operations Command Center (Next.js 15 Frontend)
* **Status:** **Fully Implemented & Operational**
* **Vector SVG Simulation Map:**
  - 5 Hz live TraCI rendering of all moving vehicles in Bhopal.
  - Ambulance hero marker (`EmergencyMarker`) with heading chevron, red cross, pulsing halo, and siren strobes.
  - Camera tracking: **`FOLLOW EMERGENCY`** smoothly zooms and locks the viewport onto the ambulance as it maneuvers.
  - General vehicle following: Click any car or bus to inspect ID, speed (km/h), and track it with **`FOLLOW <id>`**.
* **Active Corridor Floating HUD:**
  - Live progress display showing cleared vs remaining junctions.
  - Real-time countdown timers for Current, Next, and Upcoming intersections.
* **Authoritative Benchmark Studio (`/simulator`):**
  - Side-by-side comparative benchmark runner (Baseline vs ITMS) using identical traffic seeds.
  - Measures total emergency travel time, average vehicle speeds, and congestion reduction percentage.
* **Operational Control Pages:**
  - **`/signals`**: Status and phase breakdown for all 21 controlled junctions.
  - **`/traffic`**: Live network heatmaps and road segment queues.
  - **`/emergencies`**: Incident lists, priority escalation, and AI Evidence review drawer.
  - **`/corridors`**: Historical and live green wave logs.

---

### 9. Real-Time WebSocket Event Bus (`/ws`)
* **Status:** **Fully Implemented & Operational**
* Broadcasts at 5 Hz with heartbeat management and targeted client distribution:
  - `traffic:update`: Live network segment metrics.
  - `vehicle:update`: Real-time vehicle positions, headings, and speeds.
  - `signal:update`: Live traffic light states and phase switches.
  - `emergency:update`: Position, ETA countdowns, and routing updates.
  - `corridor:update`: Signal preemption stages (`PREPARING`, `CLEARING`, `GREEN`, `PASSED`, `RESTORING`).
  - `emergency:verified` / `emergency:fraud-flagged`: AI verification status changes.

---

## Verification & Test Results

| Test Category | Target Component | Status | Details |
|---|---|:---:|---|
| **TypeScript Typecheck** | `@itms/api`, `@itms/types`, `web` | **PASS** | 0 errors across all workspaces |
| **Frontend Production Build** | Next.js 15 App Router | **PASS** | 15/15 static and dynamic pages compiled |
| **API Integration Tests** | Fastify REST Endpoints | **PASS** | Simulation lifecycle, signals, and routes verified |
| **Corridor Integration Tests** | Safety Constraints & Preemption | **PASS** | 4/4 integration tests passed (cancel, passage, programs) |
| **Signals Endpoint** | `GET /api/signals` | **PASS** | Returns 21 Bhopal signals immediately (running & idle) |
| **Benchmark Execution** | Comparative Evaluation Service | **PASS** | Runs baseline vs ITMS with real TraCI measurements |

---

## Quick Reference: Port Mappings & Services

| Service | Port | Path / URL | Key Responsibility |
|---|:---:|---|---|
| **Fastify API** | `3000` | `http://127.0.0.1:3000` | REST API, simulation engine, WebSocket bus |
| **Next.js Web UI** | `3001` | `http://localhost:3001` | Operations Command Center & Simulator Studio |
| **PostgreSQL / PostGIS** | `5433` | `postgres://itms:itms@127.0.0.1:5433/itms` | Spatial database & audit storage |
| **XGBoost Service** | `8000` | `http://127.0.0.1:8000` | Traffic prediction microservice |
| **TraCI Socket** | `8813` | Internal TCP | SUMO simulation command interface |
