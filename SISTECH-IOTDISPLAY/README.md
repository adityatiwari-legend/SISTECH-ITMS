# SISTECH-IOTDISPLAY — Connected Roadside Priority Display (CRPD)

A standalone Next.js Progressive Web Application representing physical edge IoT roadside priority displays installed near signalized traffic intersections.

During emergency green corridor activation, each CRPD autonomously transitions through authoritative visual states driven directly by the central ITMS traffic controller:

```
IDLE → PREDICT → PREPARING → CLEARING → GREEN → PASSING → RESTORING → IDLE
```

---

## 1. Architecture & Design Principles

```
  SUMO Traffic Simulation / TraCI (Authoritative Traffic World)
                            ↓
  Fastify Backend (`apps/api` on 0.0.0.0:3000)
    ├── Emergency Engine & A* Route Discovery
    ├── Predictive Rolling Green Corridor Planner
    ├── Signal Controller (Preemption / Phase Overrides)
    └── RoadsideDeviceService (Maps Signal → CRPD Hardware)
                            ↓
           WebSocket Bus (`/ws` with Targeted Filtering)
                            ↓
   ┌───────────────────────────────────────────────────────────┐
   │                  SISTECH-IOTDISPLAY                       │
   │  Phone / Tablet / Browser Roadside Display Hardware       │
   │  (No fake data · No Math.random() · Read-only renderer)   │
   └───────────────────────────────────────────────────────────┘
```

- **Read-Only Supplementary Device:** Roadside displays NEVER control signals or compute routes. If any roadside display disconnects or goes offline, traffic preemption and signal safety proceed uninterrupted.
- **Targeted WebSocket Stream:** Roadside devices identify via `device:connect` and receive strictly relevant display payloads and heartbeats. City-wide 5 Hz telemetry streams are suppressed to preserve edge bandwidth.
- **Authoritative Backend Transitions:** Vehicle ETA, speed, corridor membership, and display states are computed authoritatively by the backend. The frontend is a high-contrast physical renderer.
- **Future Hardware Ready:** The JSON DTO payload is decoupled from React and ready for physical ESP32, Raspberry Pi, LCD, and LED matrix hardware via WebSocket or future MQTT transport.

---

## 2. Environment Variables

Create `.env.local` inside `SISTECH-IOTDISPLAY/`:

```env
# Central ITMS Backend API Base URL
# Option A: Active public ngrok tunnel
NEXT_PUBLIC_ITMS_API_BASE_URL=https://sleep-utensil-afternoon.ngrok-free.dev

# Option B: Direct local LAN Wi-Fi (replace with your laptop's Wi-Fi IP e.g. 192.168.1.105)
# NEXT_PUBLIC_ITMS_API_BASE_URL=http://192.168.1.105:3000

# Option C: Localhost (browser tab on same laptop)
# NEXT_PUBLIC_ITMS_API_BASE_URL=http://127.0.0.1:3000

# Central ITMS WebSocket Bus URL
NEXT_PUBLIC_ITMS_WS_URL=wss://sleep-utensil-afternoon.ngrok-free.dev/ws
# NEXT_PUBLIC_ITMS_WS_URL=ws://192.168.1.105:3000/ws
# NEXT_PUBLIC_ITMS_WS_URL=ws://127.0.0.1:3000/ws

# Optional default device ID fallback
NEXT_PUBLIC_DEFAULT_DEVICE_ID=CRPD-I01-01
```

> **Note on ngrok:** The app automatically includes header `ngrok-skip-browser-warning: 69420` to bypass ngrok intermediate warning screens.

---

## 3. Installation & Local Development

From the repository root:

```bash
# 1. Install root & workspace dependencies
npm install

# 2. Typecheck all workspaces
npm run typecheck

# 3. Start ITMS Fastify API (runs on 0.0.0.0:3000)
npm run dev:api

# 4. Start ITMS Web Command Center (runs on 0.0.0.0:3001)
npm run dev:web

# 5. Start Roadside IoT Display App (runs on 0.0.0.0:3002)
npm run dev:iot
```

