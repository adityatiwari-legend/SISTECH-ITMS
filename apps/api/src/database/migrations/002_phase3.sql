-- ITMS Phase 3 — emergency vehicle + intelligent routing schema.
--
-- emergency_vehicles: the vehicle entity (type, priority, lifecycle).
-- emergency_events:   the dispatch event tying a vehicle to origin/destination.
-- routes:             a computed route (A*) for an emergency event.
-- route_segments:     ordered SUMO segments of a route.

CREATE TABLE emergency_vehicles (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    TEXT        NOT NULL UNIQUE,       -- SUMO vehicle id ("emv-<event>-<n>")
    type          TEXT        NOT NULL CHECK (type IN ('ambulance', 'fire_engine', 'police')),
    priority      TEXT        NOT NULL CHECK (priority IN ('critical', 'high', 'normal')),
    status        TEXT        NOT NULL CHECK (status IN ('created', 'active', 'arrived', 'cancelled', 'failed')),
    run_id        BIGINT      REFERENCES simulation_runs(id),
    origin_junction      TEXT NOT NULL REFERENCES intersections(id),
    destination_junction TEXT NOT NULL REFERENCES intersections(id),
    last_position_x DOUBLE PRECISION,
    last_position_y DOUBLE PRECISION,
    last_speed_mps  DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at  TIMESTAMPTZ,
    arrived_at    TIMESTAMPTZ
);

CREATE INDEX idx_emergency_vehicles_status ON emergency_vehicles(status);
CREATE INDEX idx_emergency_vehicles_run ON emergency_vehicles(run_id);

CREATE TABLE routes (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT,                            -- FK added after emergency_events exists
    algorithm     TEXT        NOT NULL DEFAULT 'astar',
    origin_junction      TEXT NOT NULL,
    destination_junction TEXT NOT NULL,
    edge_count    INTEGER     NOT NULL CHECK (edge_count > 0),
    total_length_m       DOUBLE PRECISION NOT NULL CHECK (total_length_m > 0),
    estimated_travel_time_s DOUBLE PRECISION NOT NULL CHECK (estimated_travel_time_s >= 0),
    free_flow_travel_time_s DOUBLE PRECISION NOT NULL CHECK (free_flow_travel_time_s >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE emergency_events (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    BIGINT      NOT NULL REFERENCES emergency_vehicles(id),
    route_id      BIGINT      REFERENCES routes(id),
    origin_junction      TEXT NOT NULL REFERENCES intersections(id),
    destination_junction TEXT NOT NULL REFERENCES intersections(id),
    priority      TEXT        NOT NULL CHECK (priority IN ('critical', 'high', 'normal')),
    status        TEXT        NOT NULL CHECK (status IN ('created', 'active', 'arrived', 'cancelled', 'failed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at  TIMESTAMPTZ,
    arrived_at    TIMESTAMPTZ
);

ALTER TABLE routes
    ADD CONSTRAINT fk_routes_event FOREIGN KEY (event_id) REFERENCES emergency_events(id);

CREATE INDEX idx_emergency_events_status ON emergency_events(status);
CREATE INDEX idx_emergency_events_vehicle ON emergency_events(vehicle_id);
CREATE INDEX idx_routes_event ON routes(event_id);

CREATE TABLE route_segments (
    id             BIGSERIAL PRIMARY KEY,
    route_id       BIGINT      NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    sequence_index INTEGER     NOT NULL CHECK (sequence_index >= 0),
    segment_id     TEXT        NOT NULL REFERENCES road_segments(id),
    from_junction  TEXT        NOT NULL REFERENCES intersections(id),
    to_junction    TEXT        NOT NULL REFERENCES intersections(id),
    length_m       DOUBLE PRECISION NOT NULL CHECK (length_m > 0),
    cost_seconds   DOUBLE PRECISION NOT NULL CHECK (cost_seconds >= 0),
    UNIQUE (route_id, sequence_index)
);

CREATE INDEX idx_route_segments_route ON route_segments(route_id, sequence_index);
