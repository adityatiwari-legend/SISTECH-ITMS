import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { createTestHarness, resetTestDatabase, type TestAppHarness } from "./helpers.ts";
import { AuthService } from "../src/modules/auth/auth-service.ts";
// @ts-ignore
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Real Photo Verification Pipeline Test", () => {
  let harness: TestAppHarness;

  before(async () => {
    await resetTestDatabase();
    harness = await createTestHarness();
    await harness.manager.start("baseline");
  });

  after(async () => {
    await harness.close();
  });

  test("Pipeline flows", async () => {
    // ----------------------------------------------------------------
    // 0. Setup and Auth
    // ----------------------------------------------------------------
    const dummyImgPath = path.join(__dirname, "test-img.jpg");
    fs.writeFileSync(dummyImgPath, Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
    
    const auth = new AuthService({} as any, "sistech-itms-emergency-auth-secret-key-2026");
    const driverRow = await harness.db.query("SELECT id FROM drivers WHERE role = 'driver' LIMIT 1");
    const driverId = driverRow.rows[0]?.id ?? 1;
    const adminRow = await harness.db.query("SELECT id FROM drivers WHERE role = 'admin' LIMIT 1");
    const adminId = adminRow.rows[0]?.id ?? 2;
    const driverToken = auth.createToken({ sub: driverId, code: "DRV-802", role: "driver", email: "driver@sistec.demo" });
    const adminToken = auth.createToken({ sub: adminId, code: "ADM-001", role: "admin", email: "admin@sistec.demo" });
    const driverHeaders = { "Authorization": `Bearer ${driverToken}` };

    // ----------------------------------------------------------------
    // TEST 1: PHOTO CAPTURED -> FLAGGED -> OPERATOR APPROVAL
    // ----------------------------------------------------------------
    console.log("[TEST 1] PHOTO CAPTURED -> FLAGGED -> OPERATOR APPROVAL");
    const e1Res = await harness.app.inject({
      method: "POST",
      url: "/api/driver/emergency",
      headers: driverHeaders,
      payload: { type: "ambulance", priority: "critical", originLat: 23.2599, originLng: 77.4126, destinationHospitalId: 1 }
    });
    assert.strictEqual(e1Res.statusCode, 201, `Failed to create emergency: ${e1Res.payload}`);
    const e1 = e1Res.json();
    
    const form1 = new FormData();
    form1.append("file", fs.createReadStream(dummyImgPath));
    form1.append("scenario", "scenarioA");
    
    const p1Res = await harness.app.inject({
      method: "POST",
      url: `/api/emergency/${e1.id}/patient-image`,
      headers: { ...form1.getHeaders(), ...driverHeaders },
      payload: form1
    });
    assert.strictEqual(p1Res.statusCode, 201, `Photo upload failed: ${p1Res.payload}`);
    const p1 = p1Res.json();
    
    assert.strictEqual(p1.verification.status, "manualReview", "Captured photo must be flagged for manual review");
    assert.strictEqual(p1.verification.isCorridorAuthorized, false, "Corridor must NOT be authorized before operator approval");

    const a1Res = await harness.app.inject({
      method: "POST",
      url: `/api/admin/verifications/${p1.verification.id}/approve`,
      headers: { "Authorization": `Bearer ${adminToken}` },
      payload: { notes: "Operator approved via Webapp" }
    });
    assert.strictEqual(a1Res.statusCode, 200, `Approval failed: ${a1Res.payload}`);
    const a1 = a1Res.json();
    assert.strictEqual(a1.status, "adminApproved");
    assert.strictEqual(a1.isCorridorAuthorized, true, "Corridor must be authorized after operator approval");
    console.log("-> PASSED");

    // ----------------------------------------------------------------
    // TEST 2: PHOTO FLAGGED & MANUAL OVERRIDE APPROVAL
    // ----------------------------------------------------------------
    console.log("[TEST 2] PHOTO FLAGGED & MANUAL OVERRIDE APPROVAL");
    const e2Res = await harness.app.inject({
      method: "POST",
      url: "/api/driver/emergency",
      headers: driverHeaders,
      payload: { type: "ambulance", priority: "critical", originLat: 23.2599, originLng: 77.4126, destinationHospitalId: 1 }
    });
    const e2 = e2Res.json();
    
    const form2 = new FormData();
    form2.append("file", fs.createReadStream(dummyImgPath));
    form2.append("scenario", "scenarioB");
    
    const p2Res = await harness.app.inject({
      method: "POST",
      url: `/api/emergency/${e2.id}/patient-image`,
      headers: { ...form2.getHeaders(), ...driverHeaders },
      payload: form2
    });
    const p2 = p2Res.json();
    
    assert.strictEqual(p2.verification.status, "manualReview", "Captured photo must be flagged for manual review");
    assert.strictEqual(p2.verification.isCorridorAuthorized, false, "Corridor should NOT be authorized before approval");
    
    const a2Res = await harness.app.inject({
      method: "POST",
      url: `/api/admin/verifications/${p2.verification.id}/approve`,
      headers: { "Authorization": `Bearer ${adminToken}` },
      payload: { notes: "Overridden" }
    });
    const a2 = a2Res.json();
    
    assert.strictEqual(a2.status, "adminApproved", "Manual approval status mismatch");
    assert.strictEqual(a2.isCorridorAuthorized, true, "Corridor not authorized after manual approval");
    console.log("-> PASSED");

    // ----------------------------------------------------------------
    // TEST 3: FRAUD FLAG & MANUAL REJECTION
    // ----------------------------------------------------------------
    console.log("[TEST 3] FRAUD FLAG & MANUAL REJECTION");
    const e3Res = await harness.app.inject({
      method: "POST",
      url: "/api/driver/emergency",
      headers: driverHeaders,
      payload: { type: "ambulance", priority: "critical", originLat: 23.2599, originLng: 77.4126, destinationHospitalId: 1 }
    });
    const e3 = e3Res.json();
    
    const form3 = new FormData();
    form3.append("file", fs.createReadStream(dummyImgPath));
    form3.append("scenario", "scenarioC"); // AI_FRAUD_FLAGGED
    
    const p3Res = await harness.app.inject({
      method: "POST",
      url: `/api/emergency/${e3.id}/patient-image`,
      headers: { ...form3.getHeaders(), ...driverHeaders },
      payload: form3
    });
    const p3 = p3Res.json();
    
    const r3Res = await harness.app.inject({
      method: "POST",
      url: `/api/admin/verifications/${p3.verification.id}/reject`,
      headers: { "Authorization": `Bearer ${adminToken}` },
      payload: { reason: "Confirmed non-emergency" }
    });
    const r3 = r3Res.json();
    
    assert.strictEqual(r3.status, "adminRejected", "Manual rejection status mismatch");
    assert.strictEqual(r3.isCorridorAuthorized, false, "Corridor authorized despite rejection");
    console.log("-> PASSED");

    // Clean up
    if (fs.existsSync(dummyImgPath)) {
      fs.unlinkSync(dummyImgPath);
    }
  });
});
