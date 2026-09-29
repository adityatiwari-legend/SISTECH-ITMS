-- Migration 014: Allow recurring emergency vehicle dispatches and relax vehicle_id uniqueness
-- Allows vehicles (e.g. AMB-001) to be dispatched across multiple distinct missions without 23505 duplicate key violations.

ALTER TABLE emergency_vehicles DROP CONSTRAINT IF EXISTS emergency_vehicles_vehicle_id_key;
ALTER TABLE emergency_vehicles DROP CONSTRAINT IF EXISTS emergency_vehicles_vehicle_id_unique;
DROP INDEX IF EXISTS emergency_vehicles_vehicle_id_key;
DROP INDEX IF EXISTS idx_emergency_vehicles_vehicle_id;
