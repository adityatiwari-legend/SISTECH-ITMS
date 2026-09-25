# DATABASE & STATE MACHINE VERIFICATION REPORT

## 1. Database Schema Status
The database schema is structurally complete and fully implements the requirements across all 8 documented phases (migrations `001_phase2.sql` to `007_mobile_integration.sql`). All expected tables (drivers, vehicles, emergency_events, evidence, verifications, routes, corridors, signals, hospitals, telemetry, audit_events) are correctly defined with appropriate PostgreSQL types.

## 2. Missing Relationships
No structural relationships are missing. The schema perfectly connects the mobile entities (drivers/vehicles) to the simulation entities (events/routes/corridors) and traffic control entities (signals/snapshots). 
- `Driver → Vehicle`: Supported via `fleet_vehicles` and `driver_vehicle_assignments`.
- `Driver → Emergency`: Supported via `emergency_events.driver_id`.
- `Emergency → Evidence / Verification`: Supported via explicit foreign keys.
- `Emergency → Route / Corridor`: Supported via explicit foreign keys.

## 3. Missing Constraints
- **Circular Foreign Key Friction**: `routes.event_id` references `emergency_events(id)` and `emergency_events.route_id` references `routes(id)`. Neither constraint is `DEFERRABLE INITIALLY DEFERRED`. The repository currently works around this by inserting `emergency_events` with a null `route_id` and running a subsequent `UPDATE`, but a deferrable constraint would be cleaner.
- **Cascade Deletions**: `green_corridors.event_id` and `driver_telemetry.event_id` lack `ON DELETE CASCADE`. Deleting an emergency event directly would fail due to constraint violations.
- **Enums**: PostgreSQL `CHECK` constraints on strings are used effectively instead of native ENUM types, which is generally fine but requires manual schema alterations if new states are added.

## 4. Invalid State Transitions
The application layer fails to enforce strict state machine rules, allowing invalid transitions:
- **Verification Approval (`adminApprove`)**: Does not check the current `status` of the verification. An admin can transition an `adminRejected`, `aiApproved`, or `pending` emergency directly into `adminApproved`.
- **Verification Rejection (`adminReject`)**: Does not check the current `status`. Can reject an already approved emergency.
- **Emergency Lifecycle**: `completeEmergency` and `cancelEmergency` do not verify if the emergency is currently active. They blindly transition the state, allowing a `completed` emergency to be transitioned to `cancelled`.

## 5. Security Problems
- **Driver Ownership Bypass**: A driver can cancel or complete ANY emergency event in the system. The service layer (`mobileService.completeEmergency` / `cancelEmergency`) accepts an `eventId` but never asserts that the `eventId` belongs to the requesting `driverId`.
- **Admin Authentication Bypass**: The API route for `adminApprove` contains a `try-catch` block that defaults to `approverCode = "ADM-001"` on auth failure, allowing unauthorized users to approve emergencies and trigger green corridors.
- **Corridor Re-activation**: Because the state machine allows `adminRejected` -> `adminApproved`, a rejected emergency can technically bypass the rejection and activate a corridor if the unprotected API is invoked.

## 6. Transaction Problems
Several critical multi-table operations are not wrapped in database transactions (`db.transaction`), risking severe data inconsistency if the Node process crashes mid-execution:
- **`mobileService.cancelEmergency`**: The cancellation of the active corridor and the cancellation of the emergency event are executed as separate, independent operations. 
- **`aiVerificationService.adminApprove` & `adminReject`**: The calls to `mobileRepo.recordManualDecision`, `mobileRepo.updateVerificationStatus`, and `mobileRepo.recordAudit` are executed sequentially as separate queries.

## 7. Required Fixes
1. **Enforce State Rules**: Add guard clauses in the service layer to validate current states before applying transitions (e.g., `if (target.status !== 'manualReview') throw ...`).
2. **Wrap Transactions**: Refactor `aiVerificationService` decisions and `mobileService` cancellation/completion logic to use `db.transaction(async (tx) => { ... })`.
3. **Enforce Ownership**: Add SQL `WHERE driver_id = $x` or application-level ownership checks before updating emergencies.
4. **Remove Auth Bypasses**: Delete the `try-catch` mock blocks in the API routes to strictly enforce JWT validation and role-based access control.
