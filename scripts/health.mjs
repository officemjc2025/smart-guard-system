import { existsSync, readFileSync } from 'node:fs';
import {
  FUNCTIONS_REGION,
  STAGING_PROJECT_ID,
  firebase,
  parseEnvFile,
  printJson,
  result,
} from './lib/infrastructure.mjs';

const env = parseEnvFile('.env.staging');
const checks = [];
const database = firebase(['firestore:databases:list', '--project', STAGING_PROJECT_ID]);
const functions = firebase(['functions:list', '--project', STAGING_PROJECT_ID]);
const indexes = firebase(['firestore:indexes', '--project', STAGING_PROJECT_ID]);
const hosting = firebase(['hosting:sites:list', '--project', STAGING_PROJECT_ID]);
const requiredHttpsFunctions = [
  'uploadVehicleEvidence',
  'uploadMediaToDrive',
  'archiveBatchToDrive',
  'listEligibleQueueOperators',
  'previewSiteDailyAnalyticsRebuild',
  'rebuildSiteDailyAnalytics',
];
const secretNames = [
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_ROOT_FOLDER_ID',
];

checks.push(result('firestore', database.ok ? 'PASS' : 'BLOCKED', database.ok ? 'database accessible' : database.stderr || database.stdout));
const missingHttpsFunctions = requiredHttpsFunctions.filter(functionName => !functions.stdout.includes(functionName));
checks.push(result(
  'https_and_callable_functions',
  functions.ok && missingHttpsFunctions.length === 0 ? 'PASS' : 'BLOCKED',
  functions.ok
    ? (missingHttpsFunctions.length === 0 ? 'all required HTTPS/callable functions are deployed' : `missing: ${missingHttpsFunctions.join(', ')}`)
    : functions.stderr || functions.stdout,
));
checks.push(result(
  'firestore_analytics_trigger',
  functions.ok && functions.stdout.includes('onVehicleSessionAnalyticsUpdate') ? 'PASS' : 'BLOCKED',
  functions.ok
    ? 'onVehicleSessionAnalyticsUpdate is not deployed'
    : functions.stderr || functions.stdout,
));
checks.push(result('indexes', indexes.ok ? 'PASS' : 'BLOCKED', indexes.ok ? 'index metadata accessible' : indexes.stderr || indexes.stdout));
checks.push(result('hosting_configuration', hosting.ok ? 'PASS' : 'BLOCKED', hosting.ok ? 'hosting site exists' : hosting.stderr || hosting.stdout));

for (const secretName of secretNames) {
  const metadata = firebase(['functions:secrets:get', secretName, '--project', STAGING_PROJECT_ID]);
  checks.push(result(`secret:${secretName}`, metadata.ok ? 'PASS' : 'BLOCKED', metadata.ok ? 'metadata present; value not read' : metadata.stderr || metadata.stdout));
}

checks.push(result('authentication', readFileSync('src/firebase.ts', 'utf8').includes('signInWithEmailAndPassword') ? 'PASS' : 'FAIL', 'Email/Password transport detected'));
checks.push(result('rules', existsSync('firestore.rules') && existsSync('storage.rules') ? 'PASS' : 'FAIL', 'local rules files'));
checks.push(result('analytics', readFileSync('functions/src/index.ts', 'utf8').includes('onVehicleSessionAnalyticsUpdate') ? 'PASS' : 'FAIL', 'trusted analytics function export'));
checks.push(result('trusted_metrics', readFileSync('functions/src/index.ts', 'utf8').includes('calculateTrustedQueueMetrics') ? 'PASS' : 'FAIL', 'trusted metrics implementation'));
checks.push(result('queue', existsSync('src/services/vehicleQueueService.ts') ? 'PASS' : 'FAIL', 'queue service source'));
checks.push(result('media_configuration', env.VITE_MEDIA_UPLOAD_URL?.startsWith('https://') ? 'PASS' : 'FAIL', String(env.VITE_MEDIA_UPLOAD_URL || '(missing)')));
checks.push(result('functions_region', env.VITE_FUNCTIONS_REGION === FUNCTIONS_REGION ? 'PASS' : 'FAIL', String(env.VITE_FUNCTIONS_REGION || '(missing)')));
checks.push(result('measurement_id', env.VITE_FIREBASE_MEASUREMENT_ID ? 'PASS' : 'BLOCKED', env.VITE_FIREBASE_MEASUREMENT_ID ? 'present' : 'missing'));

let hostingStatus = 'BLOCKED';
let hostingDetail = 'not checked';
try {
  const response = await fetch(`https://${STAGING_PROJECT_ID}.web.app`, { method: 'HEAD', redirect: 'follow' });
  hostingStatus = response.ok ? 'PASS' : 'BLOCKED';
  hostingDetail = `HTTP ${response.status}`;
} catch (error) {
  hostingDetail = error instanceof Error ? error.message : String(error);
}
checks.push(result('hosting_live', hostingStatus, hostingDetail));

const blocked = checks.filter(check => check.status === 'BLOCKED').length;
const failed = checks.filter(check => check.status === 'FAIL').length;
printJson({
  event_type: 'staging_health',
  project_id: STAGING_PROJECT_ID,
  generated_at: new Date().toISOString(),
  summary: { pass: checks.length - blocked - failed, blocked, fail: failed },
  checks,
  success: blocked === 0 && failed === 0,
});
process.exit(blocked === 0 && failed === 0 ? 0 : 1);
