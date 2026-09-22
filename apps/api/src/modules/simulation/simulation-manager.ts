import type {
  SignalSnapshot,
  SimulationScenarioId,
  SimulationStatus,
  SimulationStatusSnapshot,
  VehicleSnapshot,
} from "@itms/types";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import { AppError } from "../../errors.ts";
import { TraCIConnection } from "./traci/client.ts";
import { FatalTraCIError } from "./traci/errors.ts";
import { TRACI } from "./traci/constants.ts";
import type { TraciValue } from "./traci/reader.ts";
import { findFreePort, startSumoProcess, type SumoProcessHandle } from "./sumo-process.ts";

const CONNECT_RETRY_INTERVAL_MS = 500;

/**
 * Owns the lifecycle of the SUMO simulation and the TraCI connection:
 * start/stop the SUMO process, drive the step loop, and keep the latest
 * snapshots of vehicles and traffic signals for the API layer.
 *
 * The manager is the only module allowed to talk to SUMO/TraCI.
 */
export class SimulationManager {
  private readonly config: AppConfig;
  private readonly logger: Logger;

  private status: SimulationStatus = "idle";
  private scenario: SimulationScenarioId | null = null;
  private client: TraCIConnection | null = null;
  private process: SumoProcessHandle | null = null;

  private simTimeSeconds = 0;
  private departedVehicleCount: number | null = null;
  private arrivedVehicleCount: number | null = null;
  private vehicles: VehicleSnapshot[] = [];
  private signals = new Map<string, SignalSnapshot>();
  private signalOrder: string[] = [];
  /** Number of controlled links per signal = length of the RYG state string. */
  private signalLinkCount = new Map<string, number>();

  private startedAtIso: string | null = null;
  private lastError: string | null = null;
  private autoLoopActive = false;
  private lifecycleChain: Promise<unknown> = Promise.resolve();
  private stepInFlight: Promise<void> | null = null;
  private stepListeners = new Set<(event: { simTimeSeconds: number }) => void>();
  private disconnectListeners = new Set<(event: { reason: string }) => void>();
  private startListeners = new Set<
    (event: { scenario: SimulationScenarioId; sumoVersion: string | null }) => void | Promise<void>
  >();
  private stopListeners = new Set<
    (event: { reason: "stopped" | "simulation_ended" | "disconnected" }) => void | Promise<void>
  >();

  constructor(options: { config: AppConfig; logger: Logger }) {
    this.config = options.config;
    this.logger = options.logger;
  }

  // ------------------------------------------------------------------
  // Listener registration (used by the traffic intelligence layer)
  // ------------------------------------------------------------------

  /** Registers a listener invoked after every completed simulation step. */
  onStep(listener: (event: { simTimeSeconds: number }) => void): () => void {
    this.stepListeners.add(listener);
    return () => this.stepListeners.delete(listener);
  }

