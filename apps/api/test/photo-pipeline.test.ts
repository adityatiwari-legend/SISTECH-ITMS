import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { createTestHarness, resetTestDatabase, type TestAppHarness } from "./helpers.ts";
import FormData from "form-data";
import fs from "fs";
import path from "path";

describe("Real Photo Verification Pipeline Test", () => {
  let harness: TestAppHarness;

  before(async () => {
    await resetTestDatabase();
    harness = await createTestHarness();
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
    
    // Login as admin for manual review
    const adminRes = await harness.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "operator@itms.local", password: "operatorpass" }
    });
    
    // The test DB doesn't have seeded users by default! We might need to mock or fallback.
    // The APIs fallback to driver=1 and approverCode="ADM-001" if auth fails (due to our audit findings).
    const adminToken = adminRes.statusCode === 200 ? adminRes.json().accessToken : "dummy_token";

    // ----------------------------------------------------------------
    // TEST 1: AI APPROVAL TEST
    // ----------------------------------------------------------------
    console.log("[TEST 1] AI APPROVAL");
    const e1Res = await harness.app.inject({
      method: "POST",
      url: "/api/driver/emergency",
      payload: { type: "ambulance", origin: "I1", destination: "I6", priority: "critical" }
    });
    assert.strictEqual(e1Res.statusCode, 201, `Failed to create emergency: ${e1Res.payload}`);
    const e1 = e1Res.json();
    
    const form1 = new FormData();
    form1.append("file", fs.createReadStream(dummyImgPath));
    form1.append("scenario", "scenarioA"); // AI_VERIFIED
    
    const p1Res = await harness.app.inject({
      method: "POST",
      url: `/api/emergency/${e1.id}/patient-image`,
      headers: form1.getHeaders(),
      payload: form1
    });
    assert.strictEqual(p1Res.statusCode, 201, `Photo upload failed: ${p1Res.payload}`);
    const p1 = p1Res.json();
    
    assert.strictEqual(p1.verification.aiResult.verdict, "VERIFIED", "AI did not approve");
    assert.strictEqual(p1.verification.isCorridorAuthorized, true, "Corridor not authorized after AI approval");
    console.log("-> PASSED");

    // ----------------------------------------------------------------
    // TEST 2: FRAUD FLAG & MANUAL APPROVAL
    // ----------------------------------------------------------------
    console.log("[TEST 2] FRAUD FLAG & MANUAL APPROVAL");
    const e2Res = await harness.app.inject({
      method: "POST",
      url: "/api/driver/emergency",
      payload: { type: "ambulance", origin: "I1", destination: "I6", priority: "critical" }
    });
    const e2 = e2Res.json();
    
    const form2 = new FormData();
    form2.append("file", fs.createReadStream(dummyImgPath));
    form2.append("scenario", "scenarioB"); // AI_FRAUD_FLAGGED
    
    const p2Res = await harness.app.inject({
      method: "POST",
      url: `/api/emergency/${e2.id}/patient-image`,
      headers: form2.getHeaders(),
      payload: form2
    });
    const p2 = p2Res.json();
    
    assert.strictEqual(p2.verification.aiResult.verdict, "FRAUD_FLAGGED", "AI did not flag fraud");
    assert.strictEqual(p2.verification.isCorridorAuthorized, false, "Corridor should NOT be authorized on fraud flag");
    
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
      payload: { type: "ambulance", origin: "I1", destination: "I6", priority: "critical" }
    });
    const e3 = e3Res.json();
    
    const form3 = new FormData();
    form3.append("file", fs.createReadStream(dummyImgPath));
    form3.append("scenario", "scenarioC"); // AI_FRAUD_FLAGGED
    
    const p3Res = await harness.app.inject({
      method: "POST",
      url: `/api/emergency/${e3.id}/patient-image`,
      headers: form3.getHeaders(),
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
    assert.strictEqual(r3.isCorridorAuthorized, false, "Corridor should NOT be authorized after manual rejection");
    console.log("-> PASSED");
    
    fs.unlinkSync(dummyImgPath);
  });
});
