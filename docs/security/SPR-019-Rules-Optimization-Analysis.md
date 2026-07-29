# SPR-019 Firestore Rules Optimization Analysis

Target: `securityprojectv1-staging`, Standard edition, Firestore Native.

## Vehicle-session update evaluation path

The failing client update evaluated `canProcessVehicleExit`, `activeSiteId`,
`canReassignVehicleQueue` or `validGuardQueueUpdate`, immutable-field equality
checks, `validQueueMetricUpdate`, assignment validation, assignee validation,
and `validVehicleSessionUpdate`. The final catch-all deny rule was also reported
by the emulator after the specific allow expression exhausted its budget.

The path repeatedly evaluated the authenticated user document through
`ownProfileExists`, `ownProfile`, role helpers, and site helpers. Assignee
validation used one `exists` plus two identical `get` expressions. The
`queueMetrics` map was fully validated even though the same update path later
required it to equal the stored server-controlled map. Immutable identity
fields were compared one at a time, while `validVehicleSessionUpdate` already
restricted the complete affected-key set.

No `getAfter` call is used by the update path. `getAfter` is limited to
vehicle-session creation and activity/card atomicity checks. The update path
used repeated `get`/`exists` reads only for the actor and a reassigned operator.

## Optimization boundary

The optimized path performs one actor-profile evaluation, combines active
status, role, and site authorization, removes the redundant full queue-metrics
validation, removes `queueMetrics` from client-mutable keys, and performs one
assignee-profile read when reassignment targets another UID. Exact
`sessionVersion + 1`, assignment versioning, Guard ownership, immutable
identity, allowed fields, data types, state enums, site isolation, and
server-controlled metrics remain enforced.

## Security assumptions tested

- Anonymous, inactive, cross-site, and wrong-owner updates fail.
- Identity-field changes fail.
- Same, skipped, decremented, and non-numeric session versions fail.
- Guard exit is allowed only for an owned session.
- Guard priority administration fails.
- Same-site Manager and Admin operations remain available.
- Audit logs remain immutable.

## Red-team result

The focused vehicle-session attack set denied public reads, unauthenticated and
inactive writes, cross-site access, ownership changes, immutable timestamp and
identity changes, schema pollution, oversized text, type confusion, version
replay/skip/decrement, Guard priority escalation, and queue-metrics tampering.
Valid owned Guard exit and same-site Manager/Admin updates remained available.

The repository-wide audit also identified pre-existing broad rules for
contractor, key, patrol, incident, and daily-report records that authorize any
active user without a rule-level `site_id` predicate or full domain validator.
Those rules were not broadened by SPR-019, but they require a separate hardening
sprint before Production.
