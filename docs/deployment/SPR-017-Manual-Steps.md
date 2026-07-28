# SPR-017 Manual Steps Remaining

All steps target `securityprojectv1-staging`. Never select
`securityprojectv1`.

## STEP 1 — Upgrade staging billing

- Console URL:
  https://console.firebase.google.com/project/securityprojectv1-staging/usage/details
- Reason: Cloud Functions and Secret Manager require Blaze billing.
- Expected button: **Modify plan** or **Upgrade**
- Expected result: Project shows **Blaze (pay as you go)**.
- Verification:
  `npx -y firebase-tools@latest functions:list --project securityprojectv1-staging`
  no longer reports that Blaze is required.

## STEP 2 — Install Google Cloud SDK

- Console/documentation URL: https://cloud.google.com/sdk/docs/install
- Reason: API, IAM, billing and logging bootstrap needs `gcloud`.
- Expected action: Install the macOS package and run `gcloud auth login`.
- Expected result: `gcloud --version` prints a version.
- Verification:
  `gcloud config set project securityprojectv1-staging`

## STEP 3 — Enable required staging APIs

- Console URL:
  https://console.cloud.google.com/apis/library?project=securityprojectv1-staging
- Reason: Firestore, Functions, IAM, builds, secrets, artifacts and logging are
  required.
- Expected button: **Enable**
- Exact CLI command after gcloud installation:

  ```bash
  gcloud services enable \
    firestore.googleapis.com \
    cloudfunctions.googleapis.com \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    secretmanager.googleapis.com \
    iam.googleapis.com \
    iamcredentials.googleapis.com \
    serviceusage.googleapis.com \
    artifactregistry.googleapis.com \
    logging.googleapis.com \
    drive.googleapis.com \
    --project securityprojectv1-staging
  ```

- Expected result: Every service reports `ENABLED`.
- Verification:
  `gcloud services list --enabled --project securityprojectv1-staging`

## STEP 4 — Create Firestore

- Console URL:
  https://console.firebase.google.com/project/securityprojectv1-staging/firestore
- Reason: Staging currently has no database.
- Expected button: **Create database**
- Select: Native mode / Standard edition / `asia-southeast3`.
- Exact CLI alternative:

  ```bash
  npx -y firebase-tools@latest firestore:databases:create '(default)' \
    --edition standard \
    --location asia-southeast3 \
    --delete-protection ENABLED \
    --project securityprojectv1-staging
  ```

- Expected result: `(default)` database is Ready with deletion protection.
- Verification:
  `npx -y firebase-tools@latest firestore:databases:get '(default)' --project securityprojectv1-staging`

## STEP 5 — Enable Email/Password Authentication

- Console URL:
  https://console.firebase.google.com/project/securityprojectv1-staging/authentication/providers
- Reason: Source code uses `signInWithEmailAndPassword` and
  `createUserWithEmailAndPassword`; it does not use Anonymous Auth.
- Expected action: **Add new provider** → **Email/Password** → **Enable**
- Expected result: Email/Password shows Enabled.
- Verification: Create and remove one synthetic staging user.

## STEP 6 — Configure staging Analytics

- Console URL:
  https://console.firebase.google.com/project/securityprojectv1-staging/settings/integrations
- Reason: `VITE_FIREBASE_MEASUREMENT_ID` is missing.
- Expected action: Link a staging-only Google Analytics property.
- Expected result: Web SDK configuration contains `measurementId`.
- Verification:

  ```bash
  npx -y firebase-tools@latest apps:sdkconfig WEB \
    1:1060612850170:web:7ec920db896647533ae443 \
    --project securityprojectv1-staging
  ```

  Copy only the returned Measurement ID into `.env.staging`.

## STEP 7 — Create staging Drive OAuth credentials

- Console URL:
  https://console.cloud.google.com/apis/credentials?project=securityprojectv1-staging
- Reason: Drive uploads must be owned by a dedicated human OAuth user.
- Expected action: Configure OAuth consent, then create **OAuth client ID**.
- Expected result: Client ID, client secret and refresh token belong only to
  the staging Drive owner and can access `Smart Guard – STAGING`.
- Verification: Do not paste credentials into source, VITE variables or logs.

## STEP 8 — Store secrets interactively

- Reason: Secrets must never appear in command history or repository files.
- Run each command and paste the requested value interactively:

  ```bash
  npx -y firebase-tools@latest functions:secrets:set GOOGLE_DRIVE_CLIENT_ID --project securityprojectv1-staging
  npx -y firebase-tools@latest functions:secrets:set GOOGLE_DRIVE_CLIENT_SECRET --project securityprojectv1-staging
  npx -y firebase-tools@latest functions:secrets:set GOOGLE_DRIVE_REFRESH_TOKEN --project securityprojectv1-staging
  npx -y firebase-tools@latest functions:secrets:set GOOGLE_DRIVE_ROOT_FOLDER_ID --project securityprojectv1-staging
  ```

- Root folder ID:
  `1WEiA9U1DONRYHgnoJL17bZqOYJoCKGjO`
- Expected result: Each secret has an enabled latest version.
- Verification:
  `npx -y firebase-tools@latest functions:secrets:get GOOGLE_DRIVE_ROOT_FOLDER_ID --project securityprojectv1-staging`

## STEP 9 — Install Java

- Download URL: https://adoptium.net/temurin/releases/?version=21
- Reason: Firestore Emulator requires Java.
- Expected action: Install Temurin JDK 21 for macOS.
- Expected result: `java -version` reports version 21.
- Verification: `npm run test:rules:emulator`

## STEP 10 — Re-run the automated gate

```bash
npm run validate:env
npm run audit:infra
npm run predeploy:staging
npm run health
```

Expected result: all checks PASS before any deploy command is run.
