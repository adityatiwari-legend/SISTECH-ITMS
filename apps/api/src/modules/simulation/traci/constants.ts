/**
 * TraCI protocol constants.
 *
 * Values verified against the reference TraCI client shipped with the SUMO
 * installation in use (traci/constants.py, SUMO 1.27.1, TraCI API version 22).
 */
export const TRACI = {
  // General commands
  CMD_GET_VERSION: 0x00,
  CMD_SIM_STEP: 0x02,
  CMD_CLOSE: 0x7f,

  // Domain commands: get / set
  CMD_GET_SIM_VARIABLE: 0xab,
  CMD_SET_SIM_VARIABLE: 0xcb,
  CMD_GET_LANE_VARIABLE: 0xa3,
  CMD_SET_LANE_VARIABLE: 0xc3,
  CMD_GET_EDGE_VARIABLE: 0xaa,
  CMD_GET_ROUTE_VARIABLE: 0xa6,
  CMD_SET_ROUTE_VARIABLE: 0xc6,
  CMD_GET_TL_VARIABLE: 0xa2,
  CMD_SET_TL_VARIABLE: 0xc2,
  CMD_GET_VEHICLE_VARIABLE: 0xa4,
  CMD_SET_VEHICLE_VARIABLE: 0xc4,

  // Data command responses ("return from get") = get id + 0x10
  RESPONSE_GET_SIM_VARIABLE: 0xbb,
  RESPONSE_GET_LANE_VARIABLE: 0xb3,
  RESPONSE_GET_TL_VARIABLE: 0xb2,
  RESPONSE_GET_VEHICLE_VARIABLE: 0xb4,

  // Value type markers used in payloads
  TYPE_UBYTE: 0x07,
  TYPE_BYTE: 0x08,
  TYPE_INTEGER: 0x09,
  TYPE_DOUBLE: 0x0b,
  TYPE_STRING: 0x0c,
  TYPE_STRINGLIST: 0x0e,
  TYPE_COMPOUND: 0x0f,
  TYPE_DOUBLELIST: 0x10,
  TYPE_COLOR: 0x11,
  TYPE_POLYGON: 0x06,
  POSITION_LON_LAT: 0x00,
  POSITION_2D: 0x01,
  POSITION_3D: 0x03,

  // Status codes
  STATUS_OK: 0x00,
  STATUS_NOT_IMPLEMENTED: 0x01,
  STATUS_ERROR: 0xff,

  // Simulation domain variables
  VAR_TIME: 0x66,
  VAR_DELTA_T: 0x7b,
  VAR_LOADED_VEHICLES_NUMBER: 0x71,
  VAR_DEPARTED_VEHICLES_NUMBER: 0x73,
  VAR_DEPARTED_VEHICLES_IDS: 0x74,
  VAR_ARRIVED_VEHICLES_NUMBER: 0x79,
  VAR_ARRIVED_VEHICLES_IDS: 0x7a,
  VAR_PENDING_VEHICLES: 0x94,
  VAR_MIN_EXPECTED_VEHICLES: 0x7d,

  // Lane domain variables
  LAST_STEP_VEHICLE_NUMBER: 0x10,
  LAST_STEP_MEAN_SPEED: 0x11,
  LAST_STEP_OCCUPANCY: 0x13,
  LAST_STEP_VEHICLE_HALTING_NUMBER: 0x14,

  // Traffic light domain variables
  TL_RED_YELLOW_GREEN_STATE: 0x20,
  TL_PHASE_INDEX: 0x22,
  TL_CURRENT_PROGRAM: 0x29,
  TL_PHASE_DURATION: 0x24,
  TL_CONTROLLED_LANES: 0x26,
  TL_NEXT_SWITCH: 0x2d,
  TL_CURRENT_PHASE: 0x28,

  // Vehicle domain variables
  VAR_SPEED: 0x40,
  VAR_POSITION: 0x42,
  VAR_TYPE: 0x4f,
  VAR_ROAD_ID: 0x50,
  VAR_ROUTE_ID: 0x53,
  VAR_LANE_ID: 0x51,
  VAR_LANEPOSITION: 0x56,
  VAR_WAITING_TIME: 0x7a,
  VAR_ROUTE: 0x57,
  VAR_ROUTE_INDEX: 0x69,

  // Vehicle lifecycle set-variables
  ADD_FULL: 0x85,
  REMOVE: 0x81,
  REMOVE_TELEPORT: 0x00,
  REMOVE_PARKING: 0x01,
  REMOVE_VAPORIZED: 0x03,

  // Route domain variables
  VAR_EDGES: 0x54,
  ROUTE_ADD: 0x80,

  // Cross-domain variables
  TRACI_ID_LIST: 0x00,
  ID_COUNT: 0x01,
} as const;

/** Characters permitted in a red/yellow/green state string (SUMO: rugGyYuoO). */
export const RYG_STATE_CHARS = new Set(["r", "u", "g", "G", "y", "Y", "o", "O"]);
