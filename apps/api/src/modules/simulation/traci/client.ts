import net from "node:net";
import { TRACI } from "./constants.ts";
import { TraCIError, FatalTraCIError } from "./errors.ts";
import { TraCIReader, type TraciValue } from "./reader.ts";
import {
  encodeCompoundHeader,
  encodeMessage,
  encodeRawDouble,
  encodeTypedInt32,
  encodeTypedString,
  encodeTypedStringList,
  readGetDataHeader,
  readResponseCommandLength,
  readStatus,
  type TraciCommand,
} from "./codec.ts";

export interface TraCIVersionInfo {
  apiVersion: number;
  sumoVersion: string;
}

interface PendingWaiter {
  resolve: (message: Buffer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface BatchEntry {
  cmd: TraciCommand;
  parse: (reader: TraCIReader) => unknown;
}

/**
 * TraCI client over TCP (default SUMO remote port protocol).
 *
 * Implements the message framing and the command/response structure of the
 * TraCI protocol as used by the reference client for SUMO 1.27.1:
 * - messages are framed with a 4-byte big-endian total length,
 * - every response command starts with a status block,
 * - GET commands are answered by a data command (id = get id + 0x10).
 *
 * Requests are serialized: TraCI is a lock-step protocol, and interleaving
 * commands would corrupt the response stream.
 */
export class TraCIConnection {
  private socket: net.Socket | null;
  private rx: Buffer = Buffer.alloc(0);
  private expectedMessageLength: number | null = null;
  private waiter: PendingWaiter | null = null;
  private requestChain: Promise<unknown> = Promise.resolve();
  private closed = false;
  private apiVersionValue = 0;
  private sumoVersionValue = "";
  private closedListeners = new Set<(reason: string) => void>();

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (err: Error) => this.onConnectionFailure(`TraCI socket error: ${err.message}`));
    socket.on("close", () => this.onConnectionFailure("TraCI socket closed by SUMO"));
  }

