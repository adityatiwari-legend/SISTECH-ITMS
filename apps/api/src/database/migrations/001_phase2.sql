-- ITMS Phase 2 — Traffic Intelligence Layer schema.
--
-- Conventions:
-- - Geometry is stored in the SUMO network's local cartesian coordinate
--   system. The network is not geo-referenced (netOffset 0,0, no proj
--   parameter), so SRID 0 (undefined CRS) is used deliberately.
-- - Snapshots always reference a simulation run (Rules.md 10: never mix
--   runs without scenario/run identity).
-- - Tables are created by migrations/001_phase2.sql via the migration
--   runner; applied migrations are never edited, only followed by new ones.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------- runs ----
CREATE TABLE simulation_runs (
    id            BIGSERIAL PRIMARY KEY,
    scenario      TEXT        NOT NULL CHECK (scenario IN ('baseline', 'emergency')),
    status        TEXT        NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    sumo_version  TEXT,
    step_length_s DOUBLE PRECISION NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at      TIMESTAMPTZ
);

-- ------------------------------------------------------ static network ----
CREATE TABLE intersections (
    id         TEXT PRIMARY KEY,           -- SUMO junction id (I1..I6, W1..N3)
    kind       TEXT        NOT NULL,       -- SUMO junction type (traffic_light, priority, ...)
    controlled BOOLEAN     NOT NULL,       -- true when junction has a traffic light
    x          DOUBLE PRECISION NOT NULL,
    y          DOUBLE PRECISION NOT NULL,
    geom       geometry(Point, 0) NOT NULL
);

CREATE TABLE roads (
    id           TEXT PRIMARY KEY,         -- undirected junction pair, e.g. "I1-I2"
    name         TEXT        NOT NULL,
    from_junction TEXT       NOT NULL REFERENCES intersections(id),
    to_junction   TEXT       NOT NULL REFERENCES intersections(id)
);

CREATE TABLE road_segments (
    id            TEXT PRIMARY KEY,        -- SUMO directed edge id, e.g. "i1_i2"
    road_id       TEXT        NOT NULL REFERENCES roads(id),
    from_junction TEXT        NOT NULL REFERENCES intersections(id),
    to_junction   TEXT        NOT NULL REFERENCES intersections(id),
    lane_count    INTEGER     NOT NULL CHECK (lane_count > 0),
    length_m      DOUBLE PRECISION NOT NULL CHECK (length_m > 0),
    max_speed_mps DOUBLE PRECISION NOT NULL CHECK (max_speed_mps > 0),
    geom          geometry(LineString, 0) NOT NULL
);

CREATE INDEX idx_segments_road ON road_segments(road_id);

CREATE TABLE traffic_signals (
    id              TEXT PRIMARY KEY,      -- SUMO tlLogic id (= junction id)
    intersection_id TEXT        NOT NULL UNIQUE REFERENCES intersections(id),
    program_id      TEXT        NOT NULL,  -- static program id from the network
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signal_phases (
    signal_id  TEXT             NOT NULL REFERENCES traffic_signals(id),
    program_id TEXT             NOT NULL,
    phase_index INTEGER         NOT NULL CHECK (phase_index >= 0),
    duration_s DOUBLE PRECISION NOT NULL CHECK (duration_s > 0),
    state      TEXT             NOT NULL,
    PRIMARY KEY (signal_id, program_id, phase_index)
);

-- ---------------------------------------------------------- vehicles ------
-- Live vehicle registry per run: last observed position/edge per vehicle.
CREATE TABLE vehicles (
    run_id      BIGINT       NOT NULL REFERENCES simulation_runs(id),
    vehicle_id  TEXT         NOT NULL,
    type_id     TEXT         NOT NULL,
    edge_id     TEXT,
    lane_id     TEXT,
    position_x  DOUBLE PRECISION,
    position_y  DOUBLE PRECISION,
    speed_mps   DOUBLE PRECISION,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, vehicle_id)
);

CREATE INDEX idx_vehicles_run ON vehicles(run_id, last_seen_at);

-- --------------------------------------------------------- snapshots ------
-- Per directed segment per collection interval.
CREATE TABLE traffic_snapshots (
    id                BIGSERIAL PRIMARY KEY,
    run_id            BIGINT       NOT NULL REFERENCES simulation_runs(id),
    segment_id        TEXT         NOT NULL REFERENCES road_segments(id),
    sim_time_s        DOUBLE PRECISION NOT NULL,
    vehicle_count     INTEGER      NOT NULL CHECK (vehicle_count >= 0),
    avg_speed_mps     DOUBLE PRECISION NOT NULL CHECK (avg_speed_mps >= 0),
    queue_length      INTEGER      NOT NULL CHECK (queue_length >= 0),
    occupancy         DOUBLE PRECISION NOT NULL CHECK (occupancy >= 0),
    flow_rate_per_h   DOUBLE PRECISION NOT NULL CHECK (flow_rate_per_h >= 0),
    congestion        TEXT         NOT NULL CHECK (congestion IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    collected_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_snapshots_run_segment_time ON traffic_snapshots(run_id, segment_id, sim_time_s);
CREATE INDEX idx_snapshots_collected ON traffic_snapshots(collected_at);

-- Per traffic signal per collection interval.
CREATE TABLE signal_snapshots (
    id                BIGSERIAL PRIMARY KEY,
    run_id            BIGINT       NOT NULL REFERENCES simulation_runs(id),
    signal_id         TEXT         NOT NULL REFERENCES traffic_signals(id),
    sim_time_s        DOUBLE PRECISION NOT NULL,
    program_id        TEXT         NOT NULL,
    phase_index       INTEGER      NOT NULL,
    state             TEXT         NOT NULL,
    phase_duration_s  DOUBLE PRECISION NOT NULL,
    next_switch_s     DOUBLE PRECISION NOT NULL,
    queue_length      INTEGER      NOT NULL CHECK (queue_length >= 0),
    congestion        TEXT         NOT NULL CHECK (congestion IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    collected_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_signal_snapshots_run_signal_time ON signal_snapshots(run_id, signal_id, sim_time_s);
CREATE INDEX idx_signal_snapshots_collected ON signal_snapshots(collected_at);
