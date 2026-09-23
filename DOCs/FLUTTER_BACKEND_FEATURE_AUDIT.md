# ITMS Backend Feature Audit & Flutter Integration Roadmap

> **Audit Date:** September 2026  
> **Target Client:** Flutter Mobile Application (Emergency Driver & Responder App)  
> **Backend Stack:** Node.js / TypeScript, Fastify, PostgreSQL + PostGIS, SUMO (Simulation of Urban MObility) via TraCI, WebSockets.

---

## 1. Executive Summary

The **ITMS (Intelligent Traffic Management System)** backend is currently built as a digital traffic twin and automated green-corridor management platform. It coordinates simulation traffic, computes dynamic emergency routes (A* algorithm), predicts traffic congestion (via ML/fallback models), and dynamically controls traffic signals along an emergency vehicle's path.

For the **Flutter mobile application**, core emergency dispatch and corridor tracking capabilities already exist on the backend. However, mobile-specific features—such as driver identity/auth, vehicle assignment, patient photo upload, manual trip completion/cancellation, and GPS coordinate-to-junction translation—need to be implemented.

---

## 2. Checklist Matrix

### Legend
* [x] **Implemented**: Available in the backend today and ready to be consumed.
* [-] **Partially Implemented**: Present in simulation/database or partially exposed, but needs adaptation for mobile.
* [ ] **Not Implemented**: Missing from the backend; needs to be built.

---

### 📡 REST APIs

| Feature | Status | Current Backend State | What Needs to be Implemented |
| :--- | :---: | :--- | :--- |
| **Authentication** | [ ] | **None**. No auth middleware, JWT, session, or password hashing. Endpoints are currently unauthenticated. | JWT / session authentication, login & registration endpoints (`/api/auth/login`, `/api/auth/register`), role-based guards (`driver`, `dispatcher`, `admin`). |
| **Driver profile** | [ ] | **None**. No driver table or entity exists in database or API. | `drivers` table, profile retrieval (`GET /api/driver/profile`), and status management (`PUT /api/driver/profile`, `available`/`on_duty`/`off_duty`). |
| **Vehicle registration / selection** | [-] | Tables `emergency_vehicles` and `vehicles` exist, but vehicles are **auto-generated dynamically** during simulation dispatches (`emv-sim-1-...`). `GET /api/vehicles` only lists live simulation vehicles. | Persistent fleet catalog (`fleet_vehicles` table) and endpoints for drivers to query and bind active vehicles (`POST /api/vehicles/select`). |
| **Create emergency request** | [x] | `POST /api/emergency`<br>Computes A* route, creates DB record, spawns vehicle in SUMO. | Adapt to accept mobile GPS coordinates (`lat`, `lng`) in addition to network junction IDs; associate request with authenticated driver. |
| **Upload patient image** | [ ] | **None**. No multipart parser (`@fastify/multipart`) or file storage configured. | Multipart file upload endpoint (`POST /api/emergency/:id/patient-image`), media storage (local disk or S3), and DB image reference. |
| **Request status** | [x] | `GET /api/emergency/:id`<br>Returns status, route, live position, speed, and intersection ETAs. `GET /api/emergency` lists all. | Fully functional. |
| **Corridor status** | [x] | `GET /api/corridors/:id` and `GET /api/corridors`<br>Returns corridor states, planned green windows, and signal timings. Action: `POST /api/corridors/:id/activate`. | Fully functional. |
| **Route retrieval** | [-] | Route is embedded inside `GET /api/emergency/:id`. City network geometry is at `GET /api/network/geometry`. | Dedicated route preview endpoint (`POST /api/routes/preview`) to calculate and preview routes before creating an emergency. |
| **Emergency completion** | [ ] | Currently automatic only when SUMO vehicle arrives at destination junction (`markArrived`). No manual REST trigger. | `POST /api/emergency/:id/complete` allowing drivers to mark trip finished. |
| **Emergency cancellation** | [ ] | Corridors have `POST /api/corridors/:id/cancel`, but the emergency event itself cannot be cancelled via REST. | `POST /api/emergency/:id/cancel` with cancellation reason, updating DB and cleaning up SUMO entity. |
| **History** | [-] | `GET /api/emergency` lists all past emergencies. `GET /api/analytics` and `GET /api/decisions` provide audit traces. | Filtering by driver ID (`GET /api/driver/history`), pagination, and date range filters. |

