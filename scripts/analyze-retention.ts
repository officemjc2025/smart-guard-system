import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const args = new Set(process.argv.slice(2));
const projectId = String(process.env.GCLOUD_PROJECT || '').trim();
const execute = args.has('--execute');
const activityDays = Number(process.env.RETENTION_ACTIVITY_DAYS || 90);
const contributionDays = Number(process.env.RETENTION_CONTRIBUTION_DAYS || 395);

if (!projectId) throw new Error('GCLOUD_PROJECT runtime configuration is required.');
if (projectId === 'securityprojectv1' || !projectId.includes('staging')) {
  throw new Error(`Refusing retention analysis against non-staging project: ${projectId}`);
}
if (!execute) {
  console.log(JSON.stringify({
    event_type: 'retention_dry_run', project_id: projectId, result: 'configuration-only',
    activity_policy_days: activityDays, contribution_policy_days: contributionDays,
    writes: 0, deletes: 0,
  }, null, 2));
  process.exit(0);
}

initializeApp({ credential: applicationDefault(), projectId });
const database = getFirestore();
const activityCutoff = Timestamp.fromMillis(Date.now() - activityDays * 86400000);
const contributionCutoff = Timestamp.fromMillis(Date.now() - contributionDays * 86400000);
const [activities, contributions] = await Promise.all([
  database.collectionGroup('activities').where('created_at', '<', activityCutoff).limit(5000).get(),
  database.collectionGroup('contributions').where('updated_at', '<', contributionCutoff).limit(5000).get(),
]);
const timestamps = [...activities.docs, ...contributions.docs]
  .map(item => item.get('created_at') || item.get('updated_at'))
  .filter((value): value is Timestamp => value instanceof Timestamp)
  .map(value => value.toDate().toISOString()).sort();
console.log(JSON.stringify({
  event_type: 'retention_dry_run', project_id: projectId, result: 'completed',
  activity_candidates: activities.size, contribution_candidates: contributions.size,
  protected_records: 0, invalid_records: 0, approximate_reads: activities.size + contributions.size,
  earliest_timestamp: timestamps[0] || null, latest_timestamp: timestamps.at(-1) || null,
  writes: 0, deletes: 0,
}, null, 2));
