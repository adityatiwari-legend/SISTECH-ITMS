import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../src/logger.ts";
import { SimulationManager } from "../src/modules/simulation/simulation-manager.ts";
import { harnessConfig } from "./helpers.ts";
import type { AppConfig } from "../src/config.ts";

/**
 * Phase 1 acceptance test (Phases.md 1.6 Test 7):
 * Node.js changes one traffic signal and vehicles react to that change.
 *
 * Procedure: drive a real SUMO simulation until a car is close to
 * intersection I2 on one of its approach lanes, force I2 to all-red, then
 * verify that the vehicle comes to a halt (speed ~ 0) within a few steps.
 */

function testConfig(): AppConfig {
  return harnessConfig({ stepIntervalMs: 0, sumoStartupTimeoutMs: 30_000 });
}

// Internal approach edges feeding I2 are 200 m long (see itms.edg.xml).
const APPROACH_ALERT_DISTANCE_M = 160;

test("vehicles stop when a signal is forced to red", { timeout: 180_000 }, async () => {
  const manager = new SimulationManager({ config: testConfig(), logger: createLogger("test", "error") });
  try {
    await manager.start("baseline", { autoRun: false });

    // Find a car approaching I2 fast enough that it is not yet stopped.
    let target: { id: string; lanePosition: number } | null = null;
    for (let step = 0; step < 400 && target === null; step++) {
      await manager.stepOnce();
      const i2 = manager.getSignal("I2")!;
      const controlledLanes = new Set(i2.controlledLanes);
      for (const vehicle of manager.getVehicles()) {
        if (!controlledLanes.has(vehicle.laneId)) continue;
        if (vehicle.lanePosition < APPROACH_ALERT_DISTANCE_M) continue;
        if (vehicle.speed <= 1) continue;
        target = { id: vehicle.id, lanePosition: vehicle.lanePosition };
        break;
      }
    }
    assert.ok(target !== null, "no vehicle approached I2 within 400 steps; scenario too sparse");

    const vehicleBefore = manager.getVehicles().find((v) => v.id === target!.id)!;
    assert.ok(vehicleBefore.speed > 1, `vehicle should be moving before the signal change (speed=${vehicleBefore.speed})`);

    // Force all approaches of I2 to red.
    const i2 = manager.getSignal("I2")!;
    const allRed = "r".repeat(i2.state.length);
    const updated = await manager.setSignalState("I2", allRed);
    assert.equal(updated.state, allRed);

    // The vehicle must come to a standstill within a few steps.
    let stopped = false;
    let finalSpeed = -1;
    for (let step = 0; step < 6 && !stopped; step++) {
      await manager.stepOnce();
      const vehicle = manager.getVehicles().find((v) => v.id === target!.id);
      if (vehicle === undefined) {
        assert.fail("vehicle disappeared after the signal was forced to red");
      }
      finalSpeed = vehicle.speed;
      if (vehicle.speed < 0.5) {
        stopped = true;
      }
    }
    assert.ok(stopped, `vehicle did not stop after the signal change (last speed=${finalSpeed} m/s)`);
  } finally {
    await manager.stop();
  }
});
