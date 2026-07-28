# SPR-018 Infrastructure Recovery

Generated: 2026-07-25  
Environment: `STAGING`  
Project: `securityprojectv1-staging`  
Firestore region: `asia-southeast3`  
Staging Functions region: `asia-southeast1`

Production project `securityprojectv1` was not selected, deployed, or modified.

## Architecture Summary

- Vite SPA on Firebase Hosting Classic.
- Firebase Authentication with Email/Password.
- Cloud Firestore Standard/Native Mode is required in `asia-southeast3`.
- Staging Cloud Functions run in `asia-southeast1`.
- Vehicle evidence uses backend-only Google Drive OAuth2 user credentials.
- Local recovery tooling is isolated under `.tools/`.

## Infrastructure Discovery

| Resource | Status | Evidence |
|---|---|---|
| Firebase project | PASS | `securityprojectv1-staging`, project number `1060612850170` |
| Firebase CLI authentication | PASS | `mjc.security01@gmail.com` |
| Active Firebase target | PASS | `securityprojectv1-staging` |
| Billing | BLOCKED | Spark plan; Blaze required |
| Firestore | BLOCKED | API returns HTTP 403 because it is disabled |
| Hosting site | PASS | `https://securityprojectv1-staging.web.app` |
| Hosting release | BLOCKED | Current site returns HTTP 404 |
| Functions | BLOCKED | Functions API unavailable |
| Storage | WARNING | Web SDK bucket configuration exists; live bucket/API state cannot be verified without authenticated gcloud |
| Secret Manager | BLOCKED | Blaze required before API/secret bootstrap |
| IAM | BLOCKED | gcloud owner authentication required |
| Cloud Build | BLOCKED | gcloud owner authentication and billing required |
| Artifact Registry | BLOCKED | gcloud owner authentication and billing required |
| Logging | BLOCKED | gcloud owner authentication required |
| Monitoring | BLOCKED | gcloud owner authentication required |
| Service accounts | BLOCKED | gcloud owner authentication required |
| App Hosting | NOT APPLICABLE | Vite SPA uses Hosting Classic |
| App Engine | WARNING | Not required by the current Gen 2 Functions architecture; remote state not verified |

## API Status

The recovery command is prepared to enable:

`firestore`, `cloudfunctions`, `firebase`, `serviceusage`, `secretmanager`,
`cloudbuild`, `artifactregistry`, `logging`, `monitoring`, `iam`,
`iamcredentials`, `cloudresourcemanager`, `run`, and `drive`.

Automatic enablement is BLOCKED until gcloud has an active owner account and
staging billing is linked. Firestore is confirmed disabled. Functions and
Secret Manager are not currently usable.

## Firestore

Creation automation uses `(default)`, Standard edition, Native Mode,
`asia-southeast3`, with deletion protection enabled. Creation, rules, indexes,
TTL inspection, and deployment remain BLOCKED because the API is disabled.

Local Firestore rules validation passed 8/8 tests using the emulator and the
workspace-local Java 21 runtime.

## Authentication Detection

Detected architecture: Email/Password.

Evidence: `src/firebase.ts` imports and uses
`signInWithEmailAndPassword` and `createUserWithEmailAndPassword`. Authentication
provider state in the remote project remains BLOCKED pending owner verification.
No authentication configuration was changed automatically.

## Hosting and Functions

The Hosting site and SPA rewrite configuration exist. No staging release is
live yet. Functions source builds and loads all seven exports in the local
emulator with the staging Functions region set to `asia-southeast1`; Functions tests pass 2/2. Remote deployment is
BLOCKED by billing, APIs, and secrets.

## Secret Manager and Google Drive

Required secret metadata checks cover:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`

`FIREBASE_PROJECT_ID` is intentionally not a Secret Manager secret. Firebase
Functions reserves the `FIREBASE_` prefix and the CLI rejects that key.
Infrastructure guards detect the active Firebase CLI project. Functions detect
the deployed project from `firebaseApp.options.projectId`, with the
platform-provided `GCLOUD_PROJECT` as fallback.

No secret value is read or logged. The Staging OAuth architecture is a Desktop
client using a loopback callback and offline authorization. The exact scope is
`https://www.googleapis.com/auth/drive`: the backend must read and write an
existing folder selected outside the application, and the repository contains
no Google Picker grant flow. The narrower `drive.file` scope therefore does not
cover the current integration.

`scripts/bootstrap-drive-oauth.mjs` prompts without echo, opens the loopback
authorization flow, stores the three OAuth values through Firebase CLI stdin,
validates enabled secret versions by metadata, and performs a synthetic
upload/read/delete without writing a credential file.

Secret creation and OAuth upload/read/metadata/delete tests remain BLOCKED
until the owner creates the Desktop OAuth client and runs the helper. The
staging-only Drive folder is
`Smart Guard – STAGING` with folder ID
`1WEiA9U1DONRYHgnoJL17bZqOYJoCKGjO`.

## Tooling

- Java: PASS — Temurin `21.0.11`
- gcloud: PASS — Google Cloud SDK `514.0.0`
- gcloud authentication: PASS — active staging owner account
- Firebase CLI: PASS — `15.24.0`
- Firebase emulator suite: PASS for rules and Functions test scopes

## Infrastructure Health

| Command | Result |
|---|---|
| `npm run validate:env` | BLOCKED — Measurement ID missing |
| `npm run audit:infra` | 21 PASS, 3 BLOCKED |
| `npm run predeploy:staging` | BLOCKED — three OAuth secrets |
| `npm run health` | 11 PASS, 6 BLOCKED, 0 FAIL |

## Deployment Readiness

**BLOCKED.** Billing, required infrastructure APIs, and Firestore now pass. Do
not deploy until Email/Password is enabled, all four Drive secrets exist, Drive
health passes, Measurement ID is configured, Hosting is built, and all four
health commands pass.

## Security, Performance, and Dependencies

- Production guardrails reject `securityprojectv1`.
- Secrets are backend-only and ignored local environment files are used.
- Firestore deletion protection is requested by bootstrap automation.
- Local JDK and gcloud files are ignored by Git.
- No schema or business workflow was changed by SPR-018.
- Emulator validation avoids consuming live staging resources.

The checkpoint is stored in `.infrastructure-checkpoint.json` with mode `0600`.
Resume with `npm run recover:infra`.
