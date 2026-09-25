export type RoadsideDeviceType = "SIMULATED_DISPLAY" | "PHYSICAL_DISPLAY";
export type RoadsideDeviceStatus = "ONLINE" | "OFFLINE" | "ACTIVE" | "ERROR";

export interface RoadsideDeviceRecord {
  id: number;
  deviceId: string;
  signalId: string;
  deviceType: RoadsideDeviceType;
  deviceName: string;
  status: RoadsideDeviceStatus;
  connected: boolean;
  lastSeenIso: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export type DeviceDisplayState =
  | "IDLE"
  | "PREDICT"
  | "PREPARING"
  | "CLEARING"
  | "GREEN"
  | "PASSING"
  | "PASSED"
  | "RESTORING"
  | "CANCELLED"
  | "ERROR";

export interface DeviceDisplayPayload {
  type: "device:display";
  deviceId: string;
  signalId: string;
  signalName?: string;
  displayState: DeviceDisplayState;
  priority?: "CRITICAL" | "HIGH" | "NORMAL";
  vehicle?: {
    id: string;
    type: "ambulance" | "fire_engine" | "police";
    speedKmh: number;
    distanceMeters: number;
    etaSeconds: number;
  } | null;
  corridor?: {
    id: number;
    state: string;
    currentIndex: number;
    totalSignals: number;
  } | null;
  message: string;
  timestamp: string;
}

export interface DeviceStateSnapshot {
  device: RoadsideDeviceRecord;
  display: DeviceDisplayPayload;
}