The application will be accessible at:
- **Local laptop:** [http://localhost:3002](http://localhost:3002)
- **Local network / Phone:** `http://<LAPTOP_LAN_IP>:3002`

---

## 4. Phone & Tablet Setup (Physical Roadside Prototype)

### Step 1: Connect Phone & Laptop
Connect both your laptop and phone to the same Wi-Fi network (or laptop mobile hotspot).

### Step 2: Open Roadside App on Phone
Open your mobile browser (Chrome/Safari) and navigate to either:
1. **Public Tunnel:** `https://sleep-utensil-afternoon.ngrok-free.dev` (proxied or direct)
2. **Local LAN:** `http://<LAPTOP_LAN_IP>:3002` (e.g., `http://192.168.1.105:3002`)

### Step 3: Hardware Provisioning Screen
When opening for the first time:
1. Tap **Configure Roadside Hardware**.
2. Select an intersection from the live list of 21 controlled signals (e.g., *Hospital Junction*, *Link Road Commercial Hub*, *Hamidia Medical Crossing*).
3. The app generates the canonical hardware identifier (e.g., `CRPD-I01-01`) and registers with the backend.
4. Tap **Confirm & Deploy Device**. The device identity is persisted in `localStorage`.

### Step 4: Direct URL Support (Demo Mode)
You can directly link any phone or browser tab to a specific hardware node:
```
http://<LAPTOP_LAN_IP>:3002/display?device=CRPD-I01-01
http://<LAPTOP_LAN_IP>:3002/display?device=CRPD-I02-01
http://<LAPTOP_LAN_IP>:3002/display?device=CRPD-I03-01
```

If an unregistered device ID is requested, the system displays a clear **DEVICE NOT REGISTERED** warning instead of fabricating fake data.

---

## 5. Simulating an Emergency & Corridor Verification

1. Open **Command Center** on your laptop: `http://localhost:3001`.
2. Navigate to **Roadside Displays** (`/roadside-devices`) to verify connected displays show `ONLINE`.
3. In Command Center, initiate an emergency run (or launch simulation via `/simulator` or POST `/api/emergency`).
4. Watch the phone display transform automatically:
   - **PREDICT:** Detected priority vehicle en route (~30s out).
   - **PREPARING:** Yellow window reserved, displaying real vehicle speed & ETA (~15s out).
   - **CLEARING:** Cross-traffic clearing notification (~8s out).
   - **GREEN CORRIDOR ACTIVE:** Prominent emerald green visual with high-contrast countdown and public advisory: *"PLEASE GIVE WAY"*.
   - **PASSING NOW:** Vehicle crossing junction.
   - **RESTORING:** Green corridor completed, intersection restored to normal cycle.
   - **IDLE:** Returns to standby display.

---

## 6. Features Built for Mobile & Physical Hardware

- **Screen Wake Lock API:** Prevents phone or tablet screen from going to sleep during field demonstrations.
- **Audio Alerts (Web Audio API):** Optional synthesize warning tones for preparation and passage after user enablement.
- **Automatic Reconnection:** Exponential backoff reconnection with instant authoritative state snapshot sync (`GET /api/devices/:deviceId/state`).
- **PWA Ready:** Installable Progressive Web App with standalone full-screen manifest.

---

## 7. Command Center Integration

The central ITMS Command Center includes:
1. **/roadside-devices:** Comprehensive edge hardware management dashboard with metrics (Total, Online, Offline, Active Corridor Displays), real-time status chips, and direct display links.
2. **Interactive SUMO Map (`SimulationMap.tsx`):**
   - Controlled signals feature IoT indicator dots:
     - 🟢 **Online:** Active WebSocket heartbeat.
     - 🔴 **Active Corridor:** Pulse glow during emergency preemption.
     - ⚫ **Offline:** Standby or unlinked.
   - Clicking any intersection reveals the **Roadside Priority Display (CRPD)** card with device telemetry and a 1-click launch button.
