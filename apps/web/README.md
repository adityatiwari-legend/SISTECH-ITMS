# ITMS Web — Next.js command center.

The operator interface over the real ITMS backend (Phases 1-6 modules):
live map, emergency/corridor/signal panels, simulator + scenario builder,
analytics and the AI decision trace. All values come from the backend
(REST + WebSocket); no fabricated data.

## Run

```bash
cp .env.example .env.local    # set NEXT_PUBLIC_API_URL
npm run dev                   # http://localhost:3001 (dev)
# production:
npm run build && npm start
```

Requires the API (apps/api) running with PostgreSQL (+ PostGIS) and SUMO.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Command Center: live map (~65%) + emergency/corridor/signals/AI panels |
| `/traffic` | Traffic KPIs, congestion map, live trend, congested segments |
| `/emergencies` | Emergency list + detail (route, ETAs, live state) + creation flow |
| `/signals` | Signal table: state/remaining/queue/mode/emergency association |
| `/corridors` | Corridor chain 🚑→🟢→🟢→🏥 (real per-signal status) + activate/cancel |
| `/simulator` | Start/pause/reset/speed + scenario builder + baseline vs ITMS runner |
| `/analytics` | Measured aggregates + per-run charts (from recorded runs only) |
| `/decisions` | AI decision trace: real persisted + live system events |
| `/settings` | Component health + read-only settings summary (no secrets) |