---

### ⚡ WebSocket Events (`ws://<host>:<port>/ws`)

| Feature | Status | Current Backend Event | Payload & Behavior | What Needs to be Implemented |
| :--- | :---: | :--- | :--- | :--- |
| **Emergency request status** | [x] | `emergency:created`<br>`emergency:update` | Emits `eventId`, `status` (`active`, `arrived`, `failed`), `vehicleId`. | Ready for consumption. |
| **AI verification result** | [ ] | *None* | Backend currently runs traffic count ML predictions (`prediction:update`), not emergency/patient triage verification. | AI triage verification pipeline and `emergency:verified` event. |
| **Corridor activated** | [x] | `corridor:update` | Emits `status: "ACTIVE"`, signal schedules, and green windows. | Ready for consumption. |
| **Route update** | [x] | `route:updated`<br>`route:switched` | Emits route segments, estimated travel time, and switch rationale during dynamic re-routing. | Ready for consumption. |
| **ETA update** | [-] | `corridor:update`<br>`route:switched`<br>`GET /api/emergency/:id` | ETAs exist within corridor signal schedules and switch events, but no standalone high-frequency stream exists. | Lightweight dedicated `eta:update` event stream for the driver app. |
| **Signal / intersection updates** | [x] | `signal:update`<br>`traffic:update` | Real-time traffic signal states (RYG strings) and segment congestion. | Ready for consumption. |
| **Emergency vehicle position** | [x] | `emergency:update`<br>`vehicle:update` | Emits `positionX`, `positionY`, `lat`, `lng`, `speed`, `angle`, `roadId`. | Ready for consumption. |
| **Corridor completed / cancelled** | [x] | `corridor:update` | Emits `status: "COMPLETED"` or `status: "CANCELLED"`. | Ready for consumption. |
| **Connection / heartbeat** | [x] | `heartbeat` | Emitted every 15,000 ms (`{ type: "heartbeat", ts: "...", payload: { timestamp: number } }`). | Ready for consumption. |

---

### 🗄️ Supporting Data & Database Schema

| Entity | Status | Database Table / Source | Details |
| :--- | :---: | :--- | :--- |
| **Vehicle** | [x] | `emergency_vehicles`, `vehicles` | Stores `vehicle_id`, `type`, `priority`, `status`, coordinates, speed. |
| **Driver** | [ ] | *None* | Needs `drivers` table (id, name, phone, license, status, vehicle_id). |
| **Destination** | [-] | Intersection IDs / POIs | Stored as junction IDs (e.g., `I6`, `315577777`). Needs address & friendly labels. |
| **Hospital** | [-] | `facilities.add.xml` (POIs) | Exists in map geometry (`GET /api/network/geometry`). Needs dedicated `hospitals` table (name, beds, emergency contact). |
| **Emergency request** | [x] | `emergency_events` | Stores origin, destination, priority, timestamps, vehicle/route foreign keys. |
| **Corridor** | [x] | `green_corridors`, `corridor_signals` | Stores signal sequence, scheduled green start/end times, ETA per junction. |
| **Route** | [x] | `routes`, `route_segments` | Stores A* segments, junction hops, distance in meters, cost in seconds. |
| **Intersection** | [x] | `intersections`, `traffic_signals` | PostGIS point geometry, controlled flag, traffic light programs, and phases. |
| **Police zone** | [ ] | *None* | Vehicle type `'police'` is supported, but no geographic police zones or stations exist. |
| **Nearby vehicles** | [-] | SUMO TraCI / `vehicle:update` | All live simulation vehicles are streamed. Needs PostGIS spatial proximity query endpoint (`/api/vehicles/nearby`). |

---

## 3. Existing API Reference (Ready to Consume)

### Health & System
* `GET /health` — Health check endpoint.
* `GET /api/system` — System status, DB connectivity, simulation state.
* `GET /api/network/geometry` — Full map geometry with junctions, road segments, lane polylines, and facility coordinates (with WGS84 `lat`/`lng` when georeferenced).

