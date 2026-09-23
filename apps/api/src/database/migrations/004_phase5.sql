-- ITMS Phase 5 — predictive rolling green corridor schema.

CREATE TABLE green_corridors (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT      NOT NULL REFERENCES emergency_events(id),
    status        TEXT        NOT NULL CHECK (status IN
      ('PLANNING', 'VALIDATING', 'ACTIVE', 'REPLANNING', 'COMPLETED', 'CANCELLED', 'FAILED')),
    origin_junction      TEXT NOT NULL REFERENCES intersections(id),
    destination_junction TEXT NOT NULL REFERENCES intersections(id),
    junction_count INTEGER    NOT NULL CHECK (junction_count >= 0),
    planned_at_sim_time_s DOUBLE PRECISION,
    planned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at  TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    cancelled_at  TIMESTAMPTZ,
    failed_at     TIMESTAMPTZ,
    cancel_reason TEXT,
    last_error    TEXT
);

CREATE INDEX idx_corridors_event ON green_corridors(event_id);
CREATE INDEX idx_corridors_status ON green_corridors(status);

CREATE TABLE corridor_signals (
    id                 BIGSERIAL PRIMARY KEY,
    corridor_id        BIGINT      NOT NULL REFERENCES green_corridors(id) ON DELETE CASCADE,
    signal_id          TEXT        NOT NULL REFERENCES traffic_signals(id),
    sequence_index     INTEGER     NOT NULL CHECK (sequence_index >= 0),
    approach_segment_id TEXT       NOT NULL REFERENCES road_segments(id),
    eta_seconds        DOUBLE PRECISION,
    planned_green_start_s DOUBLE PRECISION,
    planned_green_end_s   DOUBLE PRECISION,
    planned_state      TEXT,
    applied_state      TEXT,
    mode               TEXT        NOT NULL CHECK (mode IN ('switch', 'extend', 'noop')),
    requires_clearance BOOLEAN     NOT NULL DEFAULT false,
    status             TEXT        NOT NULL CHECK (status IN ('PENDING', 'APPLIED', 'PASSED', 'SKIPPED', 'NOOP')),
    skip_reason        TEXT,
    predicted_vehicle_count INTEGER,
    applied_at         TIMESTAMPTZ,
    passed_at          TIMESTAMPTZ,
    UNIQUE (corridor_id, sequence_index)
);

CREATE INDEX idx_corridor_signals_corridor ON corridor_signals(corridor_id, sequence_index);
CREATE INDEX idx_corridor_signals_signal ON corridor_signals(signal_id);
