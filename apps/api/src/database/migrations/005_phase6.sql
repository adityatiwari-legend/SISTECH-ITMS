-- ITMS Phase 6 — closed-loop optimization schema.

-- Measured per-run performance metrics (baseline vs ITMS comparison source).
CREATE TABLE simulation_metrics (
    run_id            BIGINT PRIMARY KEY REFERENCES simulation_runs(id) ON DELETE CASCADE,
    mode              TEXT NOT NULL CHECK (mode IN ('baseline', 'itms', 'unspecified')),
    emergency_travel_time_s DOUBLE PRECISION,
    emergency_time_loss_s   DOUBLE PRECISION,
    avg_vehicle_delay_s     DOUBLE PRECISION,
    avg_queue_length        DOUBLE PRECISION,
    avg_speed_mps           DOUBLE PRECISION,
    throughput_per_hour     DOUBLE PRECISION,
    signal_change_count     INTEGER NOT NULL DEFAULT 0 CHECK (signal_change_count >= 0),
    sim_duration_s          DOUBLE PRECISION NOT NULL DEFAULT 0,
    sample_count            INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_metrics_mode ON simulation_metrics(mode);

-- Recorded dynamic route switches (explainability + safeguards audit).
CREATE TABLE emergency_route_switches (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT      NOT NULL REFERENCES emergency_events(id),
    sim_time_s    DOUBLE PRECISION NOT NULL,
    from_route_id BIGINT      REFERENCES routes(id),
    to_route_id   BIGINT      REFERENCES routes(id),
    old_eta_s     DOUBLE PRECISION,
    new_eta_s     DOUBLE PRECISION,
    reason        TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_route_switches_event ON emergency_route_switches(event_id);

-- Sim-time bookkeeping on the emergency vehicle (travel-time metric source).
ALTER TABLE emergency_vehicles
    ADD COLUMN activated_sim_time_s DOUBLE PRECISION,
    ADD COLUMN arrived_sim_time_s   DOUBLE PRECISION;
