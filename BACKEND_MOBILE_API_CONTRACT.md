# SISTEC / ITMS Mobile Integration API Contract

This document provides the definitive, static integration contract for the Flutter Mobile Application and the web-based Command Center, generated from the fully verified backend implementation (Post-Phase 8).

============================================================
## 1. AUTHENTICATION
============================================================

### Login
`POST /api/auth/login`
**Request Body (JSON):**
```json
{
  "email": "driver@example.com",
  "password": "password123"
}
```
**Response (200 OK):**
```json
{
  "token": "eyJhbG...",
  "refreshToken": "ref_...",
  "user": {
    "id": 1,
    "email": "driver@example.com",
    "role": "driver"
  }
}
```

### Refresh Token
`POST /api/auth/refresh`
**Request Body (JSON):**
```json
{
  "refreshToken": "ref_..."
}
```
**Response (200 OK):**
```json
{
  "token": "eyJhbG..."
}
```

### Logout
`POST /api/auth/logout`
**Headers:** `Authorization: Bearer <token>`
**Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully."
}
```

### Token Format
JWT access tokens. Must be provided in the header:
`Authorization: Bearer <token>`

### Roles
Valid roles are: `"driver"`, `"admin"`, `"operator"`. Mobile endpoints generally require the `"driver"` role, while verification approvals require `"admin"` or `"operator"`.

============================================================
## 2. DRIVER
============================================================

### Profile
`GET /api/driver/profile`
**Headers:** `Authorization: Bearer <token>`
**Response (200 OK):**
```json
{
  "id": 1,
  "driverCode": "DRV-101",
  "name": "Vikram Rathore",
  "email": "driver@example.com",
  "phone": "+91 9876543210",
  "role": "driver",
  "status": "available",
  "licenseNumber": "MP04-2012-1234567",
  "assignedVehicle": { /* FleetVehicleRecord */ },
  "currentEmergencyId": null
}
```

### Vehicle
`GET /api/driver/vehicle`
**Headers:** `Authorization: Bearer <token>`
**Response (200 OK):**
```json
{
  "vehicle": {
    "id": 1,
    "vehicleCode": "AMB-UNIT-108",
    "registrationNumber": "MP04-AB-1234",
    "vehicleType": "ambulance",
    "model": "Force Traveller",
    "status": "assigned",
    "assignedDriverId": 1,
    "currentEmergencyId": null,
    "lastLatitude": null,
    "lastLongitude": null,
    "lastHeading": null,
    "lastSpeedKmh": null
  }
}
```

### Duty Status
`PUT /api/driver/status`
**Headers:** `Authorization: Bearer <token>`
**Request Body (JSON):**
```json
{
  "status": "on_duty" 
}
```
*(Valid enum: "available" | "on_duty" | "off_duty" | "in_emergency")*
**Response (200 OK):** `DriverProfile` object.

============================================================
## 3. EMERGENCY
============================================================

### Create Emergency
`POST /api/driver/emergency`
**Headers:** `Authorization: Bearer <token>`
**Request Body (JSON):**
```json
{
  "type": "ambulance",
  "priority": "critical",
  "latitude": 23.259933,
  "longitude": 77.412615,
  "destinationHospitalId": 1,
  "patientCondition": "Cardiac Arrest",
  "severity": "high"
}
```
**Response (201 Created):** Returns an `EmergencyEventDetail` object.

### Get Driver Emergencies (History)
`GET /api/driver/emergencies`
**Headers:** `Authorization: Bearer <token>`
**Response (200 OK):**
```json
{
  "emergencies": [ /* Array of EmergencyEventDetail */ ]
}
```

### Complete Emergency
`POST /api/emergency/:id/complete`
**Headers:** `Authorization: Bearer <token>`
**Response (200 OK):**
```json
{
  "status": "completed",
  "eventId": 123
}
```

### Cancel Emergency
`POST /api/emergency/:id/cancel`
**Headers:** `Authorization: Bearer <token>`
**Request Body (JSON):**
```json
{
  "reason": "Patient refused transport"
}
```
**Response (200 OK):**
```json
{
  "status": "cancelled",
  "eventId": 123,
  "reason": "Patient refused transport"
}
```

============================================================
## 4. PHOTO
============================================================

### Upload Evidence
`POST /api/emergency/:id/patient-image`
**Headers:** `Authorization: Bearer <token>`

Can be sent as `multipart/form-data`:
- **Field name:** `file` (or any valid field containing the binary part).
- **Other fields:** `scenario` (optional).
- **MIME types:** Must strictly start with `image/` (e.g. `image/jpeg`, `image/png`).
- **Maximum size:** 15MB.

Can also be sent as JSON (base64):
```json
{
  "imageBase64": "data:image/jpeg;base64,...",
  "fileName": "patient.jpg",
  "mimeType": "image/jpeg",
  "scenario": "scenarioA"
}
```

**Authentication / Authorization:** Requires a valid token. The authenticated driver **must** be the owner of the `eventId`.
**Response (201 Created):**
```json
{
  "evidenceId": 45,
  "verification": { /* VerificationDetail */ }
}
```

### Download / View Evidence
`GET /api/emergency/:id/patient-image`
**Headers:** `Authorization: Bearer <token>`
**Response (200 OK):** Binary image data matching the stored MIME type. (Requires authentication, unauthorized requests are explicitly rejected).

============================================================
## 5. VERIFICATION
============================================================

The `VerificationDetail` object tracks the AI analysis and human review lifecycle.

```json
{
  "id": 1,
  "requestId": "VRF-12345678-DRV-101",
  "eventId": 123,
  "driverId": 1,
  "vehicleId": 1,
  "status": "aiApproved",
  "isCorridorAuthorized": true,
  "submittedAtIso": "2026-09-25T07:15:00Z",
  "updatedAtIso": "2026-09-25T07:15:05Z",
  "evidence": {
    "id": 45,
    "fileName": "evidence-123.jpg",
    "fileSizeBytes": 102400,
    "mimeType": "image/jpeg",
    "uploadedAtIso": "2026-09-25T07:15:00Z"
  },
  "aiResult": {
    "verdict": "VERIFIED",
    "confidenceScore": 0.96,
    "reason": "Physical emergency evidence patterns verified.",
    "detectedFeatures": ["Real-world emergency vehicle context verified"],
    "isFlaggedAsFraud": false,
    "model": "itms_grounded_vision_rules",
    "evaluatedAtIso": "2026-09-25T07:15:05Z"
  },
  "adminDecision": null
}
```

### Verification States (`status` enum)
- `captured`, `submitted`, `pending`
- `aiAnalyzing`, `aiApproved`, `aiFraudFlagged`
- `manualReview`, `adminApproved`, `adminRejected`
- `corridorAssigned`

============================================================
## 6. ADMIN
============================================================

*All endpoints require `"admin"` or `"operator"` role.*

### Verification Queue
`GET /api/admin/verifications`
**Response (200 OK):**
```json
{
  "verifications": [ /* Array of VerificationDetail */ ]
}
```

### Get Verification Details
`GET /api/admin/verifications/:id`
**Response (200 OK):** Returns a single `VerificationDetail`.

### Approve Verification
`POST /api/admin/verifications/:id/approve`
**Request Body (JSON):**
```json
{
  "notes": "Verified visually by supervisor."
}
```
**Constraints:** Can only approve if status is `"manualReview"`, `"submitted"`, or `"aiAnalyzing"`.
**Response (200 OK):** Returns the updated `VerificationDetail`.

### Reject Verification
`POST /api/admin/verifications/:id/reject`
**Request Body (JSON):**
```json
{
  "reason": "Fraudulent photo detected."
}
```
**Constraints:** `reason` is mandatory. Can only reject if status is `"manualReview"`, `"submitted"`, or `"aiAnalyzing"`.
**Response (200 OK):** Returns the updated `VerificationDetail`.

============================================================
## 7. ROUTING
============================================================

### Get Route Preview
`POST /api/routes/preview`
**Request Body (JSON):**
```json
{
  "originLat": 23.2599,
  "originLng": 77.4126,
  "destinationHospitalId": 1
}
```
**Response (200 OK):**
```json
{
  "routeId": "preview-I1-I6-12345",
  "originJunction": "I1",
  "destinationJunction": "I6",
  "totalLengthM": 2450.5,
  "estimatedTravelTimeS": 180,
  "segments": [
    {
      "segmentId": "edge_I1_I2",
      "fromJunction": "I1",
      "toJunction": "I2",
      "lengthM": 500,
      "costSeconds": 45,
      "coordinates": [
        { "lat": 23.2599, "lng": 77.4126 },
        { "lat": 23.2610, "lng": 77.4130 }
      ]
    }
  ]
}
```
*Note: This geometry enables Flutter to draw the polyline on Google Maps directly.*

============================================================
## 8. CORRIDOR
============================================================

The system manages corridors internally based on the verification pipeline. Creating an emergency kicks off a corridor if `isCorridorAuthorized` becomes true. No direct API endpoints are exposed to manually create a corridor; it is strictly coupled to the `VerificationDetail` workflow.
Corridors transition through:
`PLANNING` -> `VALIDATING` -> `ACTIVE` -> `REPLANNING` -> `COMPLETED` / `CANCELLED` / `FAILED`.

============================================================
## 9. WEBSOCKET
============================================================

Connect to: `ws://<host>:<port>/ws`
Authenticate by sending a JSON frame or via connection query param (if supported).

