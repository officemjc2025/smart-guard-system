import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  FIRESTORE_REGION,
  STAGING_PROJECT_ID,
  activeFirebaseProject,
  assertStagingProject,
  command,
  firebase,
  parseEnvFile,
  printJson,
  result,
} from './lib/infrastructure.mjs';

const env = parseEnvFile('.env.staging');
const configuredProjectId = String(env.VITE_FIREBASE_PROJECT_ID || '');
assertStagingProject(configuredProjectId, 'infrastructure recovery configuration');
const activeProject = activeFirebaseProject();
assertStagingProject(activeProject.projectId, 'infrastructure recovery');

const phases = [];
const actionsRequired = [];
const requiredApis = [
  'firestore.googleapis.com',
  'cloudfunctions.googleapis.com',
  'firebase.googleapis.com',
  'serviceusage.googleapis.com',
  'secretmanager.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'logging.googleapis.com',
  'monitoring.googleapis.com',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'run.googleapis.com',
  'drive.googleapis.com',
];

const firebaseProject = firebase(['projects:list', '--json']);
phases.push(result('firebase_project', firebaseProject.ok && activeProject.ok ? 'PASS' : 'BLOCKED', firebaseProject.ok && activeProject.ok ? activeProject.projectId : firebaseProject.stderr || firebaseProject.stdout || activeProject.stderr));

const gcloudAuth = command('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']);
const activeGcloudAccount = gcloudAuth.stdout.split(/\r?\n/).filter(Boolean).at(-1) || '';
if (!activeGcloudAccount) {
  phases.push(result('gcloud_authentication', 'BLOCKED', 'No active gcloud account.'));
  actionsRequired.push({
    step: 1,
    purpose: 'Authenticate the workspace-local Google Cloud CLI.',
    console_url: 'https://accounts.google.com/',
    required_button: 'Approve Google Cloud SDK access for the staging project owner.',
    expected_result: 'gcloud auth list shows one ACTIVE account.',
    verification: '. scripts/tool-env.sh && gcloud auth list',
    resume_command: 'npm run recover:infra',
    estimated_time: '3–5 minutes',
  });
} else {
  phases.push(result('gcloud_authentication', 'PASS', activeGcloudAccount));
  const setProject = command('gcloud', ['config', 'set', 'project', STAGING_PROJECT_ID]);
  phases.push(result('gcloud_project', setProject.ok ? 'PASS' : 'FAIL', setProject.ok ? STAGING_PROJECT_ID : setProject.stderr || setProject.stdout));
}

let billingEnabled = false;
if (activeGcloudAccount) {
  const billing = command('gcloud', ['billing', 'projects', 'describe', STAGING_PROJECT_ID, '--format=json']);
  if (billing.ok) {
    try {
      billingEnabled = JSON.parse(billing.stdout).billingEnabled === true;
    } catch {
      billingEnabled = false;
    }
  }
  phases.push(result('billing', billingEnabled ? 'PASS' : 'BLOCKED', billingEnabled ? 'Blaze billing linked' : billing.stderr || billing.stdout || 'Billing is not enabled.'));
}
if (!billingEnabled) {
  actionsRequired.push({
    step: 2,
    purpose: 'Link a billing account and upgrade staging to Blaze.',
    console_url: `https://console.firebase.google.com/project/${STAGING_PROJECT_ID}/usage/details`,
    required_button: 'Modify plan / Upgrade to Blaze',
    expected_result: 'The staging project displays Blaze (pay as you go).',
    verification: `. scripts/tool-env.sh && gcloud billing projects describe ${STAGING_PROJECT_ID}`,
    resume_command: 'npm run recover:infra',
    estimated_time: '3–10 minutes',
  });
}

if (activeGcloudAccount && billingEnabled) {
  const enableApis = command('gcloud', ['services', 'enable', ...requiredApis, '--project', STAGING_PROJECT_ID]);
  phases.push(result('required_apis', enableApis.ok ? 'PASS' : 'BLOCKED', enableApis.ok ? `${requiredApis.length} APIs enabled/verified` : enableApis.stderr || enableApis.stdout));
} else {
  phases.push(result('required_apis', 'BLOCKED', 'Requires active gcloud authentication and billing.'));
}

const firestore = firebase(['firestore:databases:list', '--project', STAGING_PROJECT_ID]);
const firestoreDatabaseExists =
  firestore.ok && !/No databases found/i.test(firestore.stdout);
