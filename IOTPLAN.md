# SISTECH ITMS — Connected Roadside Priority Display (CRPD) Architecture Plan

This document details the complete design, data structures, communication protocols, and execution workflows for the standalone IoT Roadside Display subsystem within SISTECH ITMS.

---

## 1. System Objective

The Connected Roadside Priority Display (CRPD) is physical roadside infrastructure installed at signalized intersections along emergency corridors. During green corridor operations, CRPD units alert drivers and pedestrians of incoming high-priority emergency vehicles (ambulances, fire engines, police escorts) with real-time ETA, vehicle speed, and safety advisories.

For hackathon demonstration and edge prototyping, any mobile phone, tablet, or web browser running `SISTECH-IOTDISPLAY` functions as physical roadside hardware. The same event architecture and DTO contracts directly support microcontrollers (ESP32, Raspberry Pi, LED matrix, character LCDs).

---

## 2. Core Architecture & Authority Isolation

```
                    SUMO Simulation / TraCI Client
                                  ↓
                        Fastify API Backend
                                  │
    ┌─────────────────────────────┴─────────────────────────────┐
    ↓                                                           ↓
Safety Validator & Traffic Signal Controller       RoadsideDeviceService (Edge Manager)
    │ (Authoritative Preemption)                                │
    ↓                                                           ↓
Traffic Signal State (SUMO net.xml)                Authoritative Display State Machine
                                                                ↓
                                                   Targeted WebSocket Event Bus
                                                                ↓
                                                   SISTECH-IOTDISPLAY (CRPD)
```

### Safety & Isolation Guarantees (Section 45 & 39)
1. **Read-Only Display:** The IoT application has zero capability to actuate signals, modify routes, or manipulate corridor state.
2. **Supplementary Notification:** If a roadside display drops offline, encounters packet loss, or reboots, green corridor preemption proceeds without interruption. Signal control never awaits display ACK.
3. **Privacy Isolation:** No patient imagery, medical diagnosis, driver credentials, or operator notes are ever broadcast to roadside displays. Only public operational data (vehicle type, speed, ETA, safety message) is transmitted.
4. **Bandwidth Filtering:** Devices identify on connection via `device:connect`. City-wide 5 Hz telemetry streams are suppressed; devices receive only targeted display events and heartbeats.

---

## 3. Database Schema & Device Model

Migration `008_roadside_devices.sql` defines the authoritative relational table:

```sql
CREATE TABLE IF NOT EXISTS roadside_devices (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(64) UNIQUE NOT NULL,
  signal_id VARCHAR(64) NOT NULL,
  device_name VARCHAR(255) NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'SIMULATED_DISPLAY',
  status VARCHAR(32) NOT NULL DEFAULT 'ONLINE',
  connected BOOLEAN NOT NULL DEFAULT false,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roadside_devices_signal_id ON roadside_devices(signal_id);
CREATE INDEX IF NOT EXISTS idx_roadside_devices_device_id ON roadside_devices(device_id);
```

### Signal Normalization & Device Naming
Real Bhopal controlled intersections (e.g., `315577777`, `315577785`) and synthetic grid junctions (`I1`..`I6`) are mapped to clean human-readable names and deterministic device codes via `naming.ts`:
- SUMO Signal `315577777` → Code `I-01` → Name *"Link Road Commercial Hub"* → Device `CRPD-I01-01`
- SUMO Signal `315577785` → Code `I-02` → Name *"Hospital Junction"* → Device `CRPD-I02-01`
- SUMO Signal `I2` → Code `I-02` → Name *"Central Boulevard Hub"* → Device `CRPD-I02-01`

---

## 4. REST API Contract

