-- Migration 012: Relax foreign key constraints on route_segments, routes, and emergency_route_switches
-- Ensures arbitrary OSM city network segments and dynamic on/off-ramp edges can be stored without foreign key violations.

ALTER TABLE route_segments DROP CONSTRAINT IF EXISTS route_segments_segment_id_fkey;
ALTER TABLE route_segments DROP CONSTRAINT IF EXISTS route_segments_from_junction_fkey;
ALTER TABLE route_segments DROP CONSTRAINT IF EXISTS route_segments_to_junction_fkey;

ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_origin_junction_fkey;
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_destination_junction_fkey;

ALTER TABLE emergency_route_switches DROP CONSTRAINT IF EXISTS emergency_route_switches_from_segment_fkey;
ALTER TABLE emergency_route_switches DROP CONSTRAINT IF EXISTS emergency_route_switches_to_segment_fkey;

ALTER TABLE driver_telemetry DROP CONSTRAINT IF EXISTS driver_telemetry_nearest_junction_id_fkey;
ALTER TABLE driver_telemetry DROP CONSTRAINT IF EXISTS driver_telemetry_nearest_segment_id_fkey;

