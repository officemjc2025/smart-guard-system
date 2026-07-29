import { STAGING_PROJECT_ID, firebase, printJson, result } from './lib/infrastructure.mjs';

const functions = firebase(['functions:list', '--project', STAGING_PROJECT_ID]);
const database = firebase(['firestore:databases:list', '--project', STAGING_PROJECT_ID]);
const deployed = functions.ok && functions.stdout.includes('uploadVehicleEvidence') && database.ok;
const scenarios = [
  'login',
  'dashboard',
  'vehicle',
  'queue',
  'analytics',
  'drive',
  'audit',
  'single_guard',
  'concurrent_guard',
  'transfer',
  'waiting_information',
  'offline',
  'cross_site',
  'inactive_user',
  'trusted_metrics',
  'cross_midnight',
  'browser_notification',
  'mobile',
].map(name => result(
  name,
  deployed ? 'WARNING' : 'BLOCKED',
  deployed ? 'Requires authenticated browser fixture implementation.' : 'Staging backend is not deployed.',
));

printJson({
  event_type: 'staging_verification',
  project_id: STAGING_PROJECT_ID,
  scenarios,
  success: scenarios.every(scenario => scenario.status === 'PASS'),
});
process.exit(1);
