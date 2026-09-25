import FormData from "form-data";
import fs from "fs";
import path from "path";

const BASE_URL = "http://127.0.0.1:3000";

async function runTest() {
  console.log("========================================");
  console.log("STARTING REAL PHOTO VERIFICATION TEST");
  console.log("========================================");
  
  // Login as admin for manual review
  console.log("\nLogging in as admin...");
  const adminRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "operator@itms.local", password: "operatorpass" })
  });
  const adminData = await adminRes.json();
  const adminToken = adminRes.ok ? adminData.accessToken : null;
  
  if (!adminToken) {
    console.warn("Could not login as admin. Continuing anyway (relying on API fallbacks where possible)...");
  }

  // Create a dummy image
  const dummyImgPath = path.join(__dirname, "test-img.jpg");
  fs.writeFileSync(dummyImgPath, Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));

  try {
    // ----------------------------------------------------
    // TEST 1: AI APPROVAL TEST
    // ----------------------------------------------------
    console.log("\n[TEST 1] AI APPROVAL PIPELINE");
    
    // 1. Create emergency
    const e1Res = await fetch(`${BASE_URL}/api/driver/emergency`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ambulance", origin: "I1", destination: "I6", priority: "critical" })
    });
    if (!e1Res.ok) throw new Error(`Create emergency failed: ${await e1Res.text()}`);
    const e1 = await e1Res.json();
    console.log(`✓ Emergency created: ID ${e1.id}`);

    // 2. Upload photo (multipart)
    const form1 = new FormData();
    form1.append("file", fs.createReadStream(dummyImgPath));
    form1.append("scenario", "scenarioA"); // VERIFIED
    
    const p1Res = await fetch(`${BASE_URL}/api/emergency/${e1.id}/patient-image`, {
      method: "POST",
      body: form1 as any
    });
    if (!p1Res.ok) throw new Error(`Photo upload failed: ${await p1Res.text()}`);
    const p1 = await p1Res.json();
    console.log(`✓ Photo uploaded successfully (evidence ID: ${p1.evidenceId})`);
    
    // 3. Check AI verdict
    if (p1.verification.aiResult?.verdict !== "VERIFIED") {
      throw new Error(`Expected VERIFIED, got ${p1.verification.aiResult?.verdict}`);
    }
    console.log(`✓ AI Result: VERIFIED`);
    console.log(`✓ Corridor Authorized: ${p1.verification.isCorridorAuthorized}`);
    
    // ----------------------------------------------------
    // TEST 2: FRAUD FLAG & MANUAL APPROVAL
    // ----------------------------------------------------
    console.log("\n[TEST 2] FRAUD FLAG & MANUAL APPROVAL PIPELINE");
    
    // 1. Create emergency
    const e2Res = await fetch(`${BASE_URL}/api/driver/emergency`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ambulance", origin: "I1", destination: "I6", priority: "critical" })
    });
    const e2 = await e2Res.json();
    console.log(`✓ Emergency created: ID ${e2.id}`);

    // 2. Upload photo (multipart) - Scenario B triggers fraud
    const form2 = new FormData();
    form2.append("file", fs.createReadStream(dummyImgPath));
    form2.append("scenario", "scenarioB"); // FRAUD
    
    const p2Res = await fetch(`${BASE_URL}/api/emergency/${e2.id}/patient-image`, {
      method: "POST",
      body: form2 as any
    });
    const p2 = await p2Res.json();
    console.log(`✓ Photo uploaded successfully (evidence ID: ${p2.evidenceId})`);
    
    // 3. Check AI verdict
    if (p2.verification.aiResult?.verdict !== "FRAUD_FLAGGED") {
      throw new Error(`Expected FRAUD_FLAGGED, got ${p2.verification.aiResult?.verdict}`);
    }
    console.log(`✓ AI Result: FRAUD_FLAGGED`);
    console.log(`✓ Corridor Authorized: ${p2.verification.isCorridorAuthorized}`);
    
    // 4. Manual Approve
    const a2Res = await fetch(`${BASE_URL}/api/admin/verifications/${p2.verification.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ notes: "Overridden" })
    });
    const a2 = await a2Res.json();
    if (a2.status !== "adminApproved" || !a2.isCorridorAuthorized) {
      throw new Error(`Manual approval failed or corridor not authorized. Status: ${a2.status}`);
    }
    console.log(`✓ Manual Approve Successful (Corridor Authorized: ${a2.isCorridorAuthorized})`);
    
    // ----------------------------------------------------
    // TEST 3: FRAUD FLAG & MANUAL REJECTION
    // ----------------------------------------------------
    console.log("\n[TEST 3] FRAUD FLAG & MANUAL REJECTION PIPELINE");
    
    // 1. Create emergency
    const e3Res = await fetch(`${BASE_URL}/api/driver/emergency`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ambulance", origin: "I1", destination: "I6", priority: "critical" })
    });
    const e3 = await e3Res.json();
    console.log(`✓ Emergency created: ID ${e3.id}`);

    // 2. Upload photo
    const form3 = new FormData();
    form3.append("file", fs.createReadStream(dummyImgPath));
    form3.append("scenario", "scenarioC"); // FRAUD
    
    const p3Res = await fetch(`${BASE_URL}/api/emergency/${e3.id}/patient-image`, {
      method: "POST",
      body: form3 as any
    });
    const p3 = await p3Res.json();
    
    // 3. Manual Reject
    const r3Res = await fetch(`${BASE_URL}/api/admin/verifications/${p3.verification.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: "Confirmed non-emergency" })
    });
    const r3 = await r3Res.json();
    if (r3.status !== "adminRejected" || r3.isCorridorAuthorized) {
      throw new Error(`Manual rejection failed. Status: ${r3.status}`);
    }
    console.log(`✓ Manual Reject Successful (Corridor Authorized: ${r3.isCorridorAuthorized})`);
    
    console.log("\nALL TESTS PASSED.");
    
  } catch (err: any) {
    console.error(`\nTEST FAILED: ${err.message}`);
  } finally {
    if (fs.existsSync(dummyImgPath)) fs.unlinkSync(dummyImgPath);
    process.exit(0);
  }
}

runTest();
