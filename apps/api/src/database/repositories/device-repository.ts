import type { DatabasePool } from "../db.ts";
import type {
  RoadsideDeviceRecord,
  RoadsideDeviceType,
  RoadsideDeviceStatus,
} from "@itms/types";

export interface RoadsideDeviceRow {
  id: number;
  device_id: string;
  signal_id: string;
  device_type: RoadsideDeviceType;
  device_name: string;
  status: RoadsideDeviceStatus;
  connected: boolean;
  last_seen: Date;
  created_at: Date;
  updated_at: Date;
}

export function toRoadsideDeviceRecord(row: RoadsideDeviceRow): RoadsideDeviceRecord {
  return {
    id: Number(row.id),
    deviceId: row.device_id,
    signalId: row.signal_id,
    deviceType: row.device_type,
    deviceName: row.device_name,
    status: row.status,
    connected: row.connected,
    lastSeenIso: row.last_seen.toISOString(),
    createdAtIso: row.created_at.toISOString(),
    updatedAtIso: row.updated_at.toISOString(),
  };
}

export class DeviceRepository {
  private readonly db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async getAllDevices(): Promise<RoadsideDeviceRecord[]> {
    const res = await this.db.query<RoadsideDeviceRow>(
      `SELECT * FROM roadside_devices ORDER BY device_id ASC`
    );
    return res.rows.map(toRoadsideDeviceRecord);
  }

  async getDeviceById(deviceId: string): Promise<RoadsideDeviceRecord | null> {
    const res = await this.db.query<RoadsideDeviceRow>(
      `SELECT * FROM roadside_devices WHERE device_id = $1 LIMIT 1`,
      [deviceId]
    );
    if (res.rows.length === 0 || !res.rows[0]) return null;
    return toRoadsideDeviceRecord(res.rows[0]);
  }

  async getDeviceBySignalId(signalId: string): Promise<RoadsideDeviceRecord | null> {
    const res = await this.db.query<RoadsideDeviceRow>(
      `SELECT * FROM roadside_devices WHERE signal_id = $1 LIMIT 1`,
      [signalId]
    );
    if (res.rows.length === 0 || !res.rows[0]) return null;
    return toRoadsideDeviceRecord(res.rows[0]);
  }

  async upsertDevice(input: {
    deviceId: string;
    signalId: string;
    deviceName: string;
    deviceType?: RoadsideDeviceType;
    status?: RoadsideDeviceStatus;
    connected?: boolean;
  }): Promise<RoadsideDeviceRecord> {
    const deviceType = input.deviceType ?? "SIMULATED_DISPLAY";
    const status = input.status ?? "ONLINE";
    const connected = input.connected ?? false;

    const res = await this.db.query<RoadsideDeviceRow>(
      `INSERT INTO roadside_devices (device_id, signal_id, device_name, device_type, status, connected, last_seen, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now(), now())
       ON CONFLICT (device_id) DO UPDATE SET
         signal_id = EXCLUDED.signal_id,
         device_name = EXCLUDED.device_name,
         device_type = EXCLUDED.device_type,
         status = EXCLUDED.status,
         connected = EXCLUDED.connected,
         last_seen = now(),
         updated_at = now()
       RETURNING *`,
      [input.deviceId, input.signalId, input.deviceName, deviceType, status, connected]
    );
    return toRoadsideDeviceRecord(res.rows[0]!);
  }

  async updateConnectionStatus(
    deviceId: string,
    connected: boolean,
    status?: RoadsideDeviceStatus
  ): Promise<RoadsideDeviceRecord | null> {
    const statusClause = status ? `, status = '${status}'` : "";
    const res = await this.db.query<RoadsideDeviceRow>(
      `UPDATE roadside_devices
       SET connected = $2, last_seen = now(), updated_at = now() ${statusClause}
       WHERE device_id = $1
       RETURNING *`,
      [deviceId, connected]
    );
    if (res.rows.length === 0 || !res.rows[0]) return null;
    return toRoadsideDeviceRecord(res.rows[0]);
  }

  async updateHeartbeat(deviceId: string): Promise<void> {
    await this.db.query(
      `UPDATE roadside_devices
       SET connected = true, last_seen = now(), updated_at = now()
       WHERE device_id = $1`,
      [deviceId]
    );
  }

  async resetDevice(deviceId: string): Promise<RoadsideDeviceRecord | null> {
    const res = await this.db.query<RoadsideDeviceRow>(
      `UPDATE roadside_devices
       SET status = 'ONLINE', connected = false, last_seen = now(), updated_at = now()
       WHERE device_id = $1
       RETURNING *`,
      [deviceId]
    );
    if (res.rows.length === 0 || !res.rows[0]) return null;
    return toRoadsideDeviceRecord(res.rows[0]);
  }
}
