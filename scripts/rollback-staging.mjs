import {
  STAGING_PROJECT_ID,
  activeFirebaseProject,
  assertStagingProject,
  printJson,
} from './lib/infrastructure.mjs';

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes(`--confirm=${STAGING_PROJECT_ID}`);
const startedAt = Date.now();
const activeProject = activeFirebaseProject();
if (!activeProject.ok) throw new Error(`Unable to detect active Firebase project: ${activeProject.stderr}`);
assertStagingProject(activeProject.projectId, 'rollback');
if (apply && !confirmed) throw new Error(`Rollback apply requires --confirm=${STAGING_PROJECT_ID}.`);

const required = [
  'STAGING_BACKUP_DIRECTORY',
  'STAGING_HOSTING_SOURCE_CHANNEL',
  'STAGING_FUNCTIONS_REVISION_PLAN',
];
const missing = required.filter(key => !process.env[key]);
printJson({
  event_type: 'staging_rollback',
  project_id: STAGING_PROJECT_ID,
  mode: apply ? 'apply' : 'dry-run',
  checklist: [
    'Validate backup manifest and project ID',
    'Clone saved Hosting channel to staging live',
    'Redeploy saved Functions source revision to staging',
    'Redeploy saved Firestore Rules and indexes',
    'Restore managed Firestore export only after explicit approval',
    'Run npm run health and staging verification',
  ],
  missing,
  recovery_time_ms: Date.now() - startedAt,
  success: false,
  status: apply ? 'BLOCKED: automated destructive restore requires complete revision inputs' : 'DRY_RUN',
});
process.exit(apply ? 1 : 0);
