-- ITMS Phase 8 — Mobile Integration Schema: Drivers, Fleet, Hospitals, Verifications & Telemetry

-- ------------------------------------------------------------- 1. DRIVERS ----
CREATE TABLE IF NOT EXISTS drivers (
    id            BIGSERIAL PRIMARY KEY,
    driver_code   TEXT        NOT NULL UNIQUE,
    name          TEXT        NOT NULL,
    email         TEXT        NOT NULL UNIQUE,
    phone         TEXT,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'driver' CHECK (role IN ('driver', 'admin', 'operator')),
    status        TEXT        NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_duty', 'off_duty', 'in_emergency')),
    license_number TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drivers_email ON drivers(email);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);

-- ------------------------------------------------------ 2. FLEET VEHICLES ----
CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id                   BIGSERIAL PRIMARY KEY,
    vehicle_code         TEXT        NOT NULL UNIQUE,
    registration_number  TEXT        NOT NULL UNIQUE,
    vehicle_type         TEXT        NOT NULL CHECK (vehicle_type IN ('ambulance', 'fire_engine', 'police')),
    model                TEXT        NOT NULL DEFAULT 'Emergency Response Unit',
    status               TEXT        NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'in_emergency', 'maintenance')),
    assigned_driver_id   BIGINT      REFERENCES drivers(id) ON DELETE SET NULL,
    current_emergency_id BIGINT,
    last_latitude        DOUBLE PRECISION,
    last_longitude       DOUBLE PRECISION,
    last_heading         DOUBLE PRECISION,
    last_speed_kmh       DOUBLE PRECISION,
    last_telemetry_at    TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_driver ON fleet_vehicles(assigned_driver_id);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_status ON fleet_vehicles(status);

