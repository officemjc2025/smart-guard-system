# Staging Digital Twin Runbook

## Scope

The synchronization engine reads `securityprojectv1` and writes only to
`securityprojectv1-staging`. It targets the `(default)` Firestore database.

- Tier 1 is mirrored completely.
- Tier 2 uses `7d`, `30d`, `90d`, or `all`.
- Tier 3 is never read, compared, deleted, or written by the engine.
- Top-level documents and all descendant subcollections are preserved.

## Prerequisites

1. Application Default Credentials must have read access to Production and
   Firestore write access to Staging.
2. The active Firebase project must be `securityprojectv1-staging`.
3. `STAGING_BACKUP_BUCKET` must point to a staging-only Cloud Storage bucket.
4. The operator must be allowed to run managed Firestore export/import.

## Safe workflow

```bash
npm run clone:staging:dry-run
npm run compare:projects
npm run clone:staging
npm run verify:clone
```

Override the default 30-day snapshot by appending an argument:

```bash
npm run clone:staging:dry-run -- --mode=7d
npm run clone:staging -- --mode=90d
npm run verify:clone -- --mode=all
```

Every command requires the exact
`--confirm=securityprojectv1-staging` token. The npm commands include it.

## Apply behavior

Apply performs these steps:

1. Calculate a read-only diff.
2. Run the existing Staging managed backup and abort if it fails.
3. Upsert missing or mismatched documents in batches of 400.
4. Delete extra documents only from the configured Tier 1 and Tier 2
   collections.
5. Retry failed batches with exponential backoff.
6. Re-read both projects and write `clone-manifest.json`.

The manifest is written with owner-only file permissions and includes document
IDs needed for verification and rollback. Treat it as an operational artifact.

## Rollback

```bash
npm run clone:staging:rollback
```

Rollback imports the managed backup referenced by the manifest, then removes
documents that did not exist before the clone. Production is never a rollback
target.

## Failure handling

- A backup failure causes zero clone writes.
- A batch failure is retried up to four times.
- A verification mismatch produces `status: "FAIL"` and a non-zero exit code.
- Re-running Apply is idempotent; matching documents generate no writes.