  /** Registers a listener invoked when SUMO disconnects or ends. */
  onDisconnect(listener: (event: { reason: string }) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  /** Registers a listener invoked after a successful simulation start.
   *  Async listeners are awaited by start(), so the caller can rely on
   *  post-start systems (e.g. traffic collection) being ready. */
  onStarted(
    listener: (event: { scenario: SimulationScenarioId; sumoVersion: string | null }) => void | Promise<void>,
  ): () => void {
    this.startListeners.add(listener);
    return () => this.startListeners.delete(listener);
  }

  /** Registers a listener invoked when the simulation stops for any reason. */
  onStopped(
    listener: (event: { reason: "stopped" | "simulation_ended" | "disconnected" }) => void | Promise<void>,
  ): () => void {
    this.stopListeners.add(listener);
    return () => this.stopListeners.delete(listener);
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  getStatusSnapshot(): SimulationStatusSnapshot {
    return {
      status: this.status,
      scenario: this.scenario,
      simTimeSeconds: round(this.simTimeSeconds),
      stepLengthSeconds: this.config.sumoStepLengthSeconds,
      vehicleCount: this.vehicles.length,
      signalCount: this.signals.size,
      departedVehicleCount: this.departedVehicleCount,
      arrivedVehicleCount: this.arrivedVehicleCount,
      sumoVersion: this.client?.sumoVersion ?? null,
      traciApiVersion: this.client?.apiVersion ?? null,
      startedAtIso: this.startedAtIso,
      lastError: this.lastError,
    };
  }

  getVehicles(): VehicleSnapshot[] {
    return this.vehicles.map((vehicle) => ({ ...vehicle }));
  }

  getSignals(): SignalSnapshot[] {
    return this.signalOrder
      .map((id) => this.signals.get(id))
      .filter((signal): signal is SignalSnapshot => signal !== undefined)
      .map((signal) => ({ ...signal }));
  }

  getSignal(id: string): SignalSnapshot | null {
    const signal = this.signals.get(id);
    return signal ? { ...signal } : null;
  }

  /**
   * Exposes the live TraCI client for read-only domain reads (traffic
   * collector). Null when the simulation is not running. Lifecycle control
   * stays inside the manager; callers must never send lifecycle commands.
   */
  getTraCIClient(): TraCIConnection | null {
    if (this.client === null) return null;
    return this.status === "running" || this.status === "paused" ? this.client : null;
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  /** Starts the SUMO process for a scenario and connects via TraCI. */
  async start(scenario: SimulationScenarioId, options: { autoRun?: boolean } = {}): Promise<SimulationStatusSnapshot> {
    const autoRun = options.autoRun ?? true;
    await this.enqueueLifecycle(async () => {
      if (this.status !== "idle" && this.status !== "error" && this.status !== "completed") {
        throw new AppError(409, "simulation_already_active", `Simulation is ${this.status}; stop it first.`);
      }
      this.lastError = null;
      this.scenario = scenario;
      this.status = "starting";
      this.logger.info("Starting SUMO simulation", { scenario });

      try {
        await this.startWithTimeout(scenario);
        this.status = "running";
        this.startedAtIso = new Date().toISOString();
        this.logger.info("Simulation started", {
          scenario,
          sumoVersion: this.client?.sumoVersion,
          signals: this.signals.size,
        });
        await this.notifyStartListeners(scenario);
        if (autoRun) {
          this.beginAutoLoop();
        }      } catch (err) {
        await this.teardown(true);
        this.status = "error";
        this.lastError = err instanceof Error ? err.message : String(err);
        this.logger.error("Simulation start failed", { scenario, error: this.lastError });
        throw err;
      }
    });
    return this.getStatusSnapshot();
  }

  private async startWithTimeout(scenario: SimulationScenarioId): Promise<void> {
    const startupTimeoutMs = this.config.sumoStartupTimeoutMs;
    await withTimeout(
      this.connectAndInitialize(scenario),
      startupTimeoutMs,
      `SUMO startup timed out after ${startupTimeoutMs}ms`,
    );
  }

  private async connectAndInitialize(scenario: SimulationScenarioId): Promise<void> {
    const port = await findFreePort();
    const configPath = this.config.scenarioPaths[scenario];
    const handle = startSumoProcess({
      binary: this.config.sumoBinary,
      configPath,
      port,
      stepLengthSeconds: this.config.sumoStepLengthSeconds,
    });
    this.process = handle;

    // Surface unexpected SUMO termination at any time. A clean exit (code 0)
    // while running is the simulation reaching its configured end time.
    void handle.exitPromise.then((exit) => {
      if (exit.spawnError) {
        this.handleDisconnect(`SUMO failed to start: ${exit.spawnError}. Install SUMO or set SUMO_BINARY.`);
      } else if (this.status === "running" || this.status === "paused" || this.status === "starting") {
        if (exit.code === 0) {
          this.handleSimulationEnded();
        } else {
          const tail = handle.stderrTail().slice(-3).join(" | ");
          this.handleDisconnect(`SUMO process exited unexpectedly (code ${exit.code ?? "?"}). ${tail}`);
        }
      }
    });

    this.client = await this.connectWithRetry(handle, port);
    // Any connection loss (socket error/close, timeouts) becomes a manager
    // disconnect so no signal commands are issued to a dead connection.
    this.client.onClosed((reason) => {
      this.handleDisconnect(`TraCI connection lost: ${reason}`);
    });

    const tlsIds = await this.client.getTrafficLightIds();
    if (tlsIds.length === 0) {
      throw new FatalTraCIError("SUMO network has no traffic lights; the scenario is not usable.");
    }
    this.signalOrder = tlsIds;
    for (const tlsId of tlsIds) {
      const lanes = [...new Set(await this.client.getControlledLanes(tlsId))];
      const state = await this.client.getRedYellowGreenState(tlsId);
      if (lanes.length === 0 || state.length === 0) {
        throw new FatalTraCIError(`Traffic light ${tlsId} has no controlled lanes or state.`);
      }
      this.signalLinkCount.set(tlsId, state.length);
      this.signals.set(tlsId, {
        id: tlsId,
        program: "",
        state,
        phaseIndex: 0,
        phaseDurationSeconds: 0,
        nextSwitchAtSeconds: 0,
        queueLength: 0,
        controlledLanes: lanes,
      });
    }

    this.simTimeSeconds = await this.client.getTime();
    this.departedVehicleCount = await this.client.getDepartedVehicleCount();
    this.arrivedVehicleCount = await this.client.getArrivedVehicleCount();
    await this.collectState();
  }

  private async connectWithRetry(handle: SumoProcessHandle, port: number): Promise<TraCIConnection> {
    const deadline = Date.now() + this.config.sumoStartupTimeoutMs;
    let lastError: Error | null = null;
    while (Date.now() < deadline) {
      if (handle.hasExited()) {
        const spawnFailure = handle.spawnError();
        if (spawnFailure !== null) {
          throw new FatalTraCIError(spawnFailure);
        }
        const tail = handle.stderrTail().slice(-5).join(" | ");
        throw new FatalTraCIError(`SUMO exited before TraCI could connect. ${tail || "(no stderr)"}`);
      }
      try {
        return await TraCIConnection.connect("127.0.0.1", port, {
          timeoutMs: this.config.sumoConnectTimeoutMs,
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(CONNECT_RETRY_INTERVAL_MS);
      }
    }
    throw new FatalTraCIError(
      `Could not connect to SUMO TraCI on port ${port} within ${this.config.sumoStartupTimeoutMs}ms` +
        (lastError ? `: ${lastError.message}` : ""),
    );
  }

  /** Stops the simulation and SUMO. Idempotent when nothing is running. */
  async stop(): Promise<SimulationStatusSnapshot> {
    await this.enqueueLifecycle(async () => {
      if (this.status === "idle") {
        return;
      }
      if (this.status === "stopping") {
        throw new AppError(409, "already_stopping", "Simulation is already stopping.");
      }
      this.logger.info("Stopping simulation", { scenario: this.scenario, simTime: this.simTimeSeconds });
      this.status = "stopping";
      const inFlight = this.stepInFlight;
      if (inFlight !== null) {
        await inFlight.catch(() => undefined);
      }
      await this.notifyStopListeners("stopped");
      await this.teardown(false);
      this.status = "idle";
      this.logger.info("Simulation stopped");
    });
    return this.getStatusSnapshot();
  }

  async pause(): Promise<SimulationStatusSnapshot> {
    this.requireRunning("pause");
    this.status = "paused";
    // Wait out any in-flight step so the sim time is guaranteed frozen when
    // this call returns. Steps dispatched concurrently become no-ops via the
    // paused gate inside stepInternal().
    const inFlight = this.stepInFlight;
    if (inFlight !== null) {
      await inFlight.catch(() => undefined);
    }
    this.logger.info("Simulation paused", { simTime: this.simTimeSeconds });
    return this.getStatusSnapshot();
  }

  async resume(): Promise<SimulationStatusSnapshot> {
    if (this.status !== "paused") {
      throw new AppError(409, "not_paused", `Cannot resume: simulation is ${this.status}.`);
    }
    this.status = "running";
    this.logger.info("Simulation resumed", { simTime: this.simTimeSeconds });
    return this.getStatusSnapshot();
  }

  // ------------------------------------------------------------------
  // Step loop
  // ------------------------------------------------------------------

  private beginAutoLoop(): void {
    if (this.autoLoopActive) return;
    this.autoLoopActive = true;
    void this.autoLoop();
  }

  private async autoLoop(): Promise<void> {
    while (this.autoLoopActive) {
      if (this.status !== "running") {
        await sleep(25);
        continue;
      }
      try {
        await this.stepInternal();
      } catch (err) {
        if (!this.autoLoopActive) break;
        const message = err instanceof Error ? err.message : String(err);
        this.handleDisconnect(`Simulation loop failed: ${message}`);
        break;
      }
      await sleep(this.config.stepIntervalMs);
    }
  }

  /**
   * Performs exactly one simulation step and refreshes snapshots.
   * Public for deterministic tests; the API always uses the paced auto loop.
   */
  async stepOnce(): Promise<void> {
    if (this.status !== "running" && this.status !== "paused") {
      throw new AppError(409, "simulation_not_running", `Cannot step: simulation is ${this.status}.`);
    }
    await this.stepInternal();
  }

  /**
   * Runs one step against SUMO. When the simulation is paused this is a
   * no-op so a step dispatched concurrently with a pause cannot advance the
   * simulation behind the caller's back.
   */
  private async stepInternal(): Promise<void> {
    const run = (async () => {
      if (this.status === "paused") {
        return;
      }
      const client = this.client;
      if (client === null) {
        throw new FatalTraCIError("Not connected to SUMO.");
      }
      const target = this.simTimeSeconds + this.config.sumoStepLengthSeconds;
      await client.step(target);
      this.simTimeSeconds = await client.getTime();
      this.departedVehicleCount = await client.getDepartedVehicleCount();
      this.arrivedVehicleCount = await client.getArrivedVehicleCount();
      await this.collectState();
      // Post-step hooks (traffic collection). A hook failure must not break
      // the step loop; it is logged and skipped.
      await this.notifyStepListeners();
    })();
    this.stepInFlight = run;
    try {
      await run;
    } finally {
      if (this.stepInFlight === run) {
        this.stepInFlight = null;
      }
    }
  }

  private async notifyStepListeners(): Promise<void> {
    if (this.stepListeners.size === 0) return;
    const simTime = this.simTimeSeconds;
    for (const listener of [...this.stepListeners]) {
      try {
        await listener({ simTimeSeconds: simTime });
      } catch (err) {
        this.logger.error("Step listener failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // State collection (SUMO → snapshots)
  // ------------------------------------------------------------------

  /**
   * Reads vehicles, signals and approach-lane queues from SUMO as a small
   * number of batched TraCI requests and refreshes the snapshots.
   */
  private async collectState(): Promise<void> {
    const client = this.client;
    if (client === null) return;

    const vehicleIds = await client.getVehicleIds();
    const tlsIds = this.signalOrder;
    const laneIds = [...new Set(tlsIds.flatMap((id) => this.signals.get(id)?.controlledLanes ?? []))];

    const requests: Array<{ getCmdId: number; varId: number; objId: string }> = [];

    const vehicles: VehicleSnapshot[] = vehicleIds.map((id) => ({
      id,
      typeId: "",
      positionX: 0,
      positionY: 0,
      speed: 0,
      roadId: "",
      laneId: "",
      lanePosition: 0,
    }));
    const vehicleAppliers: Array<(vehicle: VehicleSnapshot, value: TraciValue) => void> = [];
    for (const _id of vehicleIds) {
      vehicleAppliers.push(
        (v, value) => { const p = expectPoint(value); v.positionX = p.x; v.positionY = p.y; },
        (v, value) => { v.speed = expectNumber(value); },
        (v, value) => { v.roadId = expectString(value); },
        (v, value) => { v.laneId = expectString(value); },
        (v, value) => { v.lanePosition = expectNumber(value); },
        (v, value) => { v.typeId = expectString(value); },
      );
      requests.push(
        { getCmdId: TRACI.CMD_GET_VEHICLE_VARIABLE, varId: TRACI.VAR_POSITION, objId: _id },
        { getCmdId: TRACI.CMD_GET_VEHICLE_VARIABLE, varId: TRACI.VAR_SPEED, objId: _id },
        { getCmdId: TRACI.CMD_GET_VEHICLE_VARIABLE, varId: TRACI.VAR_ROAD_ID, objId: _id },
        { getCmdId: TRACI.CMD_GET_VEHICLE_VARIABLE, varId: TRACI.VAR_LANE_ID, objId: _id },
        { getCmdId: TRACI.CMD_GET_VEHICLE_VARIABLE, varId: TRACI.VAR_LANEPOSITION, objId: _id },
        { getCmdId: TRACI.CMD_GET_VEHICLE_VARIABLE, varId: TRACI.VAR_TYPE, objId: _id },
      );
    }

    const signals = tlsIds.map((id) => this.signals.get(id)).filter((s): s is SignalSnapshot => s !== undefined);
    const signalAppliers: Array<(signal: SignalSnapshot, value: TraciValue) => void> = [];
    for (const _id of tlsIds) {
      signalAppliers.push(
        (s, value) => { s.state = expectString(value); },
        (s, value) => { s.phaseIndex = expectNumber(value); },
        (s, value) => { s.phaseDurationSeconds = expectNumber(value); },
        (s, value) => { s.nextSwitchAtSeconds = expectNumber(value); },
        (s, value) => { s.program = expectString(value); },
      );
      requests.push(
        { getCmdId: TRACI.CMD_GET_TL_VARIABLE, varId: TRACI.TL_RED_YELLOW_GREEN_STATE, objId: _id },
        { getCmdId: TRACI.CMD_GET_TL_VARIABLE, varId: TRACI.TL_CURRENT_PHASE, objId: _id },
        { getCmdId: TRACI.CMD_GET_TL_VARIABLE, varId: TRACI.TL_PHASE_DURATION, objId: _id },
        { getCmdId: TRACI.CMD_GET_TL_VARIABLE, varId: TRACI.TL_NEXT_SWITCH, objId: _id },
        { getCmdId: TRACI.CMD_GET_TL_VARIABLE, varId: TRACI.TL_CURRENT_PROGRAM, objId: _id },
      );
    }

    const haltedByLane = new Map<string, number>();
    for (const laneId of laneIds) {
      requests.push({ getCmdId: TRACI.CMD_GET_LANE_VARIABLE, varId: TRACI.LAST_STEP_VEHICLE_HALTING_NUMBER, objId: laneId });
    }

    const values = await client.getValues(requests);

    const signalOffset = vehicleIds.length * 6;
    const laneOffset = signalOffset + tlsIds.length * 5;

    vehicleIds.forEach((_, index) => {
      const vehicle = vehicles[index];
      if (vehicle === undefined) return;
      for (let field = 0; field < 6; field++) {
        const value = values[index * 6 + field];
        const applier = vehicleAppliers[index * 6 + field];
        if (value !== undefined && applier !== undefined) applier(vehicle, value);
      }
    });

    laneIds.forEach((laneId, index) => {
      const value = values[laneOffset + index];
      haltedByLane.set(laneId, typeof value === "number" ? value : 0);
    });

    tlsIds.forEach((_, index) => {
      const signal = signals[index];
      if (signal === undefined) return;
      for (let field = 0; field < 5; field++) {
        const value = values[signalOffset + index * 5 + field];
        const applier = signalAppliers[index * 5 + field];
        if (value !== undefined && applier !== undefined) applier(signal, value);
      }
      signal.queueLength = signal.controlledLanes.reduce((sum, laneId) => sum + (haltedByLane.get(laneId) ?? 0), 0);
    });

    this.vehicles = vehicles;
  }

  // ------------------------------------------------------------------
  // Signal control
  // ------------------------------------------------------------------

  /** Applies a red/yellow/green state to a signal and refreshes its snapshot. */
  async setSignalState(id: string, state: string): Promise<SignalSnapshot> {
    if (this.status !== "running" && this.status !== "paused") {
      throw new AppError(409, "simulation_not_running", `Cannot set signal state: simulation is ${this.status}.`);
    }
    const expectedLength = this.signalLinkCount.get(id);
    if (expectedLength === undefined) {
      throw new AppError(404, "unknown_signal", `Unknown traffic signal "${id}".`);
    }
    if (state.length !== expectedLength) {
      throw new AppError(
        422,
        "invalid_signal_state_length",
        `Signal "${id}" controls ${expectedLength} link(s); state string must have exactly that length.`,
      );
    }
    const client = this.client;
    if (client === null) {
      throw new AppError(409, "simulation_not_running", "Not connected to SUMO.");
    }
    try {
      await client.setRedYellowGreenState(id, state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(502, "sumo_command_failed", `SUMO rejected the signal state: ${message}`);
    }
    // Re-read the applied state so the response reflects SUMO, not the request.
    try {
      const applied = await client.getRedYellowGreenState(id);
      const signal = this.signals.get(id);
      if (signal !== undefined) {
        signal.state = applied;
      }
    } catch (err) {
      this.logger.warn("Could not re-read signal state after set", { signal: id, error: err });
    }
    const snapshot = this.getSignal(id);
    if (snapshot === null) {
      throw new AppError(404, "unknown_signal", `Unknown traffic signal "${id}".`);
    }
    this.logger.info("Signal state set", { signal: id, state: snapshot.state });
    return snapshot;
  }

  // ------------------------------------------------------------------
  // Failure handling / teardown
  // ------------------------------------------------------------------

  private handleDisconnect(message: string): void {
    if (
      this.status === "stopping" ||
      this.status === "idle" ||
      this.status === "completed"
    ) {
      return;
    }
    this.logger.error("SUMO disconnected", { status: this.status, reason: message });
    this.status = "error";
    this.lastError = message;
    this.autoLoopActive = false;
    this.notifyDisconnectListeners(message);
    void (async () => {
      try {
        await this.notifyStopListeners("disconnected");
      } finally {
        await this.teardown(true);
      }
    })();
  }

  /** Simulation reached its configured end time (SUMO exited with code 0). */
  private handleSimulationEnded(): void {
    this.logger.info("Simulation reached its end time", { scenario: this.scenario, simTime: this.simTimeSeconds });
    this.status = "completed";
    this.autoLoopActive = false;
    this.notifyDisconnectListeners("simulation_ended");
    void (async () => {
      try {
        await this.notifyStopListeners("simulation_ended");
      } finally {
        await this.teardown(true);
      }
    })();
  }

  private notifyDisconnectListeners(reason: string): void {
    for (const listener of [...this.disconnectListeners]) {
      try {
        listener({ reason });
      } catch (err) {
        this.logger.warn("Disconnect listener failed", { error: err });
      }
    }
  }

  private async notifyStartListeners(scenario: SimulationScenarioId): Promise<void> {
    for (const listener of [...this.startListeners]) {
      try {
        await listener({ scenario, sumoVersion: this.client?.sumoVersion ?? null });
      } catch (err) {
        this.logger.warn("Start listener failed", { error: err });
      }
    }
  }

  private async notifyStopListeners(
    reason: "stopped" | "simulation_ended" | "disconnected",
  ): Promise<void> {
    for (const listener of [...this.stopListeners]) {
      try {
        await listener({ reason });
      } catch (err) {
        this.logger.warn("Stop listener failed", { error: err });
      }
    }
  }

  /** Closes the TraCI connection and terminates the SUMO process. */
  private async teardown(keepErrorState: boolean): Promise<void> {
    this.autoLoopActive = false;
    const client = this.client;
    this.client = null;
    if (client !== null) {
      client.destroy();
    }
    const process = this.process;
    this.process = null;
    if (process !== null) {
      await process.kill();
    }
    this.vehicles = [];
    this.signals.clear();
    this.signalOrder = [];
    this.signalLinkCount.clear();
    this.simTimeSeconds = 0;
    this.departedVehicleCount = null;
    this.arrivedVehicleCount = null;
    this.startedAtIso = null;
    if (!keepErrorState) {
      this.lastError = null;
    }
    this.scenario = null;
  }

  private requireRunning(action: string): void {
    if (this.status !== "running") {
      throw new AppError(409, "not_running", `Cannot ${action}: simulation is ${this.status}.`);
    }
  }

  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const run = this.lifecycleChain.then(operation);
    this.lifecycleChain = run.catch(() => undefined);
    return run;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function expectNumber(value: TraciValue): number {
  if (typeof value !== "number") {
    throw new FatalTraCIError(`Expected numeric TraCI value, received ${typeof value}`);
  }
  return value;
}

function expectString(value: TraciValue): string {
  if (typeof value !== "string") {
    throw new FatalTraCIError(`Expected string TraCI value, received ${typeof value}`);
  }
  return value;
}

function expectPoint(value: TraciValue): { x: number; y: number } {
  if (typeof value !== "object" || value === null || !("x" in value) || !("y" in value)) {
    throw new FatalTraCIError(`Expected position TraCI value, received ${typeof value}`);
  }
  const point = value as { x: number; y: number };
  if (typeof point.x !== "number" || typeof point.y !== "number") {
    throw new FatalTraCIError("Expected numeric position coordinates");
  }
  return point;
}
