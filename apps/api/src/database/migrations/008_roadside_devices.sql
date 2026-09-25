-- ITMS Phase 9 — Connected Roadside Priority Displays (CRPD IoT Devices)

CREATE TABLE IF NOT EXISTS roadside_devices (
    id            BIGSERIAL PRIMARY KEY,
    device_id     TEXT        NOT NULL UNIQUE,
    signal_id     TEXT        NOT NULL,
    device_type   TEXT        NOT NULL DEFAULT 'SIMULATED_DISPLAY' CHECK (device_type IN ('SIMULATED_DISPLAY', 'PHYSICAL_DISPLAY')),
    device_name   TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'ONLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'ACTIVE', 'ERROR')),
    connected     BOOLEAN     NOT NULL DEFAULT false,
    last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadside_devices_device_id ON roadside_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_roadside_devices_signal_id ON roadside_devices(signal_id);
CREATE INDEX IF NOT EXISTS idx_roadside_devices_status ON roadside_devices(status);