  /** Registers a listener invoked once when the connection fails or closes. */
  onClosed(listener: (reason: string) => void): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }

  /** Connects to a SUMO TraCI server and performs the version handshake. */
  static async connect(
    host: string,
    port: number,
    options: { timeoutMs: number },
  ): Promise<TraCIConnection> {
    const socket = await TraCIConnection.openSocket(host, port, options.timeoutMs);
    const connection = new TraCIConnection(socket);
    try {
      const version = await connection.getVersion();
      connection.apiVersionValue = version.apiVersion;
      connection.sumoVersionValue = version.sumoVersion;
    } catch (err) {
      socket.destroy();
      throw err;
    }
    return connection;
  }

  private static async openSocket(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<net.Socket> {
    return new Promise<net.Socket>((resolve, reject) => {
      const socket = net.connect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new FatalTraCIError(`Timed out connecting to TraCI server at ${host}:${port}`));
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new FatalTraCIError(`Could not connect to TraCI server at ${host}:${port}: ${err.message}`));
      });
    });
  }

  get apiVersion(): number {
    return this.apiVersionValue;
  }

  get sumoVersion(): string {
    return this.sumoVersionValue;
  }

  get isConnected(): boolean {
    return !this.closed && this.socket !== null && !this.socket.destroyed;
  }

  private onData(chunk: Buffer): void {
    this.rx = this.rx.length === 0 ? chunk : Buffer.concat([this.rx, chunk]);
    this.deliverIfComplete();
  }

  private deliverIfComplete(): void {
    while (this.waiter !== null) {
      if (this.expectedMessageLength === null) {
        if (this.rx.length < 4) return;
        this.expectedMessageLength = this.rx.readInt32BE(0);
        if (this.expectedMessageLength < 4) {
          this.failPending(new FatalTraCIError(`Invalid TraCI message length ${this.expectedMessageLength}`));
          return;
        }
      }
      // The length prefix includes itself, so the whole message must be buffered.
      if (this.rx.length < this.expectedMessageLength) return;
      const message = this.rx.subarray(0, this.expectedMessageLength);
      this.rx = this.rx.subarray(this.expectedMessageLength);
      this.expectedMessageLength = null;

      const waiter = this.waiter;
      this.waiter = null;
      clearTimeout(waiter.timer);
      // Strip the 4-byte length prefix; the body is handed to the parser.
      waiter.resolve(message.subarray(4));
    }
  }

  private failPending(error: Error): void {
    if (this.waiter !== null) {
      const waiter = this.waiter;
      this.waiter = null;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.destroy();
  }

  private onConnectionFailure(message: string): void {
    if (this.waiter !== null) {
      this.failPending(new FatalTraCIError(message));
      return;
    }
    // No pending request: remember the socket is unusable.
    const wasOpen = !this.closed;
    this.destroy();
    if (wasOpen) {
      for (const listener of [...this.closedListeners]) {
        try {
          listener(message);
        } catch {
          // Listener errors must not affect the connection state machine.
        }
      }
    }
  }

  private async writeAll(message: Buffer): Promise<void> {
    const socket = this.socket;
    if (socket === null || socket.destroyed) {
      throw new FatalTraCIError("TraCI connection is closed.");
    }
    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(new FatalTraCIError(`TraCI write failed: ${err.message}`));
      socket.once("error", onError);
      socket.write(message, (err) => {
        socket.off("error", onError);
        if (err) reject(new FatalTraCIError(`TraCI write failed: ${err.message}`));
        else resolve();
      });
    });
  }

  /** Awaits one complete response message with a timeout. */
  private receive(timeoutMs: number): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        this.destroy();
        reject(new FatalTraCIError(`Timed out after ${timeoutMs}ms waiting for TraCI response`));
      }, timeoutMs);
      this.waiter = { resolve, reject, timer };
      // A complete message may already be buffered.
      this.deliverIfComplete();
    });
  }
  /**
   * Sends commands as ONE message and parses the responses in order.
   * Each entry pairs the command with a parser for the bytes that follow its
   * status block. Returns one result per entry, in order.
   */
  private async requestBatch(entries: Array<{ cmd: TraciCommand; parse?: (reader: TraCIReader) => unknown }>): Promise<unknown[]> {
    if (this.closed || this.socket === null) {
      throw new FatalTraCIError("TraCI connection is closed.");
    }
    const run = this.requestChain.then(async () => {
      const message = encodeMessage(entries.map((entry) => entry.cmd));
      await this.writeAll(message);
      const response = await this.receive(this.requestTimeoutMs);
      const reader = new TraCIReader(response);
      const results: unknown[] = [];
      for (const entry of entries) {
        const status = readStatus(reader);
        if (status.cmdId !== entry.cmd.cmdId) {
          throw new FatalTraCIError(
            `Received answer for command 0x${status.cmdId.toString(16)} while awaiting 0x${entry.cmd.cmdId.toString(16)}`,
          );
        }
        if (entry.parse) {
          results.push(entry.parse(reader));
        }
      }
      return results;
    });
    this.requestChain = run.catch(() => undefined);
    return run as Promise<unknown[]>;
  }

  private requestTimeoutMs = 10_000;

  /** Single-command convenience wrapper around requestBatch. */
  private async request<T>(cmd: TraciCommand, parse?: (reader: TraCIReader) => T): Promise<T> {
    const results = await this.requestBatch([{ cmd, parse: parse as ((reader: TraCIReader) => unknown) | undefined }]);
    return results[0] as T;
  }

  /**
   * Runs a list of domain GET variable requests as ONE TraCI message and
   * returns the typed values in order. All requests must share the
   * "variable command" shape (getCmdId + varId + objId).
   */
  async getValues(
    requests: Array<{ getCmdId: number; varId: number; objId: string }>,
  ): Promise<TraciValue[]> {
    const entries = requests.map((request) => ({
      cmd: { cmdId: request.getCmdId, varId: request.varId, objId: request.objId } satisfies TraciCommand,
      parse: this.makeGetParser(request.getCmdId, request.varId, request.objId),
    }));
    const results = await this.requestBatch(entries);
    return results as TraciValue[];
  }

  // ------------------------------------------------------------------
  // Response parsers for the different command shapes
  // ------------------------------------------------------------------

  private parseVersionData(reader: TraCIReader): TraCIVersionInfo {
    const cmdLength = readResponseCommandLength(reader);
    const responseId = reader.readUByte();
    if (responseId !== TRACI.CMD_GET_VERSION) {
      throw new FatalTraCIError(`Unexpected version response id 0x${responseId.toString(16)}`);
    }
    if (cmdLength < 2) {
      throw new FatalTraCIError(`Malformed version response (cmdLength=${cmdLength})`);
    }
    const apiVersion = reader.readInt32();
    const sumoVersion = reader.readString();
    return { apiVersion, sumoVersion };
  }

  private parseSimStepResponse(reader: TraCIReader): void {
    // No subscriptions are used: the step answer must not contain any.
    const subscriptionCount = reader.readInt32();
    if (subscriptionCount !== 0) {
      throw new FatalTraCIError(
        `Unexpected ${subscriptionCount} subscription result(s) in step response`,
      );
    }
  }

  /** Parses a domain GET payload: data header followed by one typed value. */
  private makeGetParser(
    getCmdId: number,
    varId: number,
    objId: string,
  ): (reader: TraCIReader) => TraciValue {
    return (reader: TraCIReader) => {
      readGetDataHeader(reader, getCmdId, varId, objId);
      return reader.readTypedValue();
    };
  }

  // ------------------------------------------------------------------
  // Generic domain helpers
  // ------------------------------------------------------------------

  private async getVariable(
    getCmdId: number,
    varId: number,
    objId: string,
  ): Promise<TraciValue> {
    return this.request(
      { cmdId: getCmdId, varId, objId },
      this.makeGetParser(getCmdId, varId, objId),
    );
  }

  // ------------------------------------------------------------------
  // Version / lifecycle
  // ------------------------------------------------------------------

  async getVersion(): Promise<TraCIVersionInfo> {
    return this.request({ cmdId: TRACI.CMD_GET_VERSION }, (reader) => this.parseVersionData(reader));
  }

  /** Advances the simulation to `targetTimeSeconds` (absolute sim time). */
  async step(targetTimeSeconds: number): Promise<void> {
    await this.request(
      { cmdId: TRACI.CMD_SIM_STEP, payload: encodeRawDouble(targetTimeSeconds) },
      (reader) => {
        this.parseSimStepResponse(reader);
      },
    );
  }

  /** Requests SUMO to shut down and closes the TCP connection. */
  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request({ cmdId: TRACI.CMD_CLOSE });
    } catch {
      // SUMO may already be gone; closing is best-effort.
    } finally {
      this.destroy();
    }
  }

  destroy(): void {
    this.closed = true;
    if (this.socket !== null) {
      const socket = this.socket;
      this.socket = null;
      socket.destroy();
    }
  }

  // ------------------------------------------------------------------
  // Simulation domain
  // ------------------------------------------------------------------

  async getTime(): Promise<number> {
    return this.expectNumber(await this.getVariable(TRACI.CMD_GET_SIM_VARIABLE, TRACI.VAR_TIME, ""));
  }

  async getDeltaT(): Promise<number> {
    return this.expectNumber(await this.getVariable(TRACI.CMD_GET_SIM_VARIABLE, TRACI.VAR_DELTA_T, ""));
  }

  async getLoadedVehicleCount(): Promise<number> {
    return this.expectNumber(await this.getVariable(TRACI.CMD_GET_SIM_VARIABLE, TRACI.VAR_LOADED_VEHICLES_NUMBER, ""));
  }

  async getDepartedVehicleCount(): Promise<number> {
    return this.expectNumber(await this.getVariable(TRACI.CMD_GET_SIM_VARIABLE, TRACI.VAR_DEPARTED_VEHICLES_NUMBER, ""));
  }

  async getArrivedVehicleCount(): Promise<number> {
    return this.expectNumber(await this.getVariable(TRACI.CMD_GET_SIM_VARIABLE, TRACI.VAR_ARRIVED_VEHICLES_NUMBER, ""));
  }

  /** IDs of vehicles that finished their route in the last step. */
  async getArrivedVehicleIds(): Promise<string[]> {
    return this.expectStringList(
      await this.getVariable(TRACI.CMD_GET_SIM_VARIABLE, TRACI.VAR_ARRIVED_VEHICLES_IDS, ""),
    );
  }

  /** IDs of vehicles waiting for insertion (depart blocked). */
  async getPendingVehicleIds(): Promise<string[]> {
    return this.expectStringList(
      await this.getVariable(TRACI.CMD_GET_SIM_VARIABLE, TRACI.VAR_PENDING_VEHICLES, ""),
    );
  }

  async getMinExpectedVehicleCount(): Promise<number> {
    return this.expectNumber(await this.getVariable(TRACI.CMD_GET_SIM_VARIABLE, TRACI.VAR_MIN_EXPECTED_VEHICLES, ""));
  }

  // ------------------------------------------------------------------
  // Vehicle domain
  // ------------------------------------------------------------------

  async getVehicleIds(): Promise<string[]> {
    return this.expectStringList(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.TRACI_ID_LIST, ""),
    );
  }

  async getVehicleCount(): Promise<number> {
    return this.expectNumber(await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.ID_COUNT, ""));
  }

  async getVehiclePosition(vehicleId: string): Promise<{ x: number; y: number }> {
    return this.expectPoint(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_POSITION, vehicleId),
    );
  }

  async getVehicleSpeed(vehicleId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_SPEED, vehicleId),
    );
  }

  async getVehicleRoadId(vehicleId: string): Promise<string> {
    return this.expectString(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_ROAD_ID, vehicleId),
    );
  }

  async getVehicleLaneId(vehicleId: string): Promise<string> {
    return this.expectString(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_LANE_ID, vehicleId),
    );
  }

  async getVehicleLanePosition(vehicleId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_LANEPOSITION, vehicleId),
    );
  }

  async getVehicleTypeId(vehicleId: string): Promise<string> {
    return this.expectString(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_TYPE, vehicleId),
    );
  }

  // ------------------------------------------------------------------
  // Traffic light domain
  // ------------------------------------------------------------------

  async getTrafficLightIds(): Promise<string[]> {
    return this.expectStringList(
      await this.getVariable(TRACI.CMD_GET_TL_VARIABLE, TRACI.TRACI_ID_LIST, ""),
    );
  }

  async getRedYellowGreenState(tlsId: string): Promise<string> {
    return this.expectString(
      await this.getVariable(TRACI.CMD_GET_TL_VARIABLE, TRACI.TL_RED_YELLOW_GREEN_STATE, tlsId),
    );
  }

  async getPhaseIndex(tlsId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_TL_VARIABLE, TRACI.TL_CURRENT_PHASE, tlsId),
    );
  }

  async getPhaseDuration(tlsId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_TL_VARIABLE, TRACI.TL_PHASE_DURATION, tlsId),
    );
  }

  async getNextSwitchTime(tlsId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_TL_VARIABLE, TRACI.TL_NEXT_SWITCH, tlsId),
    );
  }

  async getCurrentProgram(tlsId: string): Promise<string> {
    return this.expectString(
      await this.getVariable(TRACI.CMD_GET_TL_VARIABLE, TRACI.TL_CURRENT_PROGRAM, tlsId),
    );
  }

  async getControlledLanes(tlsId: string): Promise<string[]> {
    return this.expectStringList(
      await this.getVariable(TRACI.CMD_GET_TL_VARIABLE, TRACI.TL_CONTROLLED_LANES, tlsId),
    );
  }

  /** Sets the full red/yellow/green state string for a traffic light. */
  async setRedYellowGreenState(tlsId: string, state: string): Promise<void> {
    await this.request({
      cmdId: TRACI.CMD_SET_TL_VARIABLE,
      varId: TRACI.TL_RED_YELLOW_GREEN_STATE,
      objId: tlsId,
      payload: encodeTypedString(state),
    });
  }

  /**
   * Switches the traffic light to the named (previously loaded) program and
   * resumes its schedule. Used to restore normal operation after a
   * corridor's temporary RYG override.
   */
  async setProgram(tlsId: string, programId: string): Promise<void> {
    await this.request({
      cmdId: TRACI.CMD_SET_TL_VARIABLE,
      varId: TRACI.TL_PROGRAM,
      objId: tlsId,
      payload: encodeTypedString(programId),
    });
  }

  // ------------------------------------------------------------------
  // Route domain
  // ------------------------------------------------------------------

  /** Adds (or replaces) a named route consisting of the given edges. */
  async addRoute(routeId: string, edges: string[]): Promise<void> {
    if (edges.length === 0) {
      throw new TraCIError("Cannot add an empty route");
    }
    await this.request({
      cmdId: TRACI.CMD_SET_ROUTE_VARIABLE,
      varId: TRACI.ROUTE_ADD,
      objId: routeId,
      payload: encodeTypedStringList(edges),
    });
  }

  async getRouteEdges(routeId: string): Promise<string[]> {
    return this.expectStringList(
      await this.getVariable(TRACI.CMD_GET_ROUTE_VARIABLE, TRACI.VAR_EDGES, routeId),
    );
  }

  // ------------------------------------------------------------------
  // Vehicle lifecycle (add/remove)
  // ------------------------------------------------------------------

  /**
   * Adds a vehicle with full parameters (ADD_FULL), mirroring the reference
   * client's vehicle.add: compound of 14 members (12 strings + 2 ints).
   * `depart` "now" inserts as soon as possible.
   */
  async addVehicle(params: {
    vehicleId: string;
    routeId: string;
    typeId: string;
    depart?: string;
    departLane?: string;
    departPos?: string;
    departSpeed?: string;
  }): Promise<void> {
    const payload = Buffer.concat([
      encodeCompoundHeader(14),
      encodeTypedString(params.routeId),
      encodeTypedString(params.typeId),
      encodeTypedString(params.depart ?? "now"),
      encodeTypedString(params.departLane ?? "first"),
      encodeTypedString(params.departPos ?? "base"),
      encodeTypedString(params.departSpeed ?? "0"),
      encodeTypedString("current"), // arrivalLane
      encodeTypedString("max"), // arrivalPos
      encodeTypedString("current"), // arrivalSpeed
      encodeTypedString(""), // fromTaz
      encodeTypedString(""), // toTaz
      encodeTypedString(""), // line
      encodeTypedInt32(0), // personCapacity
      encodeTypedInt32(0), // personNumber
    ]);
    await this.request({
      cmdId: TRACI.CMD_SET_VEHICLE_VARIABLE,
      varId: TRACI.ADD_FULL,
      objId: params.vehicleId,
      payload,
    });
  }

  /** Removes a vehicle from the simulation (default: vaporized). */
  async removeVehicle(vehicleId: string, reason = TRACI.REMOVE_VAPORIZED): Promise<void> {
    await this.request({
      cmdId: TRACI.CMD_SET_VEHICLE_VARIABLE,
      varId: TRACI.REMOVE,
      objId: vehicleId,
      payload: Buffer.from([TRACI.TYPE_BYTE, reason]),
    });
  }

  /** Replaces the vehicle's route with a new edge list. */
  async setVehicleRoute(vehicleId: string, edges: string[]): Promise<void> {
    if (edges.length === 0) {
      throw new TraCIError("Cannot set an empty route");
    }
    await this.request({
      cmdId: TRACI.CMD_SET_VEHICLE_VARIABLE,
      varId: TRACI.VAR_ROUTE,
      objId: vehicleId,
      payload: encodeTypedStringList(edges),
    });
  }

  async getVehicleRouteId(vehicleId: string): Promise<string> {
    return this.expectString(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_ROUTE_ID, vehicleId),
    );
  }

  /** Index of the vehicle's current edge within its route (-1 off-route). */
  async getVehicleRouteIndex(vehicleId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_ROUTE_INDEX, vehicleId),
    );
  }

  async getVehicleWaitingTime(vehicleId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_WAITING_TIME, vehicleId),
    );
  }

  /** Accumulated time loss (delay) of a vehicle in seconds (SUMO). */
  async getVehicleTimeLoss(vehicleId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_VEHICLE_VARIABLE, TRACI.VAR_TIMELOSS, vehicleId),
    );
  }

  // ------------------------------------------------------------------
  // Lane domain
  // ------------------------------------------------------------------

  async getLaneVehicleNumber(laneId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_LANE_VARIABLE, TRACI.LAST_STEP_VEHICLE_NUMBER, laneId),
    );
  }

  async getLaneHaltingNumber(laneId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_LANE_VARIABLE, TRACI.LAST_STEP_VEHICLE_HALTING_NUMBER, laneId),
    );
  }

  async getLaneMeanSpeed(laneId: string): Promise<number> {
    return this.expectNumber(
      await this.getVariable(TRACI.CMD_GET_LANE_VARIABLE, TRACI.LAST_STEP_MEAN_SPEED, laneId),
    );
  }

  // ------------------------------------------------------------------
  // Value validation helpers
  // ------------------------------------------------------------------

  private expectNumber(value: TraciValue, context = "value"): number {
    if (typeof value !== "number") {
      throw new TraCIError(`Expected numeric ${context}, received ${typeof value}`);
    }
    return value;
  }

  private expectString(value: TraciValue, context = "value"): string {
    if (typeof value !== "string") {
      throw new TraCIError(`Expected string ${context}, received ${typeof value}`);
    }
    return value;
  }

  private expectStringList(value: TraciValue, context = "value"): string[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new TraCIError(`Expected string list ${context}, received ${typeof value}`);
    }
    return value as string[];
  }

  private expectPoint(value: TraciValue, context = "value"): { x: number; y: number } {
    if (typeof value !== "object" || value === null || !("x" in value) || !("y" in value)) {
      throw new TraCIError(`Expected position ${context}, received ${typeof value}`);
    }
    const point = value as { x: number; y: number };
    if (typeof point.x !== "number" || typeof point.y !== "number") {
      throw new TraCIError(`Expected numeric coordinates ${context}`);
    }
    return point;
  }
}
