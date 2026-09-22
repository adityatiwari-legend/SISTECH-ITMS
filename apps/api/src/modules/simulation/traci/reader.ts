import { TraCIError } from "./errors.ts";
import { TRACI } from "./constants.ts";

export type TraciPoint = { x: number; y: number };
export type TraciPoint3 = TraciPoint & { z: number };
export type TraciColor = [number, number, number, number];
export type TraciPolygon = TraciPoint[];

export type TraciValue =
  | number
  | string
  | string[]
  | number[]
  | TraciPoint
  | TraciPoint3
  | TraciColor
  | TraciPolygon;

/**
 * Sequential reader over a TraCI message body.
 * All integers are big-endian, matching the TraCI wire format.
 */
export class TraCIReader {
  private readonly buffer: Buffer;
  private position: number;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.position = 0;
  }

  remaining(): number {
    return this.buffer.length - this.position;
  }

  private take(length: number): Buffer {
    if (this.remaining() < length) {
      throw new TraCIError(
        `Truncated TraCI message: need ${length} bytes at offset ${this.position}, have ${this.remaining()}`,
      );
    }
    const slice = this.buffer.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }

  readUByte(): number {
    return this.take(1).readUInt8(0);
  }

  readByte(): number {
    return this.take(1).readInt8(0);
  }

  readInt32(): number {
    return this.take(4).readInt32BE(0);
  }

  readDouble(): number {
    return this.take(8).readDoubleBE(0);
  }

  /** int32 length followed by UTF-8 bytes. */
  readString(): string {
    const length = this.readInt32();
    if (length < 0 || length > this.remaining()) {
      throw new TraCIError(`Invalid string length ${length} in TraCI message`);
    }
    return this.take(length).toString("utf8");
  }

  readStringList(): string[] {
    const count = this.readInt32();
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readString());
    }
    return result;
  }

  readDoubleList(): number[] {
    const count = this.readInt32();
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readDouble());
    }
    return result;
  }

  readPolygon(): TraciPolygon {
    const count = this.readInt32();
    const points: TraciPoint[] = [];
    for (let i = 0; i < count; i++) {
      points.push({ x: this.readDouble(), y: this.readDouble() });
    }
    return points;
  }

  /**
   * Reads a type marker followed by the value it describes. This is the
   * generic payload format used by "return from get" data commands.
   */
  readTypedValue(): TraciValue {
    const marker = this.readUByte();
    switch (marker) {
      case TRACI.TYPE_UBYTE:
        return this.readUByte();
      case TRACI.TYPE_BYTE:
        return this.readByte();
      case TRACI.TYPE_INTEGER:
        return this.readInt32();
      case TRACI.TYPE_DOUBLE:
        return this.readDouble();
      case TRACI.TYPE_STRING:
        return this.readString();
      case TRACI.TYPE_STRINGLIST:
        return this.readStringList();
      case TRACI.TYPE_DOUBLELIST:
        return this.readDoubleList();
      case TRACI.TYPE_POLYGON:
        return this.readPolygon();
      case TRACI.TYPE_COLOR:
        return [
          this.readUByte(),
          this.readUByte(),
          this.readUByte(),
          this.readUByte(),
        ] as TraciColor;
      case TRACI.POSITION_LON_LAT:
        return { x: this.readDouble(), y: this.readDouble() };
      case TRACI.POSITION_2D:
        return { x: this.readDouble(), y: this.readDouble() };
      case TRACI.POSITION_3D:
        return { x: this.readDouble(), y: this.readDouble(), z: this.readDouble() };
      default:
        throw new TraCIError(`Unsupported TraCI value type marker 0x${marker.toString(16)}`);
    }
  }
}
