-- Migration 013: Relax foreign key constraint on road_segments.road_id and junctions
-- Ensures dynamic TraCI / OSM segments never fail database insertion during live emergency routing.

ALTER TABLE road_segments DROP CONSTRAINT IF EXISTS road_segments_road_id_fkey;
ALTER TABLE road_segments DROP CONSTRAINT IF EXISTS road_segments_from_junction_fkey;
ALTER TABLE road_segments DROP CONSTRAINT IF EXISTS road_segments_to_junction_fkey;
ALTER TABLE roads DROP CONSTRAINT IF EXISTS roads_from_junction_fkey;
ALTER TABLE roads DROP CONSTRAINT IF EXISTS roads_to_junction_fkey;
