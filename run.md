# ITMS — Execution & Run Guide

Complete guide to installing, configuring, running, and testing the Intelligent Traffic Management System (ITMS).

---

## 1. System Architecture & Port Map

| Component | Technology | Default Host / Port | Role |
|---|---|---|---|
| **Web Frontend** | Next.js 15 + React 19 + SVG Twin | `http://localhost:3000` (or `3001`) | Mission Control Command Center |
| **Backend API** | Node.js + Fastify + TraCI | `http://127.0.0.1:3000` / `ws://127.0.0.1:3000/ws` | REST API, WebSocket & SUMO Controller |
| **SUMO Engine** | Eclipse SUMO (TraCI TCP socket) | Dynamic local socket | Digital traffic twin simulation |
| **PostgreSQL + PostGIS** | Docker (`postgis/postgis:16-3.4`) | `127.0.0.1:5433` (database `itms`) | Spatial road network & snapshot store |
| **AI Prediction Service** | Python 3 + FastAPI + XGBoost | `http://127.0.0.1:8100` | 120-second multi-step junction traffic forecast |

---

## 2. Prerequisites

### Required:
1. **Node.js**: `>= 24.7.0` (Node executes TypeScript directly via native type-stripping)
2. **SUMO (Simulation of Urban MObility)**:
   - **Windows (Easiest)**: Run in PowerShell or Command Prompt:
     ```powershell
     pip install eclipse-sumo
     ```
   - **Alternative**: Install [Eclipse SUMO installer](https://eclipse.dev/sumo/) and ensure `sumo` is added to your `PATH` (or set `SUMO_HOME`).
   - **Verify SUMO installation**:
     ```bash
     sumo --version
     ```

### Optional (Full Database & AI Features):
3. **Docker Desktop**: For running PostgreSQL + PostGIS container on port 5433.
4. **Python**: `>= 3.10` with `pip` for the XGBoost traffic prediction service.

---

## 3. One-Time Setup

### Step 1: Install Dependencies
From the repository root:
```bash
npm install
```

### Step 2: Environment Configuration

1. **Docker Environment** (if running PostGIS via Docker):
   ```bash
   cp docker/.env.example docker/.env
   ```
   *(Update `POSTGRES_PASSWORD` in `docker/.env` if desired).*

2. **Backend API Environment**:
   ```bash
   cp apps/api/.env.example apps/api/.env
   ```
   *Verify `apps/api/.env`:*
   ```env
   PORT=3000
   LOG_LEVEL=info
   DATABASE_URL=postgres://itms:itms-dev-pw@127.0.0.1:5433/itms
   TRAFFIC_EVENT_INTERVAL_MS=200
   PREDICTION_SERVICE_URL=http://127.0.0.1:8100
   ITMS_DEMO=city
   DEMO_CITY=Bhopal
   ```

3. **Frontend Web Environment**:
   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```
   *Verify `apps/web/.env.local`:*
   ```env
   NEXT_PUBLIC_API_URL=http://127.0.0.1:3000
   ```

### Step 3: Build SUMO Simulation Networks

Build the network files required for the simulation:

- **Option A: Synthetic 6-Junction Grid Network (Quickest)**
  ```bash
  npm run build:network
  ```
  *Output: `simulation/sumo/network/itms.net.xml`*

- **Option B: Real City Network (Bhopal OpenStreetMap Georeferenced)**
  ```bash
  npm run fetch:city
  npm run build:city-network
  ```
  *Output: `simulation/sumo/city/bhopal.net.xml`*

---

## 4. How to Run (Development Mode)

Open terminal windows for the services:

### Terminal 1: Database (PostGIS via Docker — Optional but Recommended)
```bash
docker compose --env-file docker/.env up -d db
```
> *Note: If Docker is not running, the backend will automatically fall back to in-memory state with a console notice.*

---

### Terminal 2: AI Prediction Microservice (Python XGBoost — Optional)
If you want live ML-based queue & volume predictions:
```bash
cd services/prediction
python -m pip install -r requirements.txt
python -m uvicorn inference.service:app --port 8100
```
> *Note: If this service is omitted, the ITMS backend safely uses its deterministic trend fallback without interrupting simulation or corridor control.*

---

### Terminal 3: Backend API & SUMO TraCI Engine (Required)
From the repository root:
```bash
npm run dev:api
```
- API will start on: **`http://127.0.0.1:3000`**
- WebSocket will stream at: **`ws://127.0.0.1:3000/ws`**

---

### Terminal 4: Frontend Command Center Web UI (Required)
From the repository root:
```bash
npm run dev:web
```
- Web Application will be live at: **`http://localhost:3000`** (or **`http://localhost:3001`** if port 3000 is occupied by the API).
- Open in your browser: [http://localhost:3001](http://localhost:3001) or [http://localhost:3000](http://localhost:3000)

---

## 5. Production Build & Run

To run optimized production builds:

### Build Web Frontend:
```bash
npm run build:web
```

### Start Web Frontend in Production:
```bash
npm run start --workspace web
```

### Start Backend in Production:
```bash
npm run start --workspace apps/api
```

---

## 6. Verification & CLI Control Commands

You can verify and interact with the running system directly using `curl` or PowerShell:

### 1. Check Backend Health
```bash
curl http://127.0.0.1:3000/health
```

### 2. Verify SUMO Network Geometry
```bash
curl http://127.0.0.1:3000/api/network/geometry
```

### 3. Start the Live Simulation
```bash
curl -X POST http://127.0.0.1:3000/api/simulation/start -H "Content-Type: application/json" -d "{}"
```

### 4. Inspect Live Traffic State
```bash
curl http://127.0.0.1:3000/api/traffic
```

### 5. Inspect Live Signals
```bash
curl http://127.0.0.1:3000/api/signals
```

### 6. Dispatch an Emergency Vehicle (Triggers A* & Predictive Corridor)
```bash
curl -X POST http://127.0.0.1:3000/api/emergency \
     -H "Content-Type: application/json" \
     -d "{\"type\":\"ambulance\",\"origin\":\"W1\",\"destination\":\"E2\",\"priority\":\"critical\"}"
```

### 7. Pause / Resume / Stop Simulation
- **Pause**:
  ```bash
  curl -X POST http://127.0.0.1:3000/api/simulation/pause
  ```
- **Resume**:
  ```bash
  curl -X POST http://127.0.0.1:3000/api/simulation/resume
  ```
- **Stop**:
  ```bash
  curl -X POST http://127.0.0.1:3000/api/simulation/stop
  ```

---

## 7. Testing & Quality Checks

Run all validation suites:

```bash
# TypeScript strict check across all workspaces (api, types, web)
npm run typecheck

# ESLint validation on the web UI
npm run lint --workspace web

# Backend unit & integration test suite (requires SUMO)
npm run test:api

# Python ML prediction service tests (requires pytest)
npm run test:prediction
```

---

## 8. Troubleshooting & Common Questions

1. **Port conflict on `3000`:**
   - The backend runs by default on port `3000`.
   - When launching `npm run dev:web`, Next.js will automatically detect that port `3000` is taken and bind to `http://localhost:3001`.
   - Ensure `apps/web/.env.local` contains `NEXT_PUBLIC_API_URL=http://127.0.0.1:3000`.

2. **SUMO binary not found (`spawn sumo ENOENT`):**
   - Ensure SUMO is in your environment `PATH`.
   - Test by running `sumo --version` in terminal.
   - If installed in a non-standard location, set `SUMO_BINARY` in `apps/api/.env`:
     ```env
     SUMO_BINARY=C:\Program Files\Eclipse Sumo\bin\sumo.exe
     ```

3. **PostgreSQL port `5433` vs `5432`:**
   - Docker container uses host port `5433` to prevent conflict with local Postgres services running on standard `5432`.
   - If not using Docker, ensure `DATABASE_URL` in `apps/api/.env` points to your accessible PostgreSQL instance.
