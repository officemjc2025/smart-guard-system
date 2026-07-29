# SPR-016 Production Hardening

## Analytics retention

- Keep `siteAnalyticsDaily` online for 25 months.
- Keep contribution ledgers online for 13 months after their daily aggregate.
- Keep completed `vehicleSessions` online for 90 days, then export to a
  versioned archive before deletion.
- Audit logs are immutable and retained for the period approved by Security and
  Legal; no automatic deletion is enabled by this sprint.
- A future scheduled retention function must support dry-run, bounded batches,
  checkpoints, archive verification and an immutable audit record.
- TTL must not be enabled until staging restores prove the archive is complete.

## Structured logging

Queue metric and analytics triggers emit an event name plus `event_id`,
`session_id`, `site_id`, `action`, `duration_ms`, `success`, and a safe error
message. Tokens, media data, credentials and profile PII must never be logged.

## Configuration checklist

- Confirm `.firebaserc` target and `firebase use` output.
- Confirm Firebase config project ID equals `VITE_EXPECTED_FIREBASE_PROJECT_ID`.
- Confirm media upload URL is absolute HTTPS.
- Confirm Drive OAuth values remain Secret Manager secrets.
- Confirm `(default)` is Standard Firestore in `asia-southeast3`.
- Never target the separate Enterprise AI Studio database.
- Review `npm audit`; do not apply forced dependency upgrades during release.
- Verify Rules and indexes against staging before production approval.

## Rollback strategy

1. Record Hosting release ID, Functions revision, Rules release and index state.
2. Keep the previous Hosting release available for rollback.
3. Redeploy the last known-good Functions artifact if trigger errors increase.
4. Restore the previous reviewed Rules file only after a rules dry-run.
5. Do not delete newly created indexes during an incident.
6. Disable analytics presentation if aggregates are suspect; retain ledgers.
7. Rebuild aggregates only from verified archived/session sources using preview.

No production retention job, TTL policy or deletion is enabled by SPR-016.