if (!firestoreDatabaseExists) {
  const createFirestore = firebase([
    'firestore:databases:create',
    '(default)',
    '--edition',
    'standard',
    '--location',
    FIRESTORE_REGION,
    '--delete-protection',
    'ENABLED',
    '--project',
    STAGING_PROJECT_ID,
  ]);
  phases.push(result('firestore', createFirestore.ok ? 'PASS' : 'BLOCKED', createFirestore.ok ? `Standard database created in ${FIRESTORE_REGION}` : createFirestore.stderr || createFirestore.stdout));
} else {
  phases.push(result('firestore', 'PASS', firestore.stdout));
}

const hosting = firebase(['hosting:sites:list', '--project', STAGING_PROJECT_ID]);
phases.push(result('hosting_site', hosting.ok ? 'PASS' : 'BLOCKED', hosting.ok ? `https://${STAGING_PROJECT_ID}.web.app` : hosting.stderr || hosting.stdout));
const functions = firebase(['functions:list', '--project', STAGING_PROJECT_ID]);
phases.push(result('functions_api', functions.ok ? 'PASS' : 'BLOCKED', functions.ok ? 'Functions API accessible' : functions.stderr || functions.stdout));

const authSource = readFileSync('src/firebase.ts', 'utf8');
phases.push(result(
  'authentication_architecture',
  authSource.includes('signInWithEmailAndPassword') ? 'PASS' : 'FAIL',
  authSource.includes('signInWithEmailAndPassword') ? 'Email/Password' : 'Undetected',
));

const requiredSecrets = [
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_ROOT_FOLDER_ID',
];
const missingSecrets = [];
for (const secretName of requiredSecrets) {
  const metadata = firebase(['functions:secrets:get', secretName, '--project', STAGING_PROJECT_ID]);
  phases.push(result(`secret:${secretName}`, metadata.ok ? 'PASS' : 'BLOCKED', metadata.ok ? 'metadata present; value not read' : metadata.stderr || metadata.stdout));
  if (!metadata.ok) {
    missingSecrets.push(secretName);
  }
}
if (missingSecrets.length > 0) {
  actionsRequired.push({
    step: actionsRequired.length + 1,
    purpose: `Provision the Staging Desktop OAuth client and run the secure local bootstrap for: ${missingSecrets.join(', ')}. Never put secret values in command arguments, source, logs, or VITE variables.`,
    console_url: `https://console.cloud.google.com/auth/clients?project=${STAGING_PROJECT_ID}`,
    required_button: 'Create client → Desktop app, then run the local bootstrap and enter credentials only at its hidden prompts.',
    expected_result: 'Every required secret has an enabled latest version and the staging Drive synthetic test passes.',
    verification: `npx -y firebase-tools@latest functions:secrets:get GOOGLE_DRIVE_ROOT_FOLDER_ID --project ${STAGING_PROJECT_ID}`,
    resume_command: 'npm run bootstrap:drive-oauth && npm run recover:infra',
    estimated_time: '10–20 minutes',
  });
}

const java = command('java', ['-version']);
const gcloud = command('gcloud', ['--version']);
phases.push(result('java', java.ok ? 'PASS' : 'BLOCKED', java.ok ? java.stderr.split('\n')[0] : java.stderr));
phases.push(result('gcloud', gcloud.ok ? 'PASS' : 'BLOCKED', gcloud.ok ? gcloud.stdout.split('\n')[0] : gcloud.stderr));
phases.push(result('emulator_config', existsSync('firebase.json') && readFileSync('firebase.json', 'utf8').includes('"emulators"') ? 'PASS' : 'FAIL', 'firebase.json'));

const completedPhases = phases.filter(phase => phase.status === 'PASS').map(phase => phase.name);
const blockedPhases = phases.filter(phase => phase.status === 'BLOCKED').map(phase => phase.name);
const failedPhases = phases.filter(phase => phase.status === 'FAIL').map(phase => phase.name);
const checkpoint = {
  completedPhases,
  blockedPhases,
  failedPhases,
  pendingPhases: ['drive_live_validation', 'staging_deployment', 'smoke_e2e', 'backup_rollback'],
  currentEnvironment: 'STAGING',
  project: STAGING_PROJECT_ID,
  timestamp: new Date().toISOString(),
  resumePoint: blockedPhases[0] || failedPhases[0] || 'deployment_readiness',
  actionsRequired,
};
writeFileSync('.infrastructure-checkpoint.json', `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
printJson({
  event_type: 'infrastructure_recovery',
  project_id: STAGING_PROJECT_ID,
  phases,
  checkpoint,
  success: blockedPhases.length === 0 && failedPhases.length === 0,
});
process.exit(blockedPhases.length === 0 && failedPhases.length === 0 ? 0 : 1);
