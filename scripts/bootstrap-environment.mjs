import { existsSync } from 'node:fs';
import { applyPatch } from './lib/write-file-helper.mjs';
import { printJson } from './lib/infrastructure.mjs';

const templates = {
  '.env.development': `VITE_APP_ENV=DEVELOPMENT
VITE_EXPECTED_FIREBASE_PROJECT_ID=securityprojectv1-development
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=securityprojectv1-development.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=securityprojectv1-development
VITE_FIREBASE_STORAGE_BUCKET=securityprojectv1-development.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_FUNCTIONS_REGION=asia-southeast1
VITE_MEDIA_UPLOAD_URL=https://asia-southeast1-securityprojectv1-development.cloudfunctions.net/uploadVehicleEvidence
VITE_DRIVE_INTEGRATION_MODE=OAuth2User
`,
  '.env.production.example': `VITE_APP_ENV=PRODUCTION
VITE_EXPECTED_FIREBASE_PROJECT_ID=securityprojectv1
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=securityprojectv1.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=securityprojectv1
VITE_FIREBASE_STORAGE_BUCKET=securityprojectv1.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_FUNCTIONS_REGION=asia-southeast3
VITE_MEDIA_UPLOAD_URL=https://asia-southeast3-securityprojectv1.cloudfunctions.net/uploadVehicleEvidence
VITE_DRIVE_INTEGRATION_MODE=OAuth2User
`,
  '.env.test': `VITE_APP_ENV=DEVELOPMENT
VITE_EXPECTED_FIREBASE_PROJECT_ID=smart-guard-test
VITE_FIREBASE_API_KEY=test-api-key
VITE_FIREBASE_AUTH_DOMAIN=smart-guard-test.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=smart-guard-test
VITE_FIREBASE_STORAGE_BUCKET=smart-guard-test.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:test
VITE_FIREBASE_MEASUREMENT_ID=G-TEST000000
VITE_FUNCTIONS_REGION=asia-southeast1
VITE_MEDIA_UPLOAD_URL=https://example.invalid/uploadVehicleEvidence
VITE_DRIVE_INTEGRATION_MODE=OAuth2User
`,
};

const created = [];
const preserved = [];
for (const [path, content] of Object.entries(templates)) {
  if (existsSync(path)) {
    preserved.push(path);
    continue;
  }
  applyPatch(path, content);
  created.push(path);
}
printJson({ event_type: 'environment_bootstrap', created, preserved });
