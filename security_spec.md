# Security Specification: Smart Guard System Zero-Trust ABAC Security

## 1. Data Invariants
*   **Authentication & Email Verification**: All writes (except sandbox-enabled developer bypasses) must originate from a verified Google session (`request.auth.token.email_verified == true`).
*   **Role-Based Access**:
    *   **Guard**: Can READ most collections, CREATE/UPDATE log entries (`VehicleLogs`, `ContractorLogs`, `KeyLogs`, `PatrolLogs`, `IncidentReports`). CANNOT see or modify `Users`, `SystemSettings`, `PatrolPoints`, or write `Blacklist`.
    *   **Shift Leader / Manager**: Can CREATE/UPDATE `DailyReports`, review all logs.
    *   **Admin**: Complete access to read/write all collections, manage `Users`, edit `SystemSettings`, modify `PatrolPoints` and `Blacklist`.
*   **Identity Pinning**: When creating any log record, the `login_email` in the document MUST match `request.auth.token.email`.
*   **Immutability of History**: Historical entries (e.g., `AuditLogs`, `PatrolLogs`) must never be modified or deleted.
*   **Immutable CreatedAt**: The field `created_at` can only be set to `request.time` on creation and can never be changed.

---

## 2. The "Dirty Dozen" Malicious Payloads

### Payload 1: Unauthorized User Creation (Privilege Escalation)
*   **Target**: `/users/U666`
*   **Intent**: Attempt to create an Admin profile with a different email.
*   **Payload**:
    ```json
    {
      "user_id": "U666",
      "login_email": "attacker@gmail.com",
      "operator_name": "Ghost Admin",
      "role": "Admin",
      "status": "Active"
    }
    ```

### Payload 2: Spoofed Email Identity on Vehicle Entry (Identity Spoofing)
*   **Target**: `/vehicleLogs/V111`
*   **Intent**: Create a log entry under another officer's email.
*   **Payload**:
    ```json
    {
      "log_id": "V111",
      "card_number": "P001",
      "vehicle_plate": "กข 1111",
      "vehicle_type": "รถยนต์",
      "visitor_name": "John Doe",
      "status": "กำลังจอด",
      "entry_time": "2026-07-07T06:00:00.000Z",
      "login_email": "innocent_guard@example.com",
      "operator_name": "Innocent Guard"
    }
    ```

### Payload 3: Changing Historical Created Timestamp (Temporal Corruption)
*   **Target**: `/patrolLogs/PL001`
*   **Intent**: Edit the check-in time of a patrol log retrospectively.
*   **Payload**:
    ```json
    {
      "checkin_time": "2026-01-01T00:00:00.000Z"
    }
    ```

### Payload 4: Deleting Audited Logs (Trace Erasure)
*   **Target**: `/auditLogs/AUD001`
*   **Intent**: Delete a security log to hide suspicious actions.
*   **Action**: `delete`

### Payload 5: Editing System Settings by Non-Admin (Config Poisoning)
*   **Target**: `/systemSettings/require_vehicle_photo`
*   **Intent**: Bypass the vehicle photo verification rule.
*   **Payload**:
    ```json
    {
      "setting_value": "false",
      "updated_by": "Guard BadGuy"
    }
    ```

### Payload 6: Deleting Active Patrol Points (Service Disruption)
*   **Target**: `/patrolPoints/PP001`
*   **Intent**: Sabotage guard tour routes.
*   **Action**: `delete`

### Payload 7: Overwriting Existing Blacklist Records by Guard (Bypass Security)
*   **Target**: `/blacklist/BL001`
*   **Intent**: Remove a blocked vehicle plate so a banned vehicle can enter.
*   **Payload**:
    ```json
    {
      "status": "Inactive",
      "reason": "Cleared by malicious actor"
    }
    ```

### Payload 8: Self-Elevating Role in Users Collection (Identity Theft)
*   **Target**: `/users/U101`
*   **Intent**: Upgrade own role from Guard to Admin.
*   **Payload**:
    ```json
    {
      "role": "Admin"
    }
    ```

### Payload 9: Submitting Blank Required Fields (Schema Poisoning)
*   **Target**: `/incidentReports/INC002`
*   **Intent**: Crash dashboard UI by submitting blank required fields.
*   **Payload**:
    ```json
    {
      "incident_id": "INC002",
      "incident_datetime": "",
      "location": "",
      "status": "แจ้งแล้ว"
    }
    ```

### Payload 10: Modifying Exit Time of Already Departed Visitor (State Corruption)
*   **Target**: `/vehicleLogs/V003` (where status is already "ออกแล้ว")
*   **Intent**: Retroactively rewrite history of when a vehicle exited.
*   **Payload**:
    ```json
    {
      "exit_time": "2026-07-07T12:00:00.000Z"
    }
    ```

### Payload 11: Bulk Read Scraping (PII Exposure)
*   **Target**: `/users` (Collection query)
*   **Intent**: Scrape full profiles (emails, names, phone numbers) without filters.
*   **Action**: `list` query with no constraints.

### Payload 12: Injecting Large Data Strings in Card ID (Denial of Wallet)
*   **Target**: `/parkingCards/C999`
*   **Intent**: Blow up Firestore bandwidth by inserting 10MB of base64 text into `card_number`.
*   **Payload**:
    ```json
    {
      "card_id": "C999",
      "card_number": "VERY_LONG_STRING_REPEATING_10MB...",
      "qr_code_value": "QR_999",
      "status": "ว่าง"
    }
    ```

---

## 3. Test Verification Plan

All of the payloads listed above must be blocked at the security rules level. We enforce the verification using our Firestore ruleset.
Our test runner logic expects a `PERMISSION_DENIED` on all twelve scenarios.
The rule validation uses `exists()`, `get()`, and `affectedKeys()` constraints to ensure strict access control.