All endpoints are registered under `/api/devices`:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/devices` | List all provisioned roadside displays with connection status |
| `GET` | `/api/devices/:deviceId` | Retrieve device record by device ID or signal ID |
| `GET` | `/api/devices/signal/:signalId` | Retrieve device mapped to a specific signal |
| `GET` | `/api/devices/:deviceId/state` | Authoritative state snapshot for instant reconnect sync |
| `POST` | `/api/devices/register` | Register new physical hardware or customize display name |
| `POST` | `/api/devices/:deviceId/heartbeat` | Best-effort HTTP heartbeat update |
| `POST` | `/api/devices/:deviceId/reset` | Operator override to return display to IDLE |

---

## 5. WebSocket Event Protocol

All WebSocket events travel over the unified `/ws` endpoint:

### Client Identification (`device:connect`)
Sent by the device upon opening the WebSocket:
```json
{
  "type": "device:connect",
  "deviceId": "CRPD-I01-01",
  "clientType": "ROADSIDE_DISPLAY"
}
```

### Targeted Display Event (`device:display`)
Sent by backend to the specific hardware node when corridor state transitions:
```json
{
  "type": "device:display",
  "deviceId": "CRPD-I01-01",
  "signalId": "315577777",
  "signalName": "Link Road Commercial Hub",
  "displayState": "GREEN",
  "priority": "HIGH",
  "message": "GREEN CORRIDOR ACTIVE · PLEASE GIVE WAY",
  "vehicle": {
    "id": "emv-amb-01",
    "type": "AMBULANCE",
    "speedKmh": 54,
    "distanceMeters: 75,
    "etaSeconds": 4
  },
  "corridor": {
    "id": "corr-001",
    "state": "GREEN",
    "currentIndex": 1,
    "totalSignals": 6
  },
  "timestamp": "2026-09-26T01:30:00.000Z"
}
```

### Heartbeat (`device:heartbeat`)
Periodic ping every 10 seconds to refresh `last_seen` and prevent stale status:
```json
{
  "type": "device:heartbeat",
  "deviceId": "CRPD-I01-01"
}
```

---

## 6. Display State Machine

```
              ┌───────────────┐
              │     IDLE      │ ◄────────────────────────┐
              └───────┬───────┘                          │
                      │ Corridor Activated (Approaching) │
                      ▼                                  │
              ┌───────────────┐                          │
              │    PREDICT    │                          │
              └───────┬───────┘                          │
                      │ Window Reserved (ETA <= 30s)     │
                      ▼                                  │
              ┌───────────────┐                          │
              │   PREPARING   │                          │
              └───────┬───────┘                          │
                      │ Clearance Applied (Cross Red)    │
                      ▼                                  │
              ┌───────────────┐                          │ Corridor Cancelled
              │   CLEARING    │                          │ or Vehicle Passed
              └───────┬───────┘                          │
                      │ Preemption Active (Green)        │
                      ▼                                  │
              ┌───────────────┐                          │
              │     GREEN     │                          │
              └───────┬───────┘                          │
                      │ Distance <= 35m or ETA <= 2s     │
                      ▼                                  │
              ┌───────────────┐                          │
              │    PASSING    │                          │
              └───────┬───────┘                          │
                      │ Passed Signal                    │
                      ▼                                  │
              ┌───────────────┐                          │
              │   RESTORING   ├──────────────────────────┘
              └───────────────┘ (After 4s dwell)
```

---

## 7. Phone LAN & Tunnel Access

### Connection Configuration
The application supports public tunnels and direct LAN Wi-Fi:

1. **Active Tunnel URL:**
   - API: `https://sleep-utensil-afternoon.ngrok-free.dev`
   - WebSocket: `wss://sleep-utensil-afternoon.ngrok-free.dev/ws`
2. **Direct Local Wi-Fi (0.0.0.0 Binding):**
   - API: `http://<LAPTOP_LAN_IP>:3000`
   - Display: `http://<LAPTOP_LAN_IP>:3002`

---

## 8. Future Hardware Path (ESP32 / Pi / LED Boards)

Because all device communication is based on clean JSON DTO contracts over WebSocket, transitioning to physical microcontrollers requires zero backend logic changes:

1. **ESP32 Firmware:**
   - Connects to Wi-Fi.
   - Connects to `ws://<SERVER_IP>:3000/ws`.
   - Sends `{"type": "device:connect", "deviceId": "CRPD-I01-01"}`.
   - Parses `device:display` frames to drive:
     - MAX7219 / HUB75 LED matrix for ETA & arrows.
     - RGB LEDs for status (🟢 Green, 🟡 Yellow, 🔴 Red).
     - Piezo buzzer for warning tones.
2. **Optional MQTT Adapter:**
   - The backend `RoadsideDeviceService` can easily bind to an MQTT broker (Mosquitto) publishing to `itms/devices/<deviceId>/display` without altering the core corridor engine.
