-- Migration 011: Relax foreign key constraints on junctions for emergency vehicles, events, and green corridors
-- Allows arbitrary network/city/GPS-snapped junctions without violating legacy static intersection constraints.

ALTER TABLE emergency_vehicles DROP CONSTRAINT IF EXISTS emergency_vehicles_origin_junction_fkey;
ALTER TABLE emergency_vehicles DROP CONSTRAINT IF EXISTS emergency_vehicles_destination_junction_fkey;

ALTER TABLE emergency_events DROP CONSTRAINT IF EXISTS emergency_events_origin_junction_fkey;
ALTER TABLE emergency_events DROP CONSTRAINT IF EXISTS emergency_events_destination_junction_fkey;

ALTER TABLE green_corridors DROP CONSTRAINT IF EXISTS green_corridors_origin_junction_fkey;
ALTER TABLE green_corridors DROP CONSTRAINT IF EXISTS green_corridors_destination_junction_fkey;
