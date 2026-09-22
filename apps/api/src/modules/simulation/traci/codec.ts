import { TRACI } from "./constants.ts";
import { TraCIError, FatalTraCIError } from "./errors.ts";
import { TraCIReader } from "./reader.ts";

/** A single TraCI command to be packed into a message. */
export interface TraciCommand {
  /** Command id, e.g. CMD_GET_VEHICLE_VARIABLE or CMD_SET_TL_VARIABLE. */
  cmdId: number;
  /**
   * Domain variable id. When present the command is written in
   * "variable command" form: [varId][objectId][payload].
   */
  varId?: number;
  /** Object id (vehicle id, tls id, ...). Required when varId is present. */
  objId?: string;
  /** Raw payload bytes appended after the header. */
  payload?: Buffer;
}

/** Status block that precedes every TraCI response command. */
export interface TraciStatus {
  cmdId: number;
  result: number;
  description: string;
}

/** Header of a "return from get" data command. */
export interface GetDataHeader {
  responseId: number;
  varId: number;
  objId: string;
}

function encodeStringBytes(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

/**
 * Encodes a single command:
 * [length ubyte][cmdId][varId?][objId string?][payload]
 * where the length value includes the length byte itself, matching the
 * reference client. For commands longer than 255 bytes the legacy extended
 * form is used: [0 ubyte][4-byte extended length][cmdId]...
 */
export function encodeCommand(cmd: TraciCommand): Buffer {
  const varId = cmd.varId;
  const hasVar = varId !== undefined;
  const objIdBytes = hasVar ? Buffer.from(cmd.objId ?? "", "utf8") : Buffer.alloc(0);
  const payload = cmd.payload ?? Buffer.alloc(0);
  const varBlock = hasVar ? 1 + 4 + objIdBytes.length : 0;
  const bodyLength = 2 + varBlock + payload.length;

  let lengthBytes: Buffer;
  if (bodyLength <= 255) {
    lengthBytes = Buffer.from([bodyLength]);
  } else {
    lengthBytes = Buffer.alloc(5);
    lengthBytes.writeUInt8(0, 0);
    lengthBytes.writeInt32BE(bodyLength + 4, 1);
  }

  const fixed = Buffer.alloc(hasVar ? 6 : 1);
  fixed.writeUInt8(cmd.cmdId, 0);
  if (hasVar) {
    fixed.writeUInt8(varId, 1);
    fixed.writeInt32BE(objIdBytes.length, 2);
  }
  return Buffer.concat([lengthBytes, fixed, objIdBytes, payload]);
}

/** Wraps commands into one message: [4-byte total length][commands...] */
export function encodeMessage(commands: TraciCommand[]): Buffer {
  if (commands.length === 0) {
    throw new FatalTraCIError("Cannot encode an empty TraCI message");
  }
  const body = Buffer.concat(commands.map(encodeCommand));
  const header = Buffer.alloc(4);
  header.writeInt32BE(body.length + 4, 0);
  return Buffer.concat([header, body]);
}

/** Typed payload: [TYPE_STRING][int32 length][utf8 bytes] */
export function encodeTypedString(value: string): Buffer {
  const bytes = encodeStringBytes(value);
  const out = Buffer.alloc(5);
  out.writeUInt8(TRACI.TYPE_STRING, 0);
  out.writeInt32BE(bytes.length, 1);
  return Buffer.concat([out, bytes]);
}

/** Raw big-endian double without a type marker (used by CMD_SIM_STEP). */
export function encodeRawDouble(value: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeDoubleBE(value, 0);
  return out;
}

/**
 * Reads the status block of one response command:
 * [statusLen ubyte][cmdId ubyte][resultCode ubyte][description string]
 * The statusLen byte itself is informational; the description length is
 * explicit, matching the reference client's parsing.
 */
export function readStatus(reader: TraCIReader): TraciStatus {
  const statusLength = reader.readUByte();
  const cmdId = reader.readUByte();
  const result = reader.readUByte();
  const description = reader.readString();
  if (result !== TRACI.STATUS_OK) {
    const label =
      result === TRACI.STATUS_NOT_IMPLEMENTED
        ? "not implemented"
        : result === TRACI.STATUS_ERROR
          ? "error"
          : `status 0x${result.toString(16)}`;
    throw new TraCIError(
      `${label}: ${description || "no description"}`.trim(),
      cmdId,
    );
  }
  if (statusLength < 3) {
    throw new FatalTraCIError(`Malformed status block (statusLength=${statusLength})`);
  }
  return { cmdId, result, description };
}

/**
 * Reads the length field of a response command, which is either one byte
 * (value includes itself) or, for large commands, a zero byte followed by a
 * 4-byte total length (also including the 5 length-encoding bytes).
 */
export function readResponseCommandLength(reader: TraCIReader): number {
  const firstByte = reader.readUByte();
  if (firstByte !== 0) return firstByte;
  return reader.readInt32();
}

/**
 * Reads and validates the data command that follows the status block of a
 * domain GET response:
 * [cmdLength][responseId = getCmdId + 0x10][varId][objId string]
 */
export function readGetDataHeader(
  reader: TraCIReader,
  getCmdId: number,
  expectedVarId: number,
  expectedObjId: string,
): GetDataHeader {
  const cmdLength = readResponseCommandLength(reader);
  const responseId = reader.readUByte();
  const varId = reader.readUByte();
  const objId = reader.readString();
  if (responseId !== getCmdId + 0x10) {
    throw new FatalTraCIError(
      `Received data command 0x${responseId.toString(16)} for GET command 0x${getCmdId.toString(16)}`,
    );
  }
  if (varId !== expectedVarId) {
    throw new FatalTraCIError(
      `Received variable 0x${varId.toString(16)} while expecting 0x${expectedVarId.toString(16)}`,
    );
  }
  if (objId !== expectedObjId) {
    throw new FatalTraCIError(
      `Received answer for object "${objId}" while expecting "${expectedObjId}"`,
    );
  }
  if (cmdLength < 7) {
    throw new FatalTraCIError(`Malformed data command header (cmdLength=${cmdLength})`);
  }
  return { responseId, varId, objId };
}

/** TRUE for commands whose response carries a data command after the status block. */
export function commandExpectsData(cmdId: number): boolean {
  return (
    cmdId === TRACI.CMD_GET_VERSION ||
    cmdId === TRACI.CMD_SIM_STEP ||
    (cmdId & 0xf0) === 0xa0
  );
}
