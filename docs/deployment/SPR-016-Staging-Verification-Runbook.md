# SPR-016 Staging Verification Runbook

## Preconditions

- Use an isolated Firebase staging project and staging-only accounts.
- Confirm `firebase use` and Hosting URL before every command.
- Export/backup staging Firestore before migration or rebuild tests.
- Configure staging secrets separately; never copy secret values into Git.

## Validation

1. Run `npm run lint`, `npm run build`, Functions build and unit tests.
2. Run Firestore Rules emulator tests and Rules dry-run.
3. Deploy Rules, indexes, Functions and Hosting to staging only.
4. Confirm structured trigger logs contain no tokens or PII.
5. Create a staging session and exercise take, transfer, release, priority,
   waiting-information, ready and completed transitions.
6. Confirm client attempts to modify `queueMetrics` fail.
7. Confirm trusted trigger updates queue metrics using server event time.
8. Confirm contribution ledger counts completion exactly once.
9. Confirm cross-site reads/writes and analytics client writes are denied.
10. Confirm lazy-loaded routes recover from loading and chunk failures.

## Performance profile

- Capture initial JS transfer size and largest lazy route chunk.
- Measure dashboard first render, queue subscription latency and search latency.
- Test normal and throttled mobile networks.
- Record Firestore read counts for initial load and 15 minutes of queue activity.

## Rollback drill

- Roll Hosting back to the previous staging release.
- Redeploy the previous Functions revision.
- Re-run Rules dry-run before restoring previous Rules.
- Verify sessions and audit logs remain readable and no ledger is deleted.

Production deployment and production data changes require separate approval.
