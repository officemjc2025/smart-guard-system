import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FUNCTIONS_REGION,
  PRODUCTION_PROJECT_ID,
  activeFirebaseProject,
  firebase,
  parseEnvFile,
  printJson,
  result,
} from './lib/infrastructure.mjs';

export const REQUIRED_PRODUCTION_ENV_KEYS = Object.freeze([
  'VITE_APP_ENV',
  'VITE_EXPECTED_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FUNCTIONS_REGION',
  'VITE_MEDIA_UPLOAD_URL',
  'VITE_DRIVE_INTEGRATION_MODE',
]);

export function productionEnvironmentChecks(env, envExists = true) {
  return [
    result('environment_file', envExists ? 'PASS' : 'FAIL', envExists ? '.env.production present' : '.env.production missing'),
    result('environment', env.VITE_APP_ENV === 'PRODUCTION' ? 'PASS' : 'FAIL', String(env.VITE_APP_ENV || '(missing)')),
    result('project', env.VITE_FIREBASE_PROJECT_ID === PRODUCTION_PROJECT_ID ? 'PASS' : 'FAIL', String(env.VITE_FIREBASE_PROJECT_ID || '(missing)')),
    result('expected_project', env.VITE_EXPECTED_FIREBASE_PROJECT_ID === PRODUCTION_PROJECT_ID ? 'PASS' : 'FAIL', env.VITE_EXPECTED_FIREBASE_PROJECT_ID ? 'configured' : '(missing)'),
    result('region', env.VITE_FUNCTIONS_REGION === FUNCTIONS_REGION ? 'PASS' : 'FAIL', String(env.VITE_FUNCTIONS_REGION || '(missing)')),
    result(
      'media_endpoint',
      env.VITE_MEDIA_UPLOAD_URL === `https://${FUNCTIONS_REGION}-${PRODUCTION_PROJECT_ID}.cloudfunctions.net/uploadVehicleEvidence` ? 'PASS' : 'FAIL',
      env.VITE_MEDIA_UPLOAD_URL ? 'configured endpoint does not match Production project/region' : '(missing)',
    ),
    result('oauth_mode', env.VITE_DRIVE_INTEGRATION_MODE === 'OAuth2User' ? 'PASS' : 'FAIL', env.VITE_DRIVE_INTEGRATION_MODE ? 'configured' : '(missing)'),
    ...REQUIRED_PRODUCTION_ENV_KEYS
      .filter(key => !String(env[key] || '').trim())
      .map(key => result(`env:${key}`, 'FAIL', 'required variable missing')),
  ];
}

async function main() {
  const envPath = '.env.production';
  const envExists = existsSync(envPath);
  const env = parseEnvFile(envPath);
  const checks = productionEnvironmentChecks(env, envExists);
  const active = activeFirebaseProject();
  checks.push(result('target', active.ok && active.projectId === PRODUCTION_PROJECT_ID ? 'PASS' : 'FAIL', active.projectId || active.stderr || '(missing)'));

  if (checks.some(check => check.status !== 'PASS')) {
    printJson({ event_type: 'production_predeploy', project_id: PRODUCTION_PROJECT_ID, checks, success: false });
    process.exitCode = 1;
    return;
  }

  const databases = firebase(['firestore:databases:list', '--project', PRODUCTION_PROJECT_ID]);
  const functions = firebase(['functions:list', '--project', PRODUCTION_PROJECT_ID]);
  const hosting = firebase(['hosting:sites:list', '--project', PRODUCTION_PROJECT_ID]);
  const functionSource = [
    readFileSync('functions/src/index.ts', 'utf8'),
    readFileSync('functions/src/vehicleEvidencePolicy.ts', 'utf8'),
  ].join('\n');
  checks.push(result('firestore', databases.ok ? 'PASS' : 'BLOCKED', databases.ok ? 'database accessible' : databases.stderr || databases.stdout));
  checks.push(result('billing_functions_access', functions.ok ? 'PASS' : 'BLOCKED', functions.ok ? 'Functions API accessible' : functions.stderr || functions.stdout));
  checks.push(result('hosting', hosting.ok ? 'PASS' : 'BLOCKED', hosting.ok ? 'site accessible' : hosting.stderr || hosting.stdout));
  checks.push(result(
    'production_cors',
    functionSource.includes(`https://${PRODUCTION_PROJECT_ID}.web.app`) ? 'PASS' : 'FAIL',
    functionSource.includes(`https://${PRODUCTION_PROJECT_ID}.web.app`) ? 'production origin present' : 'production origin absent from backend CORS',
  ));

  for (const secretName of [
    'GOOGLE_DRIVE_CLIENT_ID',
    'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_REFRESH_TOKEN',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
  ]) {
    const metadata = firebase(['functions:secrets:get', secretName, '--project', PRODUCTION_PROJECT_ID]);
    checks.push(result(`secret:${secretName}`, metadata.ok ? 'PASS' : 'BLOCKED', metadata.ok ? 'metadata present' : metadata.stderr || metadata.stdout));
  }

  const stopped = checks.some(check => check.status !== 'PASS');
  printJson({ event_type: 'production_predeploy', project_id: PRODUCTION_PROJECT_ID, checks, success: !stopped });
  process.exitCode = stopped ? 1 : 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main().catch(error => {
  printJson({ event_type: 'production_predeploy', project_id: PRODUCTION_PROJECT_ID, success: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
