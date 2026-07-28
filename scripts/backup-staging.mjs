import { mkdirSync, writeFileSync } from 'node:fs';
import { cpSync } from 'node:fs';
import {
  STAGING_PROJECT_ID,
  activeFirebaseProject,
  assertStagingProject,
  firebase,
  printJson,
} from './lib/infrastructure.mjs';

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes(`--confirm=${STAGING_PROJECT_ID}`);
const activeProject = activeFirebaseProject();
if (!activeProject.ok) throw new Error(`Unable to detect active Firebase project: ${activeProject.stderr}`);
assertStagingProject(activeProject.projectId, 'backup');
if (apply && !confirmed) throw new Error(`Backup apply requires --confirm=${STAGING_PROJECT_ID}.`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = `backups/staging/${stamp}`;
if (!apply) {
  printJson({
    event_type: 'staging_backup',
    project_id: STAGING_PROJECT_ID,
    mode: 'dry-run',
    planned: ['Firestore managed export', 'Hosting release metadata', 'Rules', 'Indexes', 'Functions list'],
    writes: 0,
  });
  process.exit(0);
}

const bucket = String(process.env.STAGING_BACKUP_BUCKET || '').trim();
if (!bucket || !bucket.includes(STAGING_PROJECT_ID)) {
  throw new Error('STAGING_BACKUP_BUCKET must be a staging-only gs:// bucket.');
}
mkdirSync(directory, { recursive: true });
cpSync('firestore.rules', `${directory}/firestore.rules`);
cpSync('firestore.indexes.json', `${directory}/firestore.indexes.json`);
cpSync('storage.rules', `${directory}/storage.rules`);
const functions = firebase(['functions:list', '--project', STAGING_PROJECT_ID, '--json']);
const hosting = firebase(['hosting:releases:list', '--project', STAGING_PROJECT_ID, '--json']);
writeFileSync(`${directory}/functions.json`, functions.stdout || functions.stderr);
writeFileSync(`${directory}/hosting.json`, hosting.stdout || hosting.stderr);
const firestoreExport = firebase([
  'firestore:export',
  `${bucket.replace(/\/$/, '')}/${stamp}`,
  '--project',
  STAGING_PROJECT_ID,
]);
printJson({
  event_type: 'staging_backup',
  project_id: STAGING_PROJECT_ID,
  mode: 'apply',
  directory,
  firestore_export: firestoreExport.ok ? 'PASS' : 'FAIL',
  success: firestoreExport.ok && functions.ok && hosting.ok,
});
process.exit(firestoreExport.ok && functions.ok && hosting.ok ? 0 : 1);