### Event: `auth` (Client -> Server)
**Payload:** `{ "type": "auth", "token": "eyJhbG..." }`
**Response:** `{ "type": "auth:success", "driverId": 1, "role": "driver" }`

### Event: `subscribe` (Client -> Server)
**Payload:** `{ "type": "subscribe", "eventId": 123, "vehicleCode": "AMB-1" }`
*(Required to receive specific emergency state and telemetry updates).*

### Event: `traffic:update` (Server -> Client)
**Payload:** City-wide traffic metrics.
**Emitted:** Every loop interval (e.g. 5 seconds).
**Filtering:** Mobile clients **must** be subscribed to an `eventId` to receive this.

### Event: `emergency:verified` (Server -> Client)
**Payload:**
```json
{
  "type": "emergency:verified",
  "ts": "2026-09-25T07:15:05Z",
  "payload": {
    "requestId": "VRF-...",
    "eventId": 123,
    "verdict": "VERIFIED",
    "confidence": 0.96,
    "isCorridorAuthorized": true
  }
}
```
**Emitted:** When AI verification passes. Filtered strictly to the driver subscribed to `eventId: 123`.

### Event: `corridor:authorized` (Server -> Client)
**Payload:**
```json
{
  "type": "corridor:authorized",
  "ts": "...",
  "payload": {
    "eventId": 123,
    "requestId": "VRF-...",
    "authorizedBy": "AI_VERIFICATION",
    "timestamp": "..."
  }
}
```
**Emitted:** Following a successful verification (AI or manual). Filtered to the subscribed driver.

