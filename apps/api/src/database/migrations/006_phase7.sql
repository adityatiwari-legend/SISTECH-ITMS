-- ITMS Phase 7 — command center supporting schema.

-- Traffic-level scenario variants (scenario builder).
ALTER TABLE simulation_runs DROP CONSTRAINT simulation_runs_scenario_check;
ALTER TABLE simulation_runs ADD CONSTRAINT simulation_runs_scenario_check
    CHECK (scenario IN ('baseline', 'emergency', 'emergency_low', 'emergency_high'));

-- Persisted baseline vs ITMS comparison results (measured values only;
-- the analytics "time saved" aggregate comes from these rows).
CREATE TABLE comparisons (
    job_id        TEXT PRIMARY KEY,
    type          TEXT NOT NULL CHECK (type IN ('ambulance', 'fire_engine', 'police')),
    origin_junction      TEXT NOT NULL REFERENCES intersections(id),
    destination_junction TEXT NOT NULL REFERENCES intersections(id),
    priority      TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'normal')),
    baseline_run_id BIGINT REFERENCES simulation_runs(id),
    itms_run_id     BIGINT REFERENCES simulation_runs(id),
    delta_travel_time_s     DOUBLE PRECISION,
    delta_avg_delay_s       DOUBLE PRECISION,
    delta_avg_queue         DOUBLE PRECISION,
    delta_avg_speed_mps     DOUBLE PRECISION,
    delta_throughput_per_h  DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_comparisons_completed ON comparisons(completed_at);
