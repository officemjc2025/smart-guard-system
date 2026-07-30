import { applicationDefault, getApps as getAdminApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { deleteApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { doc, getFirestore, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { randomBytes, scryptSync } from 'node:crypto';

const projectId = process.env.VITE_FIREBASE_PROJECT_ID || '';
if (projectId !== 'securityprojectv1-staging') {
  throw new Error(`Refusing to run outside securityprojectv1-staging; received ${projectId || '(empty)'}.`);
}

const runId = `codex-exit-${Date.now()}`;
let uid = '';
const siteId = `${runId}-site`;
const sessionId = `${runId}-session`;
const logId = `${runId}-log`;
const cardId = `${runId}-card`;
const activityId = `${runId}-activity`;
const auditId = `${runId}-audit`;
const historyId = `${runId}-history`;
const operatorName = 'Staging Vehicle Exit Guard';
const cardNumber = `EXIT-${Date.now()}`;
const username = `cx${Date.now().toString(36)}`;
const accountId = `account-${username}`;
const operatorId = `operator-${username}`;
const pin = '739184';
const pinSalt = randomBytes(16).toString('base64');
const pinHash = scryptSync(pin, pinSalt, 64).toString('base64');

const adminApp = getAdminApps()[0] || initializeAdminApp({
  credential: applicationDefault(),
  projectId,
});
const adminDb = getAdminFirestore(adminApp);
const adminAuth = getAdminAuth(adminApp);

const clientApp = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
}, runId);

const clientAuth = getAuth(clientApp);
const clientDb = getFirestore(clientApp);
const clientFunctions = getFunctions(clientApp, process.env.VITE_FUNCTIONS_REGION || 'us-central1');

const cleanup = async () => {
  await Promise.allSettled([
    adminDb.recursiveDelete(adminDb.doc(`vehicleSessions/${sessionId}`)),
    adminDb.doc(`vehicleLogs/${logId}`).delete(),
    adminDb.doc(`parkingCards/${cardId}`).delete(),
    adminDb.doc(`auditLogs/${auditId}`).delete(),
    adminDb.doc(`parkingCardHistory/${historyId}`).delete(),
    ...(uid ? [adminDb.doc(`users/${uid}`).delete()] : []),
    adminDb.doc(`accounts/${accountId}`).delete(),
    adminDb.doc(`operators/${operatorId}`).delete(),
    adminDb.doc(`operatorCredentials/${username}`).delete(),
    adminDb.doc(`operatorLoginAttempts/${username}`).delete(),
  ]);
  if (uid) {
    const loginAudits = await adminDb.collection('auditLogs')
      .where('record_id', '==', operatorId).get().catch(() => null);
    if (loginAudits) await Promise.allSettled(loginAudits.docs.map(item => item.ref.delete()));
    await adminAuth.deleteUser(uid).catch(() => undefined);
  }
  if (getApps().includes(clientApp)) await deleteApp(clientApp);
};

try {
  await Promise.all([
    adminDb.doc(`accounts/${accountId}`).set({
      account_id: accountId, username, role: 'Guard', site_id: siteId,
      status: 'Active', staging_test_fixture: true,
    }),
    adminDb.doc(`operators/${operatorId}`).set({
      operator_id: operatorId, account_id: accountId, username,
      operator_name: operatorName, role: 'Guard', shift: 'E2E', phone: '',
      site_id: siteId, status: 'Active', staging_test_fixture: true,
    }),
    adminDb.doc(`operatorCredentials/${username}`).set({
      username, operator_id: operatorId, account_id: accountId,
      algorithm: 'scrypt-v1', pin_salt: pinSalt, pin_hash: pinHash,
      status: 'Active', staging_test_fixture: true,
    }),
  ]);

  const anonymousCredential = await signInAnonymously(clientAuth);
  uid = anonymousCredential.user.uid;
  const verifyPin = httpsCallable<{ username: string; pin: string }, { profile: { auth_uid: string } }>(
    clientFunctions,
    'verifyOperatorPin',
  );
  const login = await verifyPin({ username, pin });
  if (login.data.profile.auth_uid !== uid) throw new Error('Callable returned a mismatched auth UID.');

  await Promise.all([
    adminDb.doc(`vehicleSessions/${sessionId}`).set({
      session_id: sessionId, site_id: siteId, parking_card_id: cardId,
      card_number: cardNumber, stage: 'Active', status: 'InProgress',
      opened_by: uid, current_owner: uid, last_updated_by: uid,
      assigned_to: uid, assignedTo: uid, assignedBy: uid,
      assignedAt: AdminTimestamp.now(), queueStatus: 'In Progress',
      priority: 'Normal', queuePosition: 1, assignmentVersion: 0,
      sessionVersion: 1, queueMetrics: {
        firstQueuedAt: null, firstAssignedAt: null, workStartedAt: null,
        readyAt: null, completedAt: null, waitingSeconds: 0, workingSeconds: 0,
        totalCycleSeconds: 0, transferCount: 0, reassignCount: 0,
        releaseCount: 0, priorityChangeCount: 0, lastTransitionAt: null,
        lastEventId: '', metricsVersion: 1,
      },
      last_activity_at: AdminTimestamp.now(), activity: [],
      vehicle_plate: 'TEST-EXIT', target_room: 'STAGING',
      vehicle_log_id: logId, created_at: AdminTimestamp.now(),
      updated_at: AdminTimestamp.now(),
    }),
    adminDb.doc(`vehicleLogs/${logId}`).set({
      log_id: logId, vehicle_session_id: sessionId, site_id: siteId,
      parking_card_id: cardId, card_number: cardNumber,
      vehicle_plate: 'TEST-EXIT', vehicle_type: 'Test',
      visitor_name: '', visitor_phone: '', target_room: 'STAGING',
      purpose: 'Rules test', entry_time: new Date().toISOString(),
      status: 'กำลังจอด', workflow_status: 'active',
      recorded_by: operatorName, operator_name: operatorName,
      operator_id: uid, account_uid: uid,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }),
    adminDb.doc(`parkingCards/${cardId}`).set({
      firestore_document_id: cardId, card_id: cardId, site_id: siteId,
      card_number: cardNumber, card_number_normalized: cardNumber,
      qr_code_value: cardNumber, qr_code_normalized: cardNumber,
      card_type: 'Temporary', status: 'InUse', status_normalized: 'InUse',
      current_vehicle_plate: 'TEST-EXIT', current_vehicle_log_id: logId,
      current_vehicle_session_id: '', created_at: AdminTimestamp.now(),
      updated_at: AdminTimestamp.now(),
    }),
  ]);

  await runTransaction(clientDb, async transaction => {
    const sessionReference = doc(clientDb, `vehicleSessions/${sessionId}`);
    const logReference = doc(clientDb, `vehicleLogs/${logId}`);
    const cardReference = doc(clientDb, `parkingCards/${cardId}`);
    await Promise.all([
      transaction.get(sessionReference),
      transaction.get(logReference),
      transaction.get(cardReference),
    ]);

    transaction.update(logReference, {
      status: 'ออกแล้ว', workflow_status: 'completed',
      exit_time: serverTimestamp(), updated_at: serverTimestamp(),
      exit_recorded_by: operatorName, exit_account_uid: uid,
      exit_operator_id: uid, exit_operator_name: operatorName,
      exit_role: 'Guard', exit_site_id: siteId, exit_note: '',
      abnormal_note: '', exit_plate_photo_url: '', exit_vehicle_photo_url: '',
    });
    transaction.update(cardReference, {
      status: 'Available', status_normalized: 'Available',
      current_vehicle_plate: '', current_vehicle_log_id: '',
      related_vehicle_log_id: logId, last_activity_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    transaction.set(doc(clientDb, `auditLogs/${auditId}`), {
      audit_id: auditId, operator_id: uid, account_uid: uid,
      operator_name: operatorName, user_name: operatorName, site_id: siteId,
      card_number: cardNumber, vehicle_log_id: logId,
      action: 'VehicleExitCompleted', module_name: 'ParkingCards',
      record_id: cardId, previous_state: 'InUse', new_state: 'Available',
      old_value: 'InUse', new_value: 'Available', reason: '',
      action_result: 'Success', timestamp: serverTimestamp(),
      created_at: new Date().toISOString(),
    });
    transaction.set(doc(clientDb, `parkingCardHistory/${historyId}`), {
      history_id: historyId, event_type: 'EXIT', parking_card_id: cardId,
      card_number: cardNumber, site_id: siteId, vehicle_log_id: logId,
      operator_id: uid, operator_name: operatorName,
      previous_state: 'InUse', new_state: 'Available', reason: '',
      action_result: 'Success', occurred_at: serverTimestamp(),
      created_at: serverTimestamp(),
    });
    transaction.update(sessionReference, {
      stage: 'Completed', status: 'Completed', queueStatus: 'Completed',
      current_owner: uid, sessionVersion: 2, last_updated_by: uid,
      last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
      'stage_updates.Completed': { updatedBy: uid, updatedAt: serverTimestamp() },
    });
    transaction.set(doc(clientDb, `vehicleSessions/${sessionId}/activities/${activityId}`), {
      activity_id: activityId, client_event_id: activityId,
      session_id: sessionId, action: 'VehicleExitCompleted',
      from_stage: 'Active', to_stage: 'Completed',
      from_status: 'InProgress', to_status: 'Completed',
      actor_uid: uid, actor_operator_id: uid, actor_name: operatorName,
      actor_role: 'Guard', site_id: siteId,
      details: { vehicle_log_id: logId },
      created_at: serverTimestamp(), schema_version: 1,
    });
  });

  console.log(JSON.stringify({
    project_id: projectId,
    result: 'PASS',
    transaction: 'completeVehicleExit',
    writes: 6,
  }));
} catch (reason) {
  const error = reason as { code?: string; message?: string };
  console.error(JSON.stringify({
    project_id: projectId,
    result: 'FAIL',
    transaction: 'completeVehicleExit',
    code: error.code || 'unknown',
    message: error.message || String(reason),
  }));
  process.exitCode = 1;
} finally {
  await cleanup();
}
