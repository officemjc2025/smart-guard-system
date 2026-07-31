# SPR-018 Manual Steps Remaining

Every step targets `securityprojectv1-staging`. Never select
`securityprojectv1`.

## STEP 1

Purpose  
Authenticate the workspace-local Google Cloud CLI with the staging project
owner. Run `. scripts/tool-env.sh && gcloud auth login --no-launch-browser`,
then complete the displayed browser approval.

Console URL  
https://accounts.google.com/

Required Button  
Approve Google Cloud SDK access.

Expected Result  
One account is reported as ACTIVE.

Verification  
`. scripts/tool-env.sh && gcloud auth list`

Resume Command  
`npm run recover:infra`

Estimated Time  
3–5 minutes

## STEP 2

Purpose  
Link billing and upgrade only the staging project to Blaze.

Console URL  
https://console.firebase.google.com/project/securityprojectv1-staging/usage/details

Required Button  
Modify plan / Upgrade to Blaze.

Expected Result  
The staging project displays Blaze (pay as you go).

Verification  
`. scripts/tool-env.sh && gcloud billing projects describe securityprojectv1-staging`

Resume Command  
`npm run recover:infra`

Estimated Time  
3–10 minutes

## STEP 3

Purpose  
Enable Email/Password Authentication after infrastructure bootstrap.

Console URL  
https://console.firebase.google.com/project/securityprojectv1-staging/authentication/providers

Required Button  
Add new provider → Email/Password → Enable → Save.

Expected Result  
Email/Password is shown as Enabled.

Verification  
Create, sign in, and remove one synthetic staging-only user.

Resume Command  
`npm run recover:infra`

Estimated Time  
2–5 minutes

## STEP 4

Purpose  
Link a staging-only Analytics property and obtain the Measurement ID.

Console URL  
https://console.firebase.google.com/project/securityprojectv1-staging/settings/integrations

Required Button  
Link under Google Analytics.

Expected Result  
The staging Web SDK configuration includes a `measurementId`.

Verification  
`npx -y firebase-tools@latest apps:sdkconfig WEB 1:1060612850170:web:7ec920db896647533ae443 --project securityprojectv1-staging`

Resume Command  
Add only the returned Measurement ID to `.env.staging`, then run
`npm run validate:env`.

Estimated Time  
3–10 minutes

## STEP 5

Purpose  
Configure the Staging Google Auth Platform, create a Desktop OAuth client, and
run the secure loopback bootstrap.

Console URL  
https://console.cloud.google.com/auth/overview?project=securityprojectv1-staging

Required Button  
1. Open Branding and set app name to `Smart Guard Staging Drive`.
2. Open Audience and choose Internal only if the Drive owner belongs to the
   same Google Workspace organization; otherwise choose External.
3. When External remains in Testing, add the staging Drive owner as a test user.
4. Open Clients → Create client → Desktop app.
5. Set client name to `Smart Guard Staging Drive Desktop`.
6. Do not configure a hosted redirect URI; the local helper uses the Desktop
   loopback callback.

Values to Enter  
App name: `Smart Guard Staging Drive`  
Client type: Desktop app  
Client name: `Smart Guard Staging Drive Desktop`  
OAuth scope: `https://www.googleapis.com/auth/drive`

Sensitive Values  
Enter the Client ID and Client Secret only into the hidden local prompts from
`npm run bootstrap:drive-oauth`. Complete browser consent using only the account
with write access to `Smart Guard – STAGING`. Never paste credentials into
chat, source, Markdown, `.env`, or command arguments.

Expected Result  
The Drive owner can access `Smart Guard – STAGING`; enabled secret versions
exist for `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
`GOOGLE_DRIVE_REFRESH_TOKEN`, and `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Synthetic
upload, read, and delete all pass.

Verification  
`npx -y firebase-tools@latest functions:secrets:get GOOGLE_DRIVE_ROOT_FOLDER_ID --project securityprojectv1-staging`

Resume Command  
`npm run bootstrap:drive-oauth && npm run recover:infra`

Estimated Time  
10–20 minutes

## STEP 6

Purpose  
Resume automated API enablement, Firestore bootstrap, verification, and release
gates after Steps 1–5.

Console URL  
https://console.cloud.google.com/apis/dashboard?project=securityprojectv1-staging

Required Button  
No button when `npm run recover:infra` succeeds; use Enable only for an API
explicitly reported BLOCKED.

Expected Result  
The checkpoint contains no blocked or failed phases.

Verification  
Run `npm run validate:env`, `npm run audit:infra`,
`npm run predeploy:staging`, and `npm run health`; all must PASS.

Resume Command  
`npm run recover:infra`

Estimated Time  
5–15 minutes plus API propagation time
