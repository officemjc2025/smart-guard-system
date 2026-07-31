# Patrol and Incident Security Audit

Scope: `patrolPoints`, `patrolLogs`, `incidentReports`, their immutable audit
records, and registered Private Media identities.

```json
{
  "score": 4,
  "summary": "The patch replaces active-user-only writes with same-site RBAC, strict create schemas, immutable identities, server-owned timestamps, atomic audit linkage, exact media types, and mediaUploads registry binding. Remaining legacy records may need a controlled migration before every historical record can use the strict update validator.",
  "findings": [
    {
      "check": "Update bypass",
      "severity": "minor",
      "issue": "Patrol logs are immutable and Incident updates have an affectedKeys allowlist. Legacy Incident records without the new identity/timestamp fields cannot use the new update path.",
      "recommendation": "Run a separately approved migration after staging verification rather than weakening the validator."
    },
    {
      "check": "Authority source",
      "severity": "minor",
      "issue": "Authority comes from users/{auth.uid}; display names remain denormalized snapshots and are bounded but may become stale.",
      "recommendation": "Keep UID as canonical identity and treat display names as historical snapshots."
    },
    {
      "check": "Storage abuse",
      "severity": "minor",
      "issue": "New operational fields have size bounds in Rules; older unrelated collections remain outside this audit.",
      "recommendation": "Continue collection-by-collection validation hardening."
    }
  ]
}
```

## Devil's advocate results

- Anonymous, inactive, legacy `ShiftLeader`, and cross-site writes: denied.
- Patrol arbitrary fields, missing primary evidence, partial optional evidence,
  duplicate evidence, and abnormal status without a reason: denied.
- Patrol optional photo 2 is accepted only when all three canonical fields are
  absent. When present, its URL, file ID, site, module, record, and exact
  `patrol_photo_2` media identity remain mandatory.
- Incident arbitrary field mutation, client-owned `reported_at`, missing
  evidence, and cross-site writes: denied.
- Evidence URL guessing without matching registered `mediaUploads` metadata:
  denied by file ID, site, module name, record ID, and exact media type checks.
- Patrol business records cannot be updated after completion.
- Incident identity, event time, report time, creator UID, site, and creation
  timestamp are immutable.
- Atomic audit creation is checked with `existsAfter()` and `getAfter()`.
- Positive emulator transactions completed without expression-budget errors.

The updated rules should still receive staging review before broad production
use.
