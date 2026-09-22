import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../src/logger.ts";
import { AppError } from "../src/errors.ts";
import { SimulationManager } from "../src/modules/simulation/simulation-manager.ts";
import { SCENARIO_PATHS } from "./helpers.ts";
import type { AppConfig } from "../src/config.ts";

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 3000,
    logLevel: "error",
    sumoBinary: process.env.SUMO_BINARY || "sumo",
    scenarioPaths: SCENARIO_PATHS,
    networkPath: process.env.ITMS_NETWORK || "network.net.xml",
    sumoStepLengthSeconds: 1,
    stepIntervalMs: 0,
    sumoConnectTimeoutMs: 5_000,
    sumoStartupTimeoutMs: 30_000,
    databaseUrl: "postgres://invalid@127.0.0.1:1/none",
    trafficPersistEveryTicks: 5,
    trafficEventIntervalMs: 1000,
    trafficStaleAfterSeconds: 5,
    congestionThresholds: {
      mediumOccupancy: 0.15,
      highOccupancy: 0.3,
      criticalOccupancy: 0.45,
      mediumSpeedRatio: 0.6,
      highSpeedRatio: 0.35,
      criticalSpeedRatio: 0.15,
      mediumQueue: 2,
      highQueue: 6,
      criticalQueue: 12,
    },
    ...overrides,
  };
}

function testManager(config: AppConfig = testConfig()): SimulationManager {
  return new SimulationManager({ config, logger: createLogger("test", "error") });
}

async function withManager(
  config: AppConfig | undefined,
  autoRun: boolean,
  fn: (manager: SimulationManager) => Promise<void>,
) {
  const manager = testManager(config);
  try {
    await manager.start("baseline", { autoRun });
    await fn(manager);
  } finally {
    await manager.stop();
  }
}

test("manager starts SUMO and exposes six signals", { timeout: 120_000 }, async () => {
  await withManager(undefined, false, async (manager) => {
    const status = manager.getStatusSnapshot();
    assert.equal(status.status, "running");
    assert.equal(status.scenario, "baseline");
    assert.match(status.sumoVersion ?? "", /^SUMO \d/);
    assert.equal(status.traciApiVersion !== null, true);
    const signals = manager.getSignals();
    assert.equal(signals.length, 6);
    assert.deepEqual(signals.map((s) => s.id).sort(), ["I1", "I2", "I3", "I4", "I5", "I6"]);
    for (const signal of signals) {
      assert.ok(signal.state.length > 0);
      assert.ok(signal.controlledLanes.length > 0);
      assert.ok(signal.queueLength >= 0);
    }
  });
});

test("missing SUMO binary produces a clear startup error", { timeout: 60_000 }, async () => {
  const config = testConfig({
    sumoBinary: "definitely-not-a-real-sumo-binary-xyz",
    sumoStartupTimeoutMs: 10_000,
  });
  const manager = testManager(config);
  await assert.rejects(
    () => manager.start("baseline", { autoRun: false }),
    (err: unknown) => {
      if (err === null || typeof err !== "object") return false;
      const message = (err as Error).message;
      return /not found|Install SUMO|SUMO_BINARY/.test(message);
    },
  );
  const snapshot = manager.getStatusSnapshot();
  assert.equal(snapshot.status, "error");
  assert.match(snapshot.lastError ?? "", /not found|Install SUMO|SUMO_BINARY/);
});

test("stepping advances sim time, vehicles move, snapshots update", { timeout: 120_000 }, async () => {
  await withManager(undefined, false, async (manager) => {
    for (let i = 0; i < 20; i++) {
      await manager.stepOnce();
    }
    const status = manager.getStatusSnapshot();
    assert.ok(status.simTimeSeconds >= 20, `simTime=${status.simTimeSeconds}`);
    assert.ok(status.vehicleCount > 0, "vehicles should be present after 20 steps");

    const vehicles = manager.getVehicles();
    const vehicle = vehicles[0]!;
    assert.ok(vehicle.id.length > 0);
    assert.ok(vehicle.positionX >= 0 && vehicle.positionX <= 600);
    assert.ok(vehicle.positionY >= 0 && vehicle.positionY <= 400);
    assert.ok(vehicle.speed >= 0);
    assert.ok(vehicle.roadId.length > 0);
    assert.ok(vehicle.laneId.length > 0);

    const before = manager.getVehicles();
    const movingVehicle = before.find((v) => v.speed > 2);
    await manager.stepOnce();
    const after = manager.getVehicles();

    if (movingVehicle !== undefined) {
      const beforeById = new Map(before.map((v) => [v.id, v] as const));
      const changed = after.some((v) => {
        const previous = beforeById.get(v.id);
        if (previous === undefined) return true;
        return (
          v.positionX !== previous.positionX ||
          v.positionY !== previous.positionY ||
          v.lanePosition !== previous.lanePosition
        );
      }) || after.length !== before.length;
      assert.ok(changed, "traffic state must change across a step");
      const tracked = after.find((v) => v.id === movingVehicle.id);
      if (tracked !== undefined) {
        assert.ok(
          tracked.positionX !== movingVehicle.positionX ||
            tracked.positionY !== movingVehicle.positionY ||
            tracked.lanePosition !== movingVehicle.lanePosition,
          "a moving vehicle must advance within one step",
        );
      }
    }
  });
});

