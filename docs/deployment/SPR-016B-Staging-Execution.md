# SPR-016B Staging Execution

Execution date: 2026-07-25.

## Provisioned

- Firebase project: `securityprojectv1-staging`
- Project number: `1060612850170`
- Hosting site reservation: `securityprojectv1-staging`
- Web app: `1:1060612850170:web:7ec920db896647533ae443`
- Active local Firebase alias: `staging`
- Dedicated Drive folder: `Smart Guard – STAGING`
- Drive folder ID: `1WEiA9U1DONRYHgnoJL17bZqOYJoCKGjO`

## Safety controls

- Aliases: `production` and `staging`
- All deploy scripts require `VITE_APP_ENV=STAGING`
- All deploy scripts use explicit `--project securityprojectv1-staging`
- Production project ID is rejected
- Seed requires the exact staging project, `--apply`, and an explicit
  `--confirm=securityprojectv1-staging`

## Blockers

1. Enable `firestore.googleapis.com` for `securityprojectv1-staging`, then create
   the Standard `(default)` database in `asia-southeast3` with deletion
   protection.
2. Install a supported Java runtime so Firestore Emulator tests can run.
3. Configure staging-only OAuth secrets:
   `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
   `GOOGLE_DRIVE_REFRESH_TOKEN`, and the created staging folder ID as
   `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
4. Enable the Authentication provider that matches the application. The current
   application uses Firebase Email/Password internally; the sprint document's
   Anonymous Auth statement conflicts with the implemented transport and must
   be resolved before seed apply.
5. Confirm billing/Blaze availability before Functions deployment.

No Functions, Rules, indexes, or Hosting resources were deployed because the
mandatory pre-deployment gate is incomplete.