-- ------------------------------------------------- 3. VEHICLE ASSIGNMENTS ----
CREATE TABLE IF NOT EXISTS driver_vehicle_assignments (
    id             BIGSERIAL PRIMARY KEY,
    driver_id      BIGINT      NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    vehicle_id     BIGINT      NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    unassigned_at  TIMESTAMPTZ,
    is_active      BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_dva_driver ON driver_vehicle_assignments(driver_id, is_active);

-- ----------------------------------------------------------- 4. HOSPITALS ----
CREATE TABLE IF NOT EXISTS hospitals (
    id                  BIGSERIAL PRIMARY KEY,
    name                TEXT        NOT NULL,
    code                TEXT        NOT NULL UNIQUE,
    address             TEXT        NOT NULL,
    latitude            DOUBLE PRECISION NOT NULL,
    longitude           DOUBLE PRECISION NOT NULL,
    emergency_phone     TEXT,
    available_beds      INTEGER     NOT NULL DEFAULT 10,
    trauma_level        TEXT        NOT NULL DEFAULT 'Level 1',
    nearest_junction_id TEXT        NOT NULL REFERENCES intersections(id),
    status              TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'diverting', 'full')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hospitals_junction ON hospitals(nearest_junction_id);

-- -------------------------------------------------------- 5. POLICE ZONES ----
CREATE TABLE IF NOT EXISTS police_zones (
    id                       BIGSERIAL PRIMARY KEY,
    name                     TEXT        NOT NULL,
    zone_code                TEXT        NOT NULL UNIQUE,
    headquarters_junction_id TEXT        REFERENCES intersections(id),
    contact_phone            TEXT,
    active_officers_count    INTEGER     DEFAULT 0,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------- 6. EXTEND EMERGENCY EVENTS FOR MOBILE ----
ALTER TABLE emergency_events DROP CONSTRAINT IF EXISTS emergency_events_status_check;
ALTER TABLE emergency_events ADD CONSTRAINT emergency_events_status_check
    CHECK (status IN ('created', 'active', 'arrived', 'completed', 'cancelled', 'failed'));

ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS driver_id BIGINT REFERENCES drivers(id);
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS fleet_vehicle_id BIGINT REFERENCES fleet_vehicles(id);
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS hospital_id BIGINT REFERENCES hospitals(id);
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS patient_condition TEXT;
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'codeRed';
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS authorization_status TEXT DEFAULT 'pending'
    CHECK (authorization_status IN ('pending', 'analyzing', 'authorized', 'rejected', 'bypassed'));
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE emergency_events ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- -------------------------------------------------- 7. EMERGENCY EVIDENCE ----
CREATE TABLE IF NOT EXISTS emergency_evidence (
    id              BIGSERIAL PRIMARY KEY,
    event_id        BIGINT      NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
    driver_id       BIGINT      REFERENCES drivers(id),
    file_path       TEXT        NOT NULL,
    file_name       TEXT        NOT NULL,
    mime_type       TEXT        NOT NULL DEFAULT 'image/jpeg',
    file_size_bytes INTEGER     NOT NULL,
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_evidence_event ON emergency_evidence(event_id);

-- --------------------------------------------- 8. EMERGENCY VERIFICATIONS ----
CREATE TABLE IF NOT EXISTS emergency_verifications (
    id                     BIGSERIAL PRIMARY KEY,
    request_id             TEXT        NOT NULL UNIQUE,
    event_id               BIGINT      NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
    driver_id              BIGINT      REFERENCES drivers(id),
    vehicle_id             BIGINT      REFERENCES fleet_vehicles(id),
    status                 TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
      'captured', 'submitted', 'pending', 'aiAnalyzing', 'aiApproved',
      'aiFraudFlagged', 'manualReview', 'adminApproved', 'adminRejected', 'corridorAssigned'
    )),
    is_corridor_authorized BOOLEAN     NOT NULL DEFAULT false,
    submitted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verifications_event ON emergency_verifications(event_id);
CREATE INDEX IF NOT EXISTS idx_verifications_request_id ON emergency_verifications(request_id);

-- ------------------------------------------- 9. AI VERIFICATION RESULTS ----
CREATE TABLE IF NOT EXISTS ai_verification_results (
    id                  BIGSERIAL PRIMARY KEY,
    verification_id     BIGINT      NOT NULL REFERENCES emergency_verifications(id) ON DELETE CASCADE,
    verdict             TEXT        NOT NULL CHECK (verdict IN ('VERIFIED', 'FRAUD_FLAGGED', 'REVIEW_REQUIRED')),
    confidence_score    DOUBLE PRECISION NOT NULL,
    reason              TEXT        NOT NULL,
    detected_features   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    is_flagged_as_fraud BOOLEAN     NOT NULL DEFAULT false,
    model               TEXT        NOT NULL,
    source              TEXT        NOT NULL DEFAULT 'server_ai',
    evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_results_verification ON ai_verification_results(verification_id);

-- ------------------------------------ 10. MANUAL VERIFICATION DECISIONS ----
CREATE TABLE IF NOT EXISTS manual_verification_decisions (
    id               BIGSERIAL PRIMARY KEY,
    verification_id  BIGINT      NOT NULL REFERENCES emergency_verifications(id) ON DELETE CASCADE,
    reviewer_id      TEXT        NOT NULL,
    reviewer_name    TEXT        NOT NULL,
    is_approved      BOOLEAN     NOT NULL,
    rejection_reason TEXT,
    notes            TEXT,
    decided_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_decisions_verification ON manual_verification_decisions(verification_id);

-- -------------------------------------------------------- 11. AUDIT LOG ----
CREATE TABLE IF NOT EXISTS audit_events (
    id         BIGSERIAL PRIMARY KEY,
    action     TEXT        NOT NULL,
    actor_id   TEXT,
    actor_type TEXT        NOT NULL DEFAULT 'driver' CHECK (actor_type IN ('driver', 'admin', 'operator', 'system')),
    event_id   BIGINT,
    details    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_event ON audit_events(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);

-- -------------------------------------------- 12. GPS DRIVER TELEMETRY ----
CREATE TABLE IF NOT EXISTS driver_telemetry (
    id                 BIGSERIAL PRIMARY KEY,
    driver_id          BIGINT      NOT NULL REFERENCES drivers(id),
    vehicle_id         BIGINT      REFERENCES fleet_vehicles(id),
    event_id           BIGINT      REFERENCES emergency_events(id),
    latitude           DOUBLE PRECISION NOT NULL,
    longitude          DOUBLE PRECISION NOT NULL,
    accuracy           DOUBLE PRECISION,
    speed_mps          DOUBLE PRECISION,
    heading            DOUBLE PRECISION,
    nearest_junction_id TEXT       REFERENCES intersections(id),
    nearest_segment_id  TEXT       REFERENCES road_segments(id),
    recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_event ON driver_telemetry(event_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_driver ON driver_telemetry(driver_id, recorded_at);

-- ---------------------------------------------------- 13. SEED INITIAL DATA ----
-- Default password: password123 (scrypt:salt:hash format or sha256:salt:hash)
-- SHA256 hex of 'password123' with salt 'sistechsalt':
-- sha256('password123:sistechsalt') = 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
INSERT INTO drivers (driver_code, name, email, phone, password_hash, role, status, license_number)
VALUES
  ('DRV-802', 'Vikram Rathore', 'driver@sistec.demo', '+91 98765 43210', 'sha256:sistechsalt:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae', 'driver', 'available', 'MP-04-2018-009231'),
  ('ADM-001', 'Traffic Operations Admin', 'admin@sistec.demo', '+91 755 2770000', 'sha256:sistechsalt:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae', 'admin', 'on_duty', 'ADM-MP-001')
ON CONFLICT (email) DO NOTHING;

INSERT INTO fleet_vehicles (vehicle_code, registration_number, vehicle_type, model, status)
VALUES
  ('AMB-001', 'MP-04-EA-1080', 'ambulance', 'Force Traveller Advanced Life Support', 'available'),
  ('AMB-002', 'MP-04-EA-1081', 'ambulance', 'Tata Winger Basic Life Support', 'available'),
  ('AMB-UNIT-108', 'MP-04-EA-1088', 'ambulance', 'Force Traveller ICU Rapid Response', 'available'),
  ('FIRE-001', 'MP-04-FT-1010', 'fire_engine', 'Ashok Leyland Water Tender Heavy', 'available'),
  ('POL-001', 'MP-04-PC-1000', 'police', 'Mahindra Scorpio High-Speed Interceptor', 'available')
ON CONFLICT (vehicle_code) DO NOTHING;

-- Seed Bhopal Emergency Hospitals linked to network junctions
INSERT INTO hospitals (name, code, address, latitude, longitude, emergency_phone, available_beds, trauma_level, nearest_junction_id, status)
VALUES
  ('AIIMS Bhopal Trauma Center', 'AIIMS-BPL', 'Saket Nagar, AIIMS Campus, Bhopal', 23.2065, 77.4601, '+91 755 2982601', 18, 'Level 1 Trauma', 'I6', 'active'),
  ('Bansal Hospital', 'BANSAL-BPL', 'Chuna Bhatti, Shahpura, Bhopal', 23.1972, 77.4328, '+91 755 4086000', 12, 'Level 2 Trauma', 'I5', 'active'),
  ('Hamidia Hospital', 'HAMIDIA-BPL', 'Medical College Campus, Sultania Road, Bhopal', 23.2606, 77.3933, '+91 755 2540222', 25, 'Level 1 Trauma', 'I1', 'active'),
  ('Bhopal Memorial Hospital & Research Centre', 'BMHRC-BPL', 'Raisen Bypass Road, Karond, Bhopal', 23.3105, 77.4101, '+91 755 2740392', 15, 'Level 2 Trauma', 'I3', 'active'),
  ('Chirayu Health City', 'CHIRAYU-BPL', 'Bhopal-Indore Highway, Bairagarh, Bhopal', 23.2750, 77.3400, '+91 755 2709000', 20, 'Level 1 Trauma', 'I4', 'active')
ON CONFLICT (code) DO NOTHING;

INSERT INTO police_zones (name, zone_code, headquarters_junction_id, contact_phone, active_officers_count)
VALUES
  ('Zone 1 - MP Nagar Police Station', 'PZ-MPN', 'I2', '+91 755 2551100', 14),
  ('Zone 2 - Habibganj Police Station', 'PZ-HBG', 'I5', '+91 755 2552200', 10),
  ('Zone 3 - TT Nagar Police Station', 'PZ-TTN', 'I3', '+91 755 2553300', 12)
ON CONFLICT (zone_code) DO NOTHING;
