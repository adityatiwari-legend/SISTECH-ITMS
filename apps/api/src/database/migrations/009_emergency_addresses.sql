-- Migration 009: Add address and GPS fields to emergency_events for driver mobile app telemetry
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS origin_address TEXT;
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS destination_address TEXT;
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS pickup_latitude DOUBLE PRECISION;
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS pickup_longitude DOUBLE PRECISION;
