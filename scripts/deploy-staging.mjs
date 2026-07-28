import { spawnSync } from 'node:child_process';
import {
  STAGING_PROJECT_ID,
  activeFirebaseProject,
  assertStagingProject,
} from './lib/infrastructure.mjs';

const allowedTargets = new Set([
  'functions',
  'firestore:rules',
  'firestore:indexes',
  'hosting',
]);
const target = process.argv[2];
const environmentName = String(process.env.VITE_APP_ENV || '').toUpperCase();
const activeProject = activeFirebaseProject();
const configuredProject = activeProject.projectId;

if (!allowedTargets.has(target)) {
  throw new Error(`Unsupported staging deploy target: ${target || '(missing)'}`);
}
if (environmentName !== 'STAGING') {
  throw new Error('Refusing deployment: VITE_APP_ENV must be STAGING.');
}
if (!activeProject.ok) throw new Error(`Unable to detect active Firebase project: ${activeProject.stderr}`);
assertStagingProject(configuredProject, 'deployment');

console.log(JSON.stringify({
  event_type: 'staging_deploy_target',
  environment: environmentName,
  project_id: configuredProject,
  target,
}));

const predeploy = spawnSync(
  'node',
  ['scripts/predeploy-staging.mjs'],
  { stdio: 'inherit', shell: false },
);
if (predeploy.error) throw predeploy.error;
if (predeploy.status !== 0) {
  throw new Error('Staging pre-deploy validation failed. No deployment was attempted.');
}

const snapshotCommand = target === 'hosting'
  ? ['hosting:channel:list', '--site', STAGING_PROJECT_ID]
  : [target === 'functions' ? 'functions:list' : 'firestore:indexes'];
const snapshot = spawnSync(
  'npx',
  [
    '-y',
    'firebase-tools@latest',
    ...snapshotCommand,
    '--project',
    STAGING_PROJECT_ID,
  ],
  { stdio: 'inherit', shell: false },
);
if (snapshot.status !== 0) {
  throw new Error('Unable to record current staging resource version.');
}

const result = spawnSync(
  'npx',
  [
    '-y',
    'firebase-tools@latest',
    'deploy',
    '--only',
    target,
    '--project',
    STAGING_PROJECT_ID,
  ],
  { stdio: 'inherit', shell: false },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
