# SPR-015 Analytics Production Runbook

Every production-changing phase requires separate approval. Queue backfill,
analytics rebuild, code deployment, rules, indexes and Hosting are independent.

## 1. Confirm project and region

```bash
npx firebase-tools use
npx firebase-tools firestore:databases:list --project securityprojectv1
```

Target only `securityprojectv1`, Functions region `us-central1`, and Firestore
`(default)` Standard Edition in `asia-southeast3`.

## 2. Backup

Export `vehicleSessions`, activity subcollections, `siteAnalyticsDaily`,
contributions, `vehicleLogs`, `parkingCards` and `auditLogs`. Record the export
identifier and verify restore permissions.

## 3. Validate

```bash
npm --prefix functions run build
npm run lint
npm run build
npm test
git diff --check
npx firebase-tools deploy --only firestore:rules --dry-run --project securityprojectv1
```

## 4. Deploy Functions

After approval, deploy analytics functions and operator directory explicitly.
Do not deploy unrelated functions:

```bash
npx firebase-tools deploy --only functions:onVehicleSessionAnalyticsUpdate,functions:previewSiteDailyAnalyticsRebuild,functions:rebuildSiteDailyAnalytics,functions:listEligibleQueueOperators --project securityprojectv1
```

## 5. Verify Functions logs

Confirm successful cold start and structured analytics logs. Verify no visitor
PII, evidence URL, credential or token appears.

## 6. Deploy Rules

```bash
npx firebase-tools deploy --only firestore:rules --project securityprojectv1
```

## 7. Deploy indexes

```bash
npx firebase-tools deploy --only firestore:indexes --project securityprojectv1
```

## 8. Wait for indexes

Do not continue until every required index is `Enabled`.

## 9. Deploy Hosting

Only after approval and index readiness:

```bash
npm run build
npx firebase-tools deploy --only hosting --project securityprojectv1
```

## 10. Verify realtime metrics

At one approved site, compare bounded active queue results against Queue,
Analytics and My Work widgets.

## 11. Preview rebuild

Admin Panel → Audit → Daily Analytics Rebuild. Select at most 31 days and run
Preview. Export JSON; expected writes are zero.

## 12. Run bounded rebuild

After backup and preview approval, check confirmation and rebuild one bounded
range. Never run queue backfill simultaneously.

## 13. Verify ledger

Sample `siteAnalyticsDaily/{dailyId}/contributions/{sessionId}`. Re-run the same
bounded rebuild and verify totals do not change.

## 14. Compare samples

For completed sessions, manually verify waiting, working and cycle durations
against milestones, then compare daily totals.

## 15. Stale-session conflict

Open one session in two clients. Save Client A, then Client B. Client B must get
`SESSION_VERSION_CONFLICT` and must not overwrite.

## 16. Same-site permissions

Verify Guard, Shift Leader, Manager and Admin roles. Confirm non-Admin
cross-site reads fail and clients cannot write aggregate totals/contributions.

## 17. CSV verification

Export a Manager/Admin report. Confirm metadata and date range. Test cells
starting with `=`, `+`, `-`, and `@`; each must be prefixed safely.

## 18. Rollback and repair

1. Stop rebuilds.
2. Roll Hosting back.
3. Roll Functions back to the prior revision.
4. Restore prior Rules only with security-owner approval.
5. Do not delete contribution ledgers or activities.
6. Restore aggregates from backup or use an explicitly approved bounded repair.
7. Reconcile sample sessions before reopening analytics.
