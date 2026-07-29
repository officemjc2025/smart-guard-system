import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

const ANALYTICS_SCHEMA_VERSION = 1;
const ANALYTICS_TIMEZONE = 'Asia/Bangkok';

export function analyticsDateKey(date: Date, timezone = ANALYTICS_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function validAnalyticsRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00+07:00`);
  const end = new Date(`${endDate}T23:59:59.999+07:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
    throw new HttpsError('invalid-argument', 'Invalid analytics date range.');
  }
  const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  if (days > 31) throw new HttpsError('invalid-argument', 'Analytics rebuild range cannot exceed 31 days.');
  return { start, end };
}

export async function requireAnalyticsAdmin(
  firestore: admin.firestore.Firestore,
  request: CallableRequest<{ siteId: string }>,
) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required.');
  const profile = await firestore.collection('users').doc(request.auth.uid).get();
  if (!profile.exists || profile.get('status') !== 'Active' || profile.get('role') !== 'Admin') {
    throw new HttpsError('permission-denied', 'Admin role is required.');
  }
  const siteId = String(request.data.siteId || '').trim();
  if (!siteId || siteId !== String(profile.get('site_id') || 'site-01')) {
    throw new HttpsError('permission-denied', 'Cross-site analytics access is not allowed.');
  }
  return { uid: request.auth.uid, siteId };
}

export async function requireVehicleWorkflowActor(
  firestore: admin.firestore.Firestore,
  request: CallableRequest<{ sessionId: string; siteId: string; workflow: string }>,
) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required.');
  const profile = await firestore.collection('users').doc(request.auth.uid).get();
  const profileData = profile.data();
  if (!profile.exists || profileData?.status !== 'Active') {
    throw new HttpsError('permission-denied', 'Active account is required.');
  }
  const siteId = String(request.data.siteId || '').trim();
  const actorSiteId = String(profileData?.site_id || 'site-01');
  if (!siteId || siteId !== actorSiteId) {
    throw new HttpsError('permission-denied', 'Cross-site analytics access is not allowed.');
  }
  const role = String(profileData?.role || '');
  if (!['Guard', 'ShiftHead', 'Manager', 'Admin'].includes(role)) {
    throw new HttpsError('permission-denied', 'Vehicle workflow role is required.');
  }
  return { uid: request.auth.uid, siteId, role };
}

export async function applyAnalyticsContribution(
  firestore: admin.firestore.Firestore,
  sessionId: string,
  session: admin.firestore.DocumentData,
) {
  const siteId = String(session.site_id || '');
  if (!siteId) return { applied: false, reason: 'missing-site' };
  const metrics = session.queueMetrics && typeof session.queueMetrics === 'object' ? session.queueMetrics : {};
  const completedAt = metrics.completedAt instanceof admin.firestore.Timestamp
    ? metrics.completedAt : session.queueStatus === 'Completed' ? admin.firestore.Timestamp.now() : null;
  const createdAt = session.created_at instanceof admin.firestore.Timestamp ? session.created_at : null;
  const attribution = completedAt || createdAt;
  if (!attribution) return { applied: false, reason: 'missing-attribution' };
  const dateKey = analyticsDateKey(attribution.toDate());
  const dailyId = `${siteId}_${dateKey}`;
  const dailyRef = firestore.collection('siteAnalyticsDaily').doc(dailyId);
  const contributionRef = dailyRef.collection('contributions').doc(sessionId);
  let wrote = false;
  await firestore.runTransaction(async transaction => {
    const contribution = await transaction.get(contributionRef);
    const prior = contribution.data() || {};
    const countCreated = createdAt !== null
      && analyticsDateKey(createdAt.toDate()) === dateKey
      && prior.created_counted !== true;
    const countCompleted = Boolean(completedAt) && prior.completed_counted !== true;
    if (!countCreated && !countCompleted) return;
    const priority = String(session.priority || 'Normal').toLowerCase();
    transaction.set(dailyRef, {
      site_id: siteId, date_key: dateKey, timezone: ANALYTICS_TIMEZONE,
      schema_version: ANALYTICS_SCHEMA_VERSION,
      sessions_created: admin.firestore.FieldValue.increment(countCreated ? 1 : 0),
      sessions_completed: admin.firestore.FieldValue.increment(countCompleted ? 1 : 0),
      sessions_cancelled: admin.firestore.FieldValue.increment(countCompleted && session.status === 'Cancelled' ? 1 : 0),
      total_waiting_seconds: admin.firestore.FieldValue.increment(countCompleted ? Number(metrics.waitingSeconds || 0) : 0),
      total_working_seconds: admin.firestore.FieldValue.increment(countCompleted ? Number(metrics.workingSeconds || 0) : 0),
      total_cycle_seconds: admin.firestore.FieldValue.increment(countCompleted ? Number(metrics.totalCycleSeconds || 0) : 0),
      transfer_count: admin.firestore.FieldValue.increment(countCompleted ? Number(metrics.transferCount || 0) : 0),
      reassign_count: admin.firestore.FieldValue.increment(countCompleted ? Number(metrics.reassignCount || 0) : 0),
      release_count: admin.firestore.FieldValue.increment(countCompleted ? Number(metrics.releaseCount || 0) : 0),
      priority_change_count: admin.firestore.FieldValue.increment(countCompleted ? Number(metrics.priorityChangeCount || 0) : 0),
      [`priority_${['emergency', 'high', 'normal', 'low'].includes(priority) ? priority : 'normal'}_count`]:
        admin.firestore.FieldValue.increment(countCreated ? 1 : 0),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(contributionRef, {
      session_id: sessionId, site_id: siteId, date_key: dateKey,
      created_counted: prior.created_counted === true || countCreated,
      completed_counted: prior.completed_counted === true || countCompleted,
      waiting_seconds: countCompleted ? Math.max(0, Number(metrics.waitingSeconds || 0)) : Number(prior.waiting_seconds || 0),
      working_seconds: countCompleted ? Math.max(0, Number(metrics.workingSeconds || 0)) : Number(prior.working_seconds || 0),
      total_cycle_seconds: countCompleted ? Math.max(0, Number(metrics.totalCycleSeconds || 0)) : Number(prior.total_cycle_seconds || 0),
      schema_version: ANALYTICS_SCHEMA_VERSION,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    wrote = true;
  });
  return { applied: wrote, dateKey };
}

export async function applyVehicleSessionAnalytics(
  firestore: admin.firestore.Firestore,
  sessionId: string,
) {
  const startedAt = Date.now();
  const snapshot = await firestore.collection('vehicleSessions').doc(sessionId).get();
  if (!snapshot.exists) return { applied: false, reason: 'missing-session', durationMs: Date.now() - startedAt };
  const result = await applyAnalyticsContribution(firestore, sessionId, snapshot.data() || {});
  functions.logger.info('vehicle_session_analytics_service_completed', {
    session_id: sessionId,
    site_id: snapshot.get('site_id'),
    duration_ms: Date.now() - startedAt,
    applied: result.applied,
  });
  return { ...result, durationMs: Date.now() - startedAt };
}