============================================================
## 10. ERRORS
============================================================

All application errors return a structured JSON body:
```json
{
  "error": {
    "code": "AI_UNAVAILABLE",
    "message": "AI service is unavailable."
  }
}
```

Standard codes include:
- `400 missing_credentials`, `missing_vehicle`, `invalid_id`, `invalid_image`
- `401 unauthorized` (Token missing or invalid)
- `403 forbidden` (Ownership failure, Role mismatch)
- `404 driver_not_found`, `not_found`, `verification_not_found`
- `409 invalid_state_transition`
- `413 photo_too_large`
- `500 verification_lost`
- `503 AI_UNAVAILABLE`

============================================================
## 11. STATUS ENUMS
============================================================

**EmergencyStatus:** `"created"`, `"active"`, `"arrived"`, `"completed"`, `"cancelled"`, `"failed"`
**VerificationStatus:** `"captured"`, `"submitted"`, `"pending"`, `"aiAnalyzing"`, `"aiApproved"`, `"aiFraudFlagged"`, `"manualReview"`, `"adminApproved"`, `"adminRejected"`, `"corridorAssigned"`
**CorridorStatus:** `"PLANNING"`, `"VALIDATING"`, `"ACTIVE"`, `"REPLANNING"`, `"COMPLETED"`, `"CANCELLED"`, `"FAILED"`
**VehicleStatus:** `"available"`, `"assigned"`, `"in_emergency"`, `"maintenance"`

============================================================
## 12. SECURITY
============================================================

- **Authentication:** Strict JWT enforcement on all endpoints. `try/catch` fallbacks have been removed.
- **Authorization:** Mobile emergency endpoints require the caller to own the targeted `eventId`. Admin endpoints require the `admin` or `operator` role.
- **Image Access:** Authenticated. Browser `<img src>` tags must pass tokens via headers, query strings, or utilize a proxy if they need to display medical images.
- **Upload Limits:** 15MB limit per image file.
- **WebSocket Privacy:** Data streams are strongly sandboxed. Drivers only receive `emergency:*` and telemetry events if they are explicitly subscribed to the associated `eventId`. Unsubscribed drivers receive zero external traffic/emergency data.
