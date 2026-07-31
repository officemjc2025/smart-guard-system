import { existsSync, readFileSync } from 'node:fs';
import {
  FUNCTIONS_REGION,
  STAGING_PROJECT_ID,
  command,
  firebase,
  parseEnvFile,
  printJson,
  result,
} from './lib/infrastructure.mjs';

const checks = [];
const node = command('node', ['--version']);
const npm = command('npm', ['--version']);
const java = command('java', ['-version']);
const gcloud = command('gcloud', ['--version']);
const firebaseVersion = firebase(['--version']);
const firebaseLogin = firebase(['login:list']);
const activeProject = firebase(['use']);
const activeProjectId = activeProject.stdout.split(/\r?\n/).at(-1)?.trim() || '';
const databases = firebase(['firestore:databases:list', '--project', STAGING_PROJECT_ID]);
const functions = firebase(['functions:list', '--project', STAGING_PROJECT_ID]);
const indexes = firebase(['firestore:indexes', '--project', STAGING_PROJECT_ID]);
const hosting = firebase(['hosting:sites:list', '--project', STAGING_PROJECT_ID]);

checks.push(result('node', node.ok ? 'PASS' : 'FAIL', node.stdout || node.stderr));
checks.push(result('npm', npm.ok ? 'PASS' : 'FAIL', npm.stdout || npm.stderr));
checks.push(result('java', java.ok ? 'PASS' : 'BLOCKED', java.ok ? java.stderr : 'Java runtime is not installed.'));
checks.push(result('google_cloud_sdk', gcloud.ok ? 'PASS' : 'BLOCKED', gcloud.ok ? gcloud.stdout.split('\n')[0] : 'gcloud command is unavailable.'));
checks.push(result('firebase_cli', firebaseVersion.ok ? 'PASS' : 'FAIL', firebaseVersion.stdout || firebaseVersion.stderr));
checks.push(result('firebase_authentication', firebaseLogin.ok ? 'PASS' : 'BLOCKED', firebaseLogin.stdout || firebaseLogin.stderr));
checks.push(result('active_project', activeProjectId === STAGING_PROJECT_ID ? 'PASS' : 'FAIL', activeProjectId || activeProject.stderr));
checks.push(result('firestore', databases.ok ? 'PASS' : 'BLOCKED', databases.ok ? databases.stdout : databases.stderr || databases.stdout));
checks.push(result('functions', functions.ok ? 'PASS' : 'BLOCKED', functions.ok ? functions.stdout : functions.stderr || functions.stdout));
checks.push(result('indexes', indexes.ok ? 'PASS' : 'BLOCKED', indexes.ok ? indexes.stdout : indexes.stderr || indexes.stdout));
checks.push(result('hosting', hosting.ok ? 'PASS' : 'BLOCKED', hosting.ok ? hosting.stdout : hosting.stderr));
for (const secretName of [
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_ROOT_FOLDER_ID',
]) {
  const secret = firebase(['functions:secrets:get', secretName, '--project', STAGING_PROJECT_ID]);
  checks.push(result(`secret:${secretName}`, secret.ok ? 'PASS' : 'BLOCKED', secret.ok ? 'metadata accessible; value not read' : secret.stderr || secret.stdout));
}

for (const path of ['firebase.json', '.firebaserc', 'firestore.rules', 'firestore.indexes.json', 'storage.rules']) {
  checks.push(result(path, existsSync(path) ? 'PASS' : 'FAIL', existsSync(path) ? 'present' : 'missing'));
}
const firebaseJson = JSON.parse(readFileSync('firebase.json', 'utf8'));
checks.push(result('emulator_configuration', firebaseJson.emulators ? 'PASS' : 'FAIL', firebaseJson.emulators ? 'configured' : 'missing'));
checks.push(result('app_hosting_configuration', existsSync('apphosting.yaml') ? 'WARNING' : 'PASS', existsSync('apphosting.yaml') ? 'present' : 'not applicable: Vite SPA uses Firebase Hosting Classic'));

const firebaseSource = readFileSync('src/firebase.ts', 'utf8');
checks.push(result(
  'authentication_architecture',
  firebaseSource.includes('signInWithEmailAndPassword') ? 'PASS' : 'FAIL',
  firebaseSource.includes('signInWithEmailAndPassword') ? 'Email/Password detected' : 'No supported sign-in transport detected',
));

const env = parseEnvFile('.env.staging');
checks.push(result('configured_region', env.VITE_FUNCTIONS_REGION === FUNCTIONS_REGION ? 'PASS' : 'FAIL', String(env.VITE_FUNCTIONS_REGION || '(missing)')));

const counts = checks.reduce((summary, check) => {
  summary[check.status] = (summary[check.status] || 0) + 1;
  return summary;
}, {});
printJson({ event_type: 'infrastructure_audit', project_id: STAGING_PROJECT_ID, counts, checks });
process.exit(checks.some(check => check.status === 'FAIL') ? 1 : 0);
