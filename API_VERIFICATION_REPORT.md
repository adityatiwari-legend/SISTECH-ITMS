# API CONTRACT VERIFICATION REPORT

## 1. Authentication
| Endpoint | Method | Expected | Actual | Status | Problem | Severity |
|----------|--------|----------|--------|--------|---------|----------|
| `/api/auth/login` | POST | 400 on missing/wrong types | `body.email` checked loosely; wrong types cause 500s | PARTIAL | Lacks JSON schema validation for exact types | Medium |
| `/api/auth/refresh` | POST | 400 on missing token | Missing string type check | PARTIAL | Lacks JSON schema validation | Medium |
| `/api/auth/logout` | POST | 401 on missing token | Throws 401 via `authenticate` | OK | None | - |
| `/api/driver/profile` | GET | Returns driver profile | Returns profile using `auth.sub` | OK | None | - |

## 2. Driver / Vehicle
| Endpoint | Method | Expected | Actual | Status | Problem | Severity |
|----------|--------|----------|--------|--------|---------|----------|
| `/api/driver/vehicle` | GET | Cannot access other drivers | Scoped strictly to `auth.sub` | OK | None | - |
| `/api/driver/status` | PUT | Only accept valid enum values | No enum validation; invalid strings cause DB crash (503) | BROKEN | Missing JSON schema enum validation | Medium |

## 3. Emergency
| Endpoint | Method | Expected | Actual | Status | Problem | Severity |
|----------|--------|----------|--------|--------|---------|----------|
| `/api/emergency` | POST | Strictly validate input | Fully validates using Fastify JSON schema | OK | None | - |
| `/api/driver/emergency` | POST | Require driver auth | Fails open on auth error (assigns to driver 1) | BROKEN | Critical auth bypass left from testing | Critical |
| `/api/emergency/:id` | GET | Return emergency detail | Validates ID, returns data | OK | None | - |
| `/api/driver/emergencies`| GET | Return driver's emergencies| Validates auth, returns data | OK | None | - |
| `/api/emergency/:id/complete`| POST| Driver can only complete their own event | No ownership check; any driver can complete any emergency | BROKEN | Missing ownership authorization | High |
| `/api/emergency/:id/cancel`| POST | Driver can only cancel their own event | No ownership check; any driver can cancel any emergency | BROKEN | Missing ownership authorization | High |

## 4. Image
| Endpoint | Method | Expected | Actual | Status | Problem | Severity |
|----------|--------|----------|--------|--------|---------|----------|
| `/api/emergency/:id/patient-image` | POST | Validate image, MIME, auth, ownership | Auth bypassed on error (driver 1). No strict MIME or ownership checks. | BROKEN | Auth bypass; arbitrary file upload; no ownership | Critical |
| `/api/emergency/:id/patient-image` | GET | Secure medical image access | Catches auth errors to allow open browser `<img>` tag access. | BROKEN | Unauthenticated access to sensitive patient medical photos | Critical |

## 5. Verification
| Endpoint | Method | Expected | Actual | Status | Problem | Severity |
|----------|--------|----------|--------|--------|---------|----------|
| `/api/emergency/:id/verification` | GET | Return verification state | Returns state; missing ownership check for drivers | PARTIAL | Drivers can view other drivers' verifications | Medium |
| `/api/admin/verifications` | GET | Require Admin/Operator | Correctly enforces role checks | OK | None | - |
| `/api/admin/verifications/:id/approve` | POST | Manual approval opens corridor | Fails open on auth error (defaults to "ADM-001"); anyone can approve! | BROKEN | Critical auth bypass left from testing | Critical |
| `/api/admin/verifications/:id/reject` | POST | Manual reject closes corridor| Correctly enforces role and sets `isCorridorAuthorized = false` | OK | None | - |

## 6. Routing & Corridor
| Endpoint | Method | Expected | Actual | Status | Problem | Severity |
|----------|--------|----------|--------|--------|---------|----------|
| `/api/routes/preview` | POST | Return valid route | Computes A* route but lacks schema validation | PARTIAL | Missing input schema validation | Low |
| `/api/emergency/:id/route` | GET | Return active route | Endpoint is not implemented (route data exists in `/:id`) | MISSING | Missing requested endpoint | Low |
| Corridor Logic | Internal | Reject opens, approve closes | `verification-service.ts` correctly manages `isCorridorAuthorized` flag | OK | Logic sound, but approval API is unprotected | - |

---

## APIs Requiring Changes

1. **`POST /api/driver/emergency` (mobile)**
   - Remove fail-open `try-catch` around authentication.
   - Add strict Fastify JSON schema validation.

2. **`PUT /api/driver/status`**
   - Add Fastify JSON schema validation for the `status` enum.

3. **`POST /api/emergency/:id/complete`**
   - Verify that the authenticated driver actually owns the `eventId` being completed.

4. **`POST /api/emergency/:id/cancel`**
   - Verify that the authenticated driver actually owns the `eventId` being cancelled.

5. **`POST /api/emergency/:id/patient-image`**
   - Remove fail-open `try-catch` around authentication.
   - Enforce strict MIME type checking (e.g. `image/jpeg`, `image/png`).
   - Verify ownership of the emergency before allowing upload.

6. **`GET /api/emergency/:id/patient-image`**
   - Remove fail-open `try-catch` around authentication.
   - Pass tokens via query parameter or header for valid `<img src>` usage, or use signed URLs to ensure privacy.

7. **`POST /api/admin/verifications/:id/approve`**
   - Remove fail-open `try-catch` around authentication.
   - Strictly require admin/operator role.

8. **`GET /api/emergency/:id/route`**
   - Implement this endpoint to return exclusively the route data, or document that it is intentionally consolidated into `/api/emergency/:id`.

9. **All APIs missing JSON Schemas**
   - Add standard Fastify JSON schema validation to prevent malformed bodies from reaching the service layer.
