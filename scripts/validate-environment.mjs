import {
  FUNCTIONS_REGION,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  parseEnvFile,
  printJson,
  result,
} from './lib/infrastructure.mjs';

const path = process.argv[2] || '.env.staging';
const env = parseEnvFile(path);
const environment = String(env.VITE_APP_ENV || '').toUpperCase();
const projectId = String(env.VITE_FIREBASE_PROJECT_ID || '');
const expectedProjectId = String(env.VITE_EXPECTED_FIREBASE_PROJECT_ID || '');
const checks = [];

for (const key of [
  'VITE_APP_ENV',
  'VITE_EXPECTED_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
  'VITE_FUNCTIONS_REGION',
  'VITE_MEDIA_UPLOAD_URL',
  'VITE_DRIVE_INTEGRATION_MODE',
]) {
  checks.push(result(key, env[key] ? 'PASS' : 'FAIL', env[key] ? 'present' : 'missing'));
}

checks.push(result(
  'project_match',
  projectId && projectId === expectedProjectId ? 'PASS' : 'FAIL',
  `${projectId || '(missing)'} / ${expectedProjectId || '(missing)'}`,
));
checks.push(result(
  'staging_isolation',
  environment !== 'STAGING' || (projectId === STAGING_PROJECT_ID && projectId !== PRODUCTION_PROJECT_ID)
    ? 'PASS' : 'FAIL',
  `${environment}:${projectId}`,
));
checks.push(result(
  'functions_region',
  environment !== 'STAGING' || env.VITE_FUNCTIONS_REGION === FUNCTIONS_REGION ? 'PASS' : 'FAIL',
  String(env.VITE_FUNCTIONS_REGION || '(missing)'),
));
let mediaStatus = 'FAIL';
try {
  const url = new URL(String(env.VITE_MEDIA_UPLOAD_URL || ''));
  mediaStatus = url.protocol === 'https:' && url.hostname.includes(projectId) ? 'PASS' : 'FAIL';
} catch {
  mediaStatus = 'FAIL';
}
checks.push(result('media_endpoint', mediaStatus, String(env.VITE_MEDIA_UPLOAD_URL || '(missing)')));
checks.push(result(
  'oauth_mode',
  env.VITE_DRIVE_INTEGRATION_MODE === 'OAuth2User' ? 'PASS' : 'FAIL',
  String(env.VITE_DRIVE_INTEGRATION_MODE || '(missing)'),
));

const failed = checks.filter(check => check.status === 'FAIL');
printJson({ event_type: 'environment_validation', path, environment, project_id: projectId, checks, success: failed.length === 0 });
process.exit(failed.length === 0 ? 0 : 1);
