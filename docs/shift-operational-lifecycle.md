# Shift-based operational lifecycle

## Model

The operational day uses `Asia/Bangkok` and two deterministic shifts:

- Day: 07:00–19:00, ID `YYYY-MM-DD_DAY`
- Night: 19:00–07:00 next day, ID `YYYY-MM-DD_NIGHT`

The system keeps business documents in their original collections. Current,
archive, and carry-over states are derived from immutable business timestamps
and completion status. No document is copied, moved, deleted, or periodically
scanned, so private-media record IDs, activity timelines, and audits retain
their existing linkage.

Patrol check-ins store `shift_id` and `operational_date` as display/query
snapshots, while `checkin_time` (a Firestore server timestamp) remains the
authoritative lifecycle timestamp. Existing Thai `shift_type` is preserved for
backward compatibility; the canonical operational shift type is derived from
the `shift_id` suffix.

## Lifecycle gates

| Module | Current/carry-over | Archive eligibility |
| --- | --- | --- |
| Patrol | Check-in belongs to current shift | Completed check-in and shift closed |
| Contractor | Not exited, or missing `exit_time` | Exited/completed, `exit_time`, completed workflow when present, no workspace lock |
| Vehicle | Not exited, or missing `exit_time` | Exited/completed, `exit_time`, completed workflow when present |
| Key | Not returned or incomplete return evidence | Returned, `return_time`, return photo, and return signature |
| Incident | Reported, acknowledged, or in progress | Resolved or closed |

Carry-over is derived when an incomplete record originated before the current
shift. It never changes the original entry/checkout/report timestamp.

## Incident transitions

Manager and Admin accounts at the same active site may perform these strict,
one-way transitions:

`reported → acknowledged → in_progress → resolved → closed`

Each transition uses `serverTimestamp()`, records the authenticated UID, and
creates a deterministic immutable audit document in the same transaction.
Guard, inactive, legacy `ShiftLeader`, cross-site, duplicate, timestamp
overwrite, and arbitrary-field attempts are denied.

## Cost and operations

This implementation adds no scheduled function and no archive write. It adds
no recurring reads or writes. Archive/Search filters the module data already
loaded by its existing same-site adapters. Each Incident transition costs one
transaction read plus two writes (Incident and audit). No new composite index
is required by this patch.

## Security review

```json
{
  "score": 4,
  "summary": "Same-site RBAC, one-way state transitions, server-owned timestamps, immutable first-action timestamps, exact affectedKeys, and atomic deterministic audits protect the new Incident lifecycle. Derived archive state cannot mutate business data or media linkage.",
  "findings": [
    {
      "check": "Client shift snapshot",
      "severity": "minor",
      "issue": "Patrol shift_id and operational_date are computed by the client immediately before the transaction.",
      "recommendation": "Treat checkin_time as authoritative, as the current/archive adapters do. If server-generated shift metadata becomes query-authoritative later, add a trusted backend writer rather than weakening Rules."
    },
    {
      "check": "Legacy Incident administration",
      "severity": "minor",
      "issue": "Generic legacy status edits do not satisfy the strict lifecycle transition validator.",
      "recommendation": "Route lifecycle changes through transitionIncident; migrate unrelated administrative metadata in a separately reviewed patch."
    }
  ]
}
```

Devil's-advocate emulator coverage includes unauthorized roles, inactive and
cross-site accounts, arbitrary fields, missing audit writes, invalid and
duplicate transitions, and attempts to replace server-owned timestamps.
