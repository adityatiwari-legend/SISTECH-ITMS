import { test } from "node:test";
import assert from "node:assert/strict";
import { startSumoSession, stepUntil, type SumoSession } from "./helpers.ts";
import { TraCIError } from "../src/modules/simulation/traci/errors.ts";

/**
 * Phase 1 integration tests against a real SUMO process (TraCI over TCP).
 * These cover Phases.md 1.6 tests 1-6 at the protocol level; the
 * "vehicles react to a signal change" test lives in
 * vehicle-reaction.integration.test.ts.
 */

async function withSession(scenario: "baseline" | "emergency", fn: (session: SumoSession) => Promise<void>) {
  const session = await startSumoSession(scenario, { endSeconds: 600 });
  try {
    await fn(session);
  } finally {
    await session.close();
  }
}

test("TraCI client connects and performs the version handshake", { timeout: 90_000 }, async () => {
  await withSession("baseline", async (session) => {
    assert.ok(session.client.isConnected);
    assert.ok(session.client.apiVersion >= 20, `apiVersion=${session.client.apiVersion}`);
    assert.match(session.client.sumoVersion, /^SUMO \d+\.\d+/);
  });
});

test("network exposes six signalized intersections", { timeout: 90_000 }, async () => {
  await withSession("baseline", async (session) => {
    const tlsIds = await session.client.getTrafficLightIds();
    assert.deepEqual([...tlsIds].sort(), ["I1", "I2", "I3", "I4", "I5", "I6"]);
    for (const id of tlsIds) {
      const state = await session.client.getRedYellowGreenState(id);
      assert.ok(state.length > 0, `${id} state length`);
      const phase = await session.client.getPhaseIndex(id);
      assert.ok(Number.isInteger(phase), `${id} phase index`);
      const nextSwitch = await session.client.getNextSwitchTime(id);
      assert.ok(nextSwitch > 0, `${id} next switch time`);
      const lanes = await session.client.getControlledLanes(id);
      assert.ok(lanes.length > 0, `${id} controlled lanes`);
    }
  });
});

test("vehicles exist, move, and report speed and position", { timeout: 90_000 }, async () => {
  await withSession("baseline", async (session) => {
    const client = session.client;
    const moved = await stepUntil(client, async () => {
      const ids = await client.getVehicleIds();
      return ids.length > 0;
    }, 60);
    assert.ok(moved, "vehicles should depart within 60 simulated seconds");

    const ids = await client.getVehicleIds();
    const vehicleId = ids[0]!;
    const first = await client.getVehiclePosition(vehicleId);
    let second = first;
    const advanced = await stepUntil(client, async () => {
      second = await client.getVehiclePosition(vehicleId);
      return Math.abs(second.x - first.x) > 0.01 || Math.abs(second.y - first.y) > 0.01;
    }, 10);
    assert.ok(advanced, "vehicle position must change between steps");

    const speed = await client.getVehicleSpeed(vehicleId);
    assert.ok(Number.isFinite(speed) && speed >= 0, `speed=${speed}`);
    const road = await client.getVehicleRoadId(vehicleId);
    const lane = await client.getVehicleLaneId(vehicleId);
    assert.ok(road.length > 0);
    assert.ok(lane.startsWith(road), `lane "${lane}" should belong to road "${road}"`);
    const lanePosition = await client.getVehicleLanePosition(vehicleId);
    assert.ok(Number.isFinite(lanePosition) && lanePosition >= 0);
  });
});

test("lane domain reports vehicle and halting counts", { timeout: 90_000 }, async () => {
  await withSession("baseline", async (session) => {
    const client = session.client;
    const moved = await stepUntil(client, async () => (await client.getVehicleIds()).length > 0, 60);
    assert.ok(moved);
    const lanes = await client.getControlledLanes("I2");
    const vehicleNumber = await client.getLaneVehicleNumber(lanes[0]!);
    const haltingNumber = await client.getLaneHaltingNumber(lanes[0]!);
    assert.ok(Number.isInteger(vehicleNumber) && vehicleNumber >= 0);
    assert.ok(Number.isInteger(haltingNumber) && haltingNumber >= 0);
  });
});

test("setting a signal state applies it in SUMO", { timeout: 90_000 }, async () => {
  await withSession("baseline", async (session) => {
    const client = session.client;
    const before = await client.getRedYellowGreenState("I2");
    assert.ok(before.length >= 8);
    const allRed = "r".repeat(before.length);
    await client.setRedYellowGreenState("I2", allRed);
    const after = await client.getRedYellowGreenState("I2");
    assert.equal(after, allRed);
  });
});

test("commands for unknown objects surface a TraCI error", { timeout: 90_000 }, async () => {
  await withSession("baseline", async (session) => {
    await assert.rejects(
      () => session.client.getVehicleSpeed("no_such_vehicle"),
      (err: unknown) => err instanceof TraCIError,
    );
  });
});

test("closing the TraCI connection terminates SUMO", { timeout: 90_000 }, async () => {
  const session = await startSumoSession("baseline", { endSeconds: 600 });
  await session.client.close();
  const exit = await Promise.race([
    session.process.exitPromise,
    new Promise<{ code: number | null }>((resolve) => setTimeout(() => resolve({ code: -999 }), 15_000)),
  ]);
  assert.notEqual(exit.code, -999, "SUMO did not exit within 15s after TraCI close");
  assert.equal(exit.code, 0, `SUMO should exit cleanly, got code ${exit.code}`);
  await session.process.kill();
});
