# SPR-017 Infrastructure Report

Generated: 2026-07-25. Target: `securityprojectv1-staging`.

## Audit

| Component | Result | Evidence |
|---|---|---|
| Node.js | PASS | v24.18.0 |
| npm | PASS | 11.16.0 |
| Firebase CLI | PASS | 15.24.0 via `npx -y firebase-tools@latest` |
| Firebase CLI authentication | PASS | Authenticated account confirmed |
| Active Firebase project | PASS | `securityprojectv1-staging` |
| Java | BLOCKED | No Java runtime |
| Google Cloud SDK | BLOCKED | `gcloud` unavailable |
| Firestore | BLOCKED | API disabled |
| Cloud Functions | BLOCKED | API disabled |
| Secret Manager | BLOCKED | Blaze billing required |
| Hosting site | PASS | `securityprojectv1-staging.web.app` exists |
| Hosting release | BLOCKED | HTTP 404; nothing deployed |
| Rules/index files | PASS | Firestore and Storage rules present |
| Emulator configuration | PASS | Auth, Firestore, Functions, Hosting and Storage configured |
| App Hosting | NOT APPLICABLE | Vite SPA uses Firebase Hosting Classic |

## Automation delivered

- Environment bootstrap and strict validation
- Infrastructure audit with JSON output
- Staging-only pre-deploy gate
- Staging-only deployment wrappers
- Health check with JSON output
- Synthetic seed dry-run/apply/rollback
- Smoke/E2E status generator
- Backup dry-run/apply guard
- Rollback dry-run/checklist
- Emulator configuration
- Hosting security/cache headers

No Production resource or Production data was modified.