### Simulation Control
* `POST /api/simulation/start` — `{ "scenario": "baseline" | "emergency" | "emergency_low" | "emergency_high" }`
* `POST /api/simulation/stop` — Stops simulation.
* `POST /api/simulation/pause` — Pauses simulation.
* `POST /api/simulation/resume` — Resumes simulation.
* `GET /api/simulation/state` — Live status snapshot.

### Traffic Intelligence
* `GET /api/traffic` — City-wide traffic metrics, congestion levels, queue lengths.
* `GET /api/traffic/roads` — Road registry.
* `GET /api/traffic/intersections` — Intersection registry.

### Emergency & Green Corridors
* `POST /api/emergency` — Create emergency dispatch:
  ```json
  {
    "type": "ambulance",
    "origin": "I1",
    "destination": "I6",
    "priority": "critical"
  }
  ```
* `GET /api/emergency` — List all emergencies.
* `GET /api/emergency/:id` — Full emergency detail including live position, speed, route, and junction ETAs.
* `POST /api/corridors` — Create green corridor: `{ "eventId": 1 }`
* `GET /api/corridors` — List all corridors.
* `GET /api/corridors/:id` — Corridor detail with signal schedule.
* `POST /api/corridors/:id/activate` — Activate corridor.
* `POST /api/corridors/:id/cancel` — Cancel corridor: `{ "reason": "optional reason" }`

### Real-Time WebSocket
Connect to `ws://<host>:<port>/ws`. Incoming messages follow the envelope:
```json
{
  "type": "emergency:update",
  "ts": "2026-09-24T00:50:00.000Z",
  "payload": { ... }
}
```

---

## 4. Implementation Roadmap for Flutter App

To support a production-grade Flutter emergency responder app, implement the missing features in three phases:

### Phase 1: Authentication & Mobile Core (High Priority)
1. **Authentication & Driver Model**:
   - Create migration: `drivers` table (id, name, phone, password_hash, license_no, duty_status).
   - Add `@fastify/jwt` or token-based authentication.
   - Endpoints: `POST /api/auth/login`, `GET /api/driver/profile`, `PUT /api/driver/status`.
2. **Vehicle Selection**:
   - Create migration: `fleet_vehicles` table (plate_number, type, model, assigned_driver_id).
   - Endpoints: `GET /api/vehicles/available`, `POST /api/driver/select-vehicle`.
3. **Emergency Lifecycle Endpoints**:
   - `POST /api/emergency/:id/complete` (Driver confirms arrival/delivery).
   - `POST /api/emergency/:id/cancel` (Driver or dispatcher cancels request).
4. **GPS-to-Junction Translation**:
   - Flutter provides GPS `(lat, lng)`.
   - Add a PostGIS spatial lookup (`ST_Distance`) to resolve device GPS coordinates to the nearest network junction/edge.

### Phase 2: Media, History & Master Data (Medium Priority)
5. **Patient Image Upload**:
   - Register `@fastify/multipart`.
   - Endpoint: `POST /api/emergency/:id/patient-image`.
   - Store images in an uploads directory or cloud bucket; link URL in `emergency_events`.
6. **Driver Trip History**:
   - Endpoint: `GET /api/driver/history` with pagination (`page`, `limit`).
7. **Hospital Master Data**:
   - Create `hospitals` table (name, lat, lng, address, emergency_phone, available_beds).
   - Endpoint: `GET /api/hospitals`.
8. **WebSocket Channel Filtering**:
   - Implement channel/room subscription (e.g. `client.send({ "action": "subscribe", "eventId": 123 })`) so the mobile app does not download high-frequency data for all city traffic cars.

### Phase 3: Enhancements (Low Priority)
9. **AI Triage / Verification**:
   - Add AI verification microservice or pipeline for patient image triage.
   - Emit `emergency:verified` over WebSocket.
10. **Proximity Search API**:
    - `GET /api/vehicles/nearby?lat=...&lng=...&radius=...` using PostGIS `ST_DWithin` to show nearby responders on the map.
11. **Police Zones**:
    - Add `police_zones` table with GeoJSON polygon boundaries if jurisdictional zone alerts are needed.
