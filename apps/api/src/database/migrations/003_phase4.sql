-- ITMS Phase 4 — traffic predictions.

-- One row per (run, junction, sim time, horizon). Predictions are stored
-- with their source (ml | fallback) and the producing model version so that
-- ML and fallback estimates are distinguishable (Rules.md 10).
CREATE TABLE traffic_predictions (
    id                BIGSERIAL PRIMARY KEY,
    run_id            BIGINT       NOT NULL REFERENCES simulation_runs(id),
    junction_id       TEXT         NOT NULL REFERENCES intersections(id),
    sim_time_s        DOUBLE PRECISION NOT NULL,
    horizon_s         INTEGER      NOT NULL CHECK (horizon_s IN (30, 60, 90, 120)),
    predicted_vehicle_count INTEGER NOT NULL CHECK (predicted_vehicle_count >= 0),
    source            TEXT         NOT NULL CHECK (source IN ('ml', 'fallback')),
    model_version     TEXT,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_predictions_run_junction_time ON traffic_predictions(run_id, junction_id, sim_time_s, horizon_s);
CREATE INDEX idx_predictions_created ON traffic_predictions(created_at);