test("signal queues reflect halted vehicles and update over time", { timeout: 120_000 }, async () => {
  await withManager(undefined, false, async (manager) => {
    for (let i = 0; i < 60; i++) {
      await manager.stepOnce();
    }
    const signals = manager.getSignals();
    const queueSum = signals.reduce((sum, s) => sum + s.queueLength, 0);
    assert.ok(queueSum >= 0);
    // With signalized 2-lane roads and the scenario demand, some queueing
    // must occur somewhere in the network within a minute of traffic.
    assert.ok(queueSum > 0, "expected at least one halted vehicle at a signal within 60 steps");
  });
});

test("setSignalState applies the state and validates input", { timeout: 120_000 }, async () => {
  await withManager(undefined, false, async (manager) => {
    const signal = manager.getSignal("I2")!;
    const allRed = "r".repeat(signal.state.length);

    const updated = await manager.setSignalState("I2", allRed);
    assert.equal(updated.state, allRed);

    await assert.rejects(
      () => manager.setSignalState("I2", "r"),
      (err: unknown) => err instanceof AppError && err.statusCode === 422,
    );
    await assert.rejects(
      () => manager.setSignalState("NOPE", allRed),
      (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
  });
});

test("start while running is rejected; stop is idempotent", { timeout: 120_000 }, async () => {
  const manager = testManager();
  try {
    await manager.start("baseline", { autoRun: false });
    await assert.rejects(
      () => manager.start("emergency"),
      (err: unknown) => err instanceof AppError && err.statusCode === 409,
    );
    await manager.stop();
    await manager.stop();
    assert.equal(manager.getStatusSnapshot().status, "idle");
    assert.equal(manager.getSignals().length, 0);
  } finally {
    await manager.stop();
  }
});

test("stepping after stop is rejected", { timeout: 120_000 }, async () => {
  const manager = testManager();
  await manager.start("baseline", { autoRun: false });
  await manager.stop();
  await assert.rejects(
    () => manager.stepOnce(),
    (err: unknown) => err instanceof AppError && err.statusCode === 409,
  );
});

test("pause halts the paced loop, resume continues it", { timeout: 120_000 }, async () => {
  const config = testConfig({ stepIntervalMs: 25 });
  const manager = testManager(config);
  try {
    await manager.start("baseline", { autoRun: true });
    await new Promise((r) => setTimeout(r, 1_500));
    assert.equal(manager.getStatusSnapshot().status, "running");

    await manager.pause();
    assert.equal(manager.getStatusSnapshot().status, "paused");
    const pausedTime = manager.getStatusSnapshot().simTimeSeconds;
    await new Promise((r) => setTimeout(r, 800));
    const afterPause = manager.getStatusSnapshot().simTimeSeconds;
    assert.equal(afterPause, pausedTime, "sim time must not advance while paused");

    await manager.resume();
    assert.equal(manager.getStatusSnapshot().status, "running");
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(
      manager.getStatusSnapshot().simTimeSeconds > afterPause,
      "sim time must advance after resume",
    );
  } finally {
    await manager.stop();
  }
});

test("emergency scenario exposes the ambulance vehicle type", { timeout: 120_000 }, async () => {
  const manager = testManager();
  try {
    await manager.start("emergency", { autoRun: false });
    for (let i = 0; i < 40; i++) {
      await manager.stepOnce();
      const ambulance = manager.getVehicles().find((v) => v.typeId === "emergency");
      if (ambulance) {
        assert.ok(ambulance.roadId.length > 0);
        return;
      }
    }
    assert.fail("emergency vehicle did not appear within 40 steps");
  } finally {
    await manager.stop();
  }
});
