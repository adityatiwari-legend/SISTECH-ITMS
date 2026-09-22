import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TraCIReader } from "../src/modules/simulation/traci/reader.ts";
import { TRACI } from "../src/modules/simulation/traci/constants.ts";
import {
  commandExpectsData,
  encodeCommand,
  encodeMessage,
  encodeTypedString,
  encodeRawDouble,
  readGetDataHeader,
  readStatus,
} from "../src/modules/simulation/traci/codec.ts";
import { TraCIError, FatalTraCIError } from "../src/modules/simulation/traci/errors.ts";

function hex(buffer: Buffer): string {
  return [...buffer].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

describe("TraCIReader", () => {
  it("reads big-endian primitives", () => {
    const buffer = Buffer.alloc(1 + 4 + 8);
    buffer.writeUInt8(7, 0);
    buffer.writeInt32BE(0x12345678, 1);
    buffer.writeDoubleBE(3.5, 5);
    const reader = new TraCIReader(buffer);
    assert.equal(reader.readUByte(), 7);
    assert.equal(reader.readInt32(), 0x12345678);
    assert.equal(reader.readDouble(), 3.5);
    assert.equal(reader.remaining(), 0);
  });

  it("reads length-prefixed strings and string lists", () => {
    const parts: Buffer[] = [];
    const push = (bytes: Buffer) => parts.push(bytes);
    const length = Buffer.alloc(4);
    length.writeInt32BE(5, 0);
    push(length);
    push(Buffer.from("hello", "utf8"));
    const listCount = Buffer.alloc(4);
    listCount.writeInt32BE(2, 0);
    push(listCount);
    for (const word of ["a", "bb"]) {
      const len = Buffer.alloc(4);
      len.writeInt32BE(word.length, 0);
      push(len);
      push(Buffer.from(word, "utf8"));
    }
    const reader = new TraCIReader(Buffer.concat(parts));
    assert.equal(reader.readString(), "hello");
    assert.deepEqual(reader.readStringList(), ["a", "bb"]);
  });

  it("parses typed values", () => {
    const parts: Buffer[] = [];
    const int = Buffer.alloc(5);
    int.writeUInt8(TRACI.TYPE_INTEGER, 0);
    int.writeInt32BE(-42, 1);
    parts.push(int);

    const dbl = Buffer.alloc(9);
    dbl.writeUInt8(TRACI.TYPE_DOUBLE, 0);
    dbl.writeDoubleBE(1.25, 1);
    parts.push(dbl);

    parts.push(Buffer.from([TRACI.TYPE_UBYTE, 200]));

    const str = Buffer.from([TRACI.TYPE_STRING]);
    const len = Buffer.alloc(4);
    len.writeInt32BE(3, 0);
    parts.push(str, len, Buffer.from("abc", "utf8"));

    parts.push(Buffer.from([TRACI.POSITION_2D]));
    const xy = Buffer.alloc(16);
    xy.writeDoubleBE(10, 0);
    xy.writeDoubleBE(20, 8);
    parts.push(xy);

    const reader = new TraCIReader(Buffer.concat(parts));
    assert.equal(reader.readTypedValue(), -42);
    assert.equal(reader.readTypedValue(), 1.25);
    assert.equal(reader.readTypedValue(), 200);
    assert.equal(reader.readTypedValue(), "abc");
    assert.deepEqual(reader.readTypedValue(), { x: 10, y: 20 });
    assert.equal(reader.remaining(), 0);
  });

  it("rejects truncated reads", () => {
    const reader = new TraCIReader(Buffer.from([1, 2]));
    assert.throws(() => reader.readInt32(), TraCIError);
  });

  it("rejects unknown type markers", () => {
    const reader = new TraCIReader(Buffer.from([0x77]));
    assert.throws(() => reader.readTypedValue(), TraCIError);
  });
});

describe("TraCI codec", () => {
  it("encodes a plain command with self-inclusive length", () => {
    const encoded = encodeCommand({ cmdId: TRACI.CMD_GET_VERSION });
    assert.equal(encoded.length, 2);
    assert.equal(encoded[0], 2);
    assert.equal(encoded[1], 0x00);
  });

  it("encodes a domain GET command", () => {
    const encoded = encodeCommand({
      cmdId: TRACI.CMD_GET_VEHICLE_VARIABLE,
      varId: TRACI.VAR_SPEED,
      objId: "veh0",
    });
    // [len][cmdId][varId][objLen(4)][objId]
    assert.equal(encoded[0], encoded.length);
    assert.equal(encoded[1], TRACI.CMD_GET_VEHICLE_VARIABLE);
    assert.equal(encoded[2], TRACI.VAR_SPEED);
    const objLen = encoded.readInt32BE(3);
    assert.equal(objLen, 4);
    assert.equal(encoded.subarray(7).toString("utf8"), "veh0");
  });

  it("uses the extended length form above 255 bytes", () => {
    const payload = Buffer.alloc(300, 0xaa);
    const encoded = encodeCommand({ cmdId: 0x02, payload });
    // [0][int32 length][cmdId][300 bytes]; bodyLength = cmdId + lengthByte + payload = 302
    assert.equal(encoded[0], 0);
    assert.equal(encoded.readInt32BE(1), 306);
    assert.equal(encoded[5], 0x02);
    assert.equal(encoded.length, 306);
  });

  it("frames a message with a 4-byte total length prefix", () => {
    const message = encodeMessage([
      { cmdId: TRACI.CMD_GET_VERSION },
      { cmdId: TRACI.CMD_GET_VEHICLE_VARIABLE, varId: TRACI.VAR_SPEED, objId: "v1" },
    ]);
    assert.equal(message.readInt32BE(0), message.length);
  });

  it("encodes typed string payloads", () => {
    const payload = encodeTypedString("GGgrrr");
    assert.equal(payload[0], TRACI.TYPE_STRING);
    assert.equal(payload.readInt32BE(1), 6);
    assert.equal(payload.subarray(5).toString("utf8"), "GGgrrr");
  });

  it("encodes raw doubles without a type marker", () => {
    const payload = encodeRawDouble(12.5);
    assert.equal(payload.length, 8);
    assert.equal(payload.readDoubleBE(0), 12.5);
  });
});

describe("TraCI response parsing", () => {
  function buildStatus(cmdId: number, result: number, description: string): Buffer {
    const desc = Buffer.from(description, "utf8");
    const len = Buffer.alloc(4);
    len.writeInt32BE(desc.length, 0);
    return Buffer.concat([Buffer.from([7, cmdId, result]), len, desc]);
  }

  it("parses an OK status", () => {
    const reader = new TraCIReader(buildStatus(0xa4, 0x00, ""));
    const status = readStatus(reader);
    assert.equal(status.cmdId, 0xa4);
    assert.equal(status.result, 0);
    assert.equal(status.description, "");
  });

  it("throws TraCIError for error statuses", () => {
    const reader = new TraCIReader(buildStatus(0xa4, 0xff, "Unknown vehicle"));
    assert.throws(
      () => readStatus(reader),
      (err: unknown) => err instanceof TraCIError && /Unknown vehicle/.test(err.message),
    );
  });

  it("parses the data command header of a GET response", () => {
    const parts: Buffer[] = [];
    parts.push(Buffer.from([9])); // cmdLength
    parts.push(Buffer.from([0xb4])); // response id = 0xa4 + 0x10
    parts.push(Buffer.from([TRACI.VAR_SPEED]));
    const objLen = Buffer.alloc(4);
    objLen.writeInt32BE(2, 0);
    parts.push(objLen, Buffer.from("v1", "utf8"));
    parts.push(Buffer.from([TRACI.TYPE_DOUBLE]));
    const value = Buffer.alloc(8);
    value.writeDoubleBE(11.5, 0);
    parts.push(value);

    const reader = new TraCIReader(Buffer.concat(parts));
    readGetDataHeader(reader, 0xa4, TRACI.VAR_SPEED, "v1");
    assert.equal(reader.readTypedValue(), 11.5);
  });

  it("rejects a mismatched variable id in the data header", () => {
    const parts: Buffer[] = [];
    parts.push(Buffer.from([9]));
    parts.push(Buffer.from([0xb4]));
    parts.push(Buffer.from([TRACI.VAR_SPEED + 1]));
    const objLen = Buffer.alloc(4);
    objLen.writeInt32BE(0, 0);
    parts.push(objLen);
    assert.throws(() => readGetDataHeader(new TraCIReader(Buffer.concat(parts)), 0xa4, TRACI.VAR_SPEED, ""), FatalTraCIError);
  });

  it("classifies data-bearing commands", () => {
    assert.equal(commandExpectsData(TRACI.CMD_GET_VERSION), true);
    assert.equal(commandExpectsData(TRACI.CMD_SIM_STEP), true);
    assert.equal(commandExpectsData(TRACI.CMD_GET_VEHICLE_VARIABLE), true);
    assert.equal(commandExpectsData(TRACI.CMD_SET_TL_VARIABLE), false);
    assert.equal(commandExpectsData(TRACI.CMD_CLOSE), false);
  });
});
