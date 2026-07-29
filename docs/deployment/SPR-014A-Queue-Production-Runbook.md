# SPR-014A Operational Queue Production Runbook

This runbook is an approval-gated production procedure. Code deployment, rules
deployment, index deployment, data migration, and live verification are
separate operations. Do not combine or reorder them.

## Preconditions

- Written approval for each production-changing phase.
- Firebase CLI authenticated with the approved production operator.
- Maintenance window and rollback owner confirmed.
- No unresolved Vehicle Session integrity incident.

## 1. Confirm Firebase project

```bash
npx firebase-tools projects:list
npx firebase-tools use
```

Stop unless the active project is exactly `securityprojectv1`.

## 2. Backup relevant collections

Create and verify a recoverable export of:

- `vehicleSessions`
- `vehicleSessions/*/activities`
- `vehicleLogs`
- `parkingCards`
- `auditLogs`

Record the export identifier, timestamp, database location and restore command.
Do not proceed until the export reports success.

## 3. Build and test

```bash
npm run lint
npm run build
npm test
git diff --check
npx firebase-tools deploy --only firestore:rules --dry-run --project securityprojectv1
```

All commands must pass.

## 4. Deploy rules

This is a production change and requires explicit approval:

```bash
npx firebase-tools deploy --only firestore:rules --project securityprojectv1
```

Verify same-site reads, Guard ownership, supervisor transfer, immutable
activities and immutable Audit Logs.

## 5. Deploy indexes

This is a separate production change:

```bash
npx firebase-tools deploy --only firestore:indexes --project securityprojectv1
```

## 6. Wait for index readiness

In Firebase Console, confirm every new `vehicleSessions` index is `Enabled`.
Do not start Hosting or migration while any required index is building.

## 7. Deploy Hosting only when approved

```bash
npm run build
npx firebase-tools deploy --only hosting --project securityprojectv1
```

Record the release identifier and Hosting URL.

## 8. Preview backfill

Sign in as Admin, open Admin Panel → Audit → Queue Backfill Migration, select
**Preview / Dry Run**, and export the JSON result. Confirm:

- `updated` is `0`
- Cross-site and invalid records are reported
- Already migrated records are skipped
- No arbitrary operator assignment is proposed

## 9. Run controlled backfill

After backup and preview approval, enable the confirmation checkbox and run one
site at a time with the default 200-document batch. Export every result. If
interrupted, use the reported `lastDocumentId` with **Resume**. Re-run Preview
after completion; expected eligible count is zero.

## 10. Verify queue counts

Compare source sessions with Waiting, Assigned, Ready and Completed dashboard
counts. Check a sample from every derived status.

## 11. Single Guard test

Scan an Available test card, take/continue the session, add visitor,
destination and evidence, complete entry, then exit. Verify session, log, card,
activity subcollection and Audit Logs.

## 12. Multi Guard test

Guard A creates/releases a session. Guard B takes and completes it. Confirm the
timeline contains both identities and no embedded activity was deleted.

## 13. Assignment conflict test

Have two Guards take the same unassigned job simultaneously. Exactly one must
succeed; the loser must receive a conflict message and an `AssignmentConflict`
Audit Log.

## 14. Notification denial test

Choose **Not now**, reload and verify no repeated prompt. Separately deny
browser permission and verify all queue operations remain usable.

## 15. Verify Audit Logs

Verify immutable records for Take, Transfer, Release, Priority Change, Queue
Status Change, conflicts, administrative overrides and completion.

## 16. Rollback

1. Stop migration and record the last processed document.
2. Roll Hosting back to the previous release.
3. Restore the previous rules only if the security owner approves.
4. Do not delete new activity documents.
5. Restore affected collections from the verified export when data rollback is
   approved.
6. Reconcile `parkingCards`, `vehicleSessions`, and `vehicleLogs` before
   reopening the workflow.

Queue backfill is additive and idempotent. Prefer repair or restore over bulk
field deletion.
