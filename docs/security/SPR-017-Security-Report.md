# SPR-017 Security Report

## Controls

- Production project ID is explicitly rejected by deploy, seed, backup,
  retention and rollback tooling.
- Every remote command uses the explicit staging project ID.
- Secret checks read metadata only; secret values are never logged.
- Apply and rollback operations require exact staging confirmation.
- Staging CORS is selected only when `GCLOUD_PROJECT` is the staging project.
- Staging Functions use the supported `asia-southeast1` region.
- XLSX remains disabled; bounded CSV-only import is active.

## Dependency classification

| Scope | Critical | High | Moderate | Decision |
|---|---:|---:|---:|---|
| Web runtime | 0 | 0 | 3 | Accepted temporarily; coordinated dependency review required |
| Functions runtime | 0 | 0 | 11 | Accepted temporarily; major upgrades require staging E2E |
| Root full tree | 0 | 15 | 11 | High findings are development/toolchain paths |
| Functions full tree | 0 | 32 | 11 | High findings are Jest/ESLint development paths |

Runtime High findings do not block on their own. Infrastructure and deployed
verification blockers keep the release NO-GO.

## Open security blockers

- Firestore Rules Emulator cannot run without Java.
- Rules are not deployed or verified against staging.
- Authentication provider is not enabled/verified in staging.
- OAuth secrets and Drive permissions are not configured.
- Backup and rollback are not executed.
