import { readFileSync } from 'node:fs';
import {
  FUNCTIONS_REGION,
  STAGING_PROJECT_ID,
  assertStagingProject,
  firebase,
  parseEnvFile,
  printJson,
  result,
} from './lib/infrastructure.mjs';

const env = parseEnvFile('.env.staging');
const projectId = String(env.VITE_FIREBASE_PROJECT_ID || '');
assertStagingProject(projectId, 'pre-deploy validation');
const checks = [];
const active = firebase(['use']);
const activeProjectId = active.stdout.split(/\r?\n/).at(-1)?.trim() || '';
const databases = firebase(['firestore:databases:list', '--project', STAGING_PROJECT_ID]);
const functions = firebase(['functions:list', '--project', STAGING_PROJECT_ID]);
const hosting = firebase(['hosting:sites:list', '--project', STAGING_PROJECT_ID]);
const functionSource = readFileSync('functions/src/index.ts', 'utf8');

checks.push(result('environment', env.VITE_APP_ENV === 'STAGING' ? 'PASS' : 'FAIL', String(env.VITE_APP_ENV || '(missing)')));
checks.push(result('target', activeProjectId === STAGING_PROJECT_ID ? 'PASS' : 'FAIL', activeProjectId || active.stderr));
checks.push(result('project', projectId === STAGING_PROJECT_ID ? 'PASS' : 'FAIL', projectId));
checks.push(result('region', env.VITE_FUNCTIONS_REGION === FUNCTIONS_REGION ? 'PASS' : 'FAIL', String(env.VITE_FUNCTIONS_REGION || '(missing)')));
checks.push(result('firestore', databases.ok ? 'PASS' : 'BLOCKED', databases.ok ? 'database accessible' : databases.stderr || databases.stdout));
checks.push(result('billing_functions_access', functions.ok ? 'PASS' : 'BLOCKED', functions.ok ? 'Functions API accessible' : functions.stderr || functions.stdout));
checks.push(result('hosting', hosting.ok ? 'PASS' : 'BLOCKED', hosting.ok ? 'site accessible' : hosting.stderr || hosting.stdout));
checks.push(result(
  'staging_cors',
  functionSource.includes(`https://${STAGING_PROJECT_ID}.web.app`) ? 'PASS' : 'FAIL',
  functionSource.includes(`https://${STAGING_PROJECT_ID}.web.app`) ? 'staging origin present' : 'staging origin absent from backend CORS',
));

for (const secretName of [
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_ROOT_FOLDER_ID',
]) {
  const metadata = firebase(['functions:secrets:get', secretName, '--project', STAGING_PROJECT_ID]);
  checks.push(result(`secret:${secretName}`, metadata.ok ? 'PASS' : 'BLOCKED', metadata.ok ? 'metadata present' : metadata.stderr || metadata.stdout));
}

const stopped = checks.some(check => check.status !== 'PASS');
printJson({ event_type: 'staging_predeploy', project_id: STAGING_PROJECT_ID, checks, success: !stopped });
process.exit(stopped ? 1 : 0);
