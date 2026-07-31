import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const projectId = 'securityprojectv1-staging';
let environment: RulesTestEnvironment;

const emptyMetrics = {
  firstQueuedAt: null, firstAssignedAt: null, workStartedAt: null,
  readyAt: null, completedAt: null, waitingSeconds: 0, workingSeconds: 0,
  totalCycleSeconds: 0, transferCount: 0, reassignCount: 0, releaseCount: 0,
  priorityChangeCount: 0, lastTransitionAt: null, lastEventId: '', metricsVersion: 1,
};

const session = (id: string, assignedTo = 'guard-a') => ({
  session_id: id, site_id: 'site-a', parking_card_id: 'card-a', card_number: 'CARD-A',
  stage: 'CardIssued', status: 'Pending', opened_by: 'guard-a',
  current_owner: assignedTo, last_updated_by: assignedTo,
  assigned_to: assignedTo, assignedTo, assignedBy: assignedTo,
  assignedAt: Timestamp.now(), queueStatus: 'Assigned', priority: 'Normal',
  queuePosition: 1, assignmentVersion: 0, sessionVersion: 1,
  queueMetrics: emptyMetrics, last_activity_at: Timestamp.now(),
  activity: [], created_at: Timestamp.now(), updated_at: Timestamp.now(),
});

const seedAvailableCard = async (documentId: string, cardNumber: string, siteId = 'site-a') => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `parkingCards/${documentId}`), {
      firestore_document_id: documentId, card_id: documentId, site_id: siteId,
      card_number: cardNumber, card_number_normalized: cardNumber,
      qr_code_value: cardNumber, qr_code_normalized: cardNumber,
      card_type: 'Temporary', status: 'Available', status_normalized: 'Available',
      created_at: Timestamp.now(), updated_at: Timestamp.now(),
    });
  });
};

const createVehicleSessionTransaction = (
  database: ReturnType<RulesTestContext['firestore']>,
  input: { uid: string; operatorName: string; role: string; siteId: string; suffix: string },
) => runTransaction(database, async transaction => {
  const cardId = `card-${input.suffix}`;
  const cardNumber = `CARD-${input.suffix.toUpperCase()}`;
  const sessionId = `session-${input.suffix}`;
  const eventId = `event-${input.suffix}`;
  const cardReference = doc(database, `parkingCards/${cardId}`);
  await transaction.get(cardReference);
  transaction.set(doc(database, `vehicleSessions/${sessionId}`), {
    session_id: sessionId, site_id: input.siteId, parking_card_id: cardId,
    card_number: cardNumber, stage: 'CardIssued', status: 'Pending',
    opened_by: input.uid, opened_by_name: input.operatorName, current_owner: input.uid,
    last_updated_by: input.uid, assigned_to: input.uid, assignedTo: input.uid,
    assignedBy: input.uid, assignedAt: serverTimestamp(), queueStatus: 'Assigned',
    priority: 'Normal', queuePosition: 1, assignmentVersion: 0,
    queueSchemaVersion: 1, sessionVersion: 1,
    queueMetrics: {
      ...emptyMetrics, firstQueuedAt: Timestamp.now(), firstAssignedAt: Timestamp.now(),
      lastTransitionAt: Timestamp.now(), lastEventId: eventId, metricsVersion: 2,
    },
    last_activity_at: serverTimestamp(), activity: [],
    stage_updates: { CardIssued: { updatedBy: input.uid, updatedAt: serverTimestamp() } },
    created_at: serverTimestamp(), updated_at: serverTimestamp(),
  });
  transaction.set(doc(database, `vehicleSessions/${sessionId}/activities/${eventId}`), {
    activity_id: eventId, client_event_id: eventId, session_id: sessionId,
    action: 'SessionCreatedFromQr', from_stage: '', to_stage: 'CardIssued',
    from_status: '', to_status: 'Pending', actor_uid: input.uid,
    actor_operator_id: input.uid, actor_name: input.operatorName, actor_role: input.role,
    site_id: input.siteId, details: {}, created_at: serverTimestamp(), schema_version: 1,
  });
  transaction.update(cardReference, {
    status: 'Reserved', status_normalized: 'Reserved',
    current_vehicle_session_id: sessionId,
    last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
  });
  transaction.set(doc(database, `auditLogs/audit-${input.suffix}`), {
    audit_id: `audit-${input.suffix}`, module_name: 'VehicleSessions', record_id: sessionId,
    action: 'Created->CardIssued', operator_id: input.uid, account_uid: input.uid,
    site_id: input.siteId, created_at: serverTimestamp(),
  });
});

const saveVehicleEntryEvidenceTransaction = (
  database: ReturnType<RulesTestContext['firestore']>,
  input: { uid: string; operatorName: string; role: string; sessionId?: string },
) => runTransaction(database, async transaction => {
  const sessionId = input.sessionId ?? 'session-a';
  const sessionReference = doc(database, `vehicleSessions/${sessionId}`);
  const snapshot = await transaction.get(sessionReference);
  const eventId = `ready-${input.uid}`;
  transaction.update(sessionReference, {
    vehicle_plate: '1กข1234',
    vehicle_type: 'รถยนต์',
    visitor_name: 'Visitor',
    visitor_phone: '',
    target_room: 'A-101',
    purpose: 'Visit',
    note: '',
    entry_plate_photo_url: 'https://storage.example.test/plate.jpg',
    entry_vehicle_photo_url: 'https://storage.example.test/vehicle.jpg',
    stage: 'Ready',
    status: 'Ready',
    queueStatus: 'Ready',
    last_updated_by: input.uid,
    sessionVersion: snapshot.get('sessionVersion') + 1,
    last_activity_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    'stage_updates.Ready': { updatedBy: input.uid, updatedAt: serverTimestamp() },
  });
  transaction.set(doc(database, `vehicleSessions/${sessionId}/activities/${eventId}`), {
    activity_id: eventId,
    client_event_id: eventId,
    session_id: sessionId,
    action: 'QueueStatusChange',
    from_stage: 'CardIssued',
    to_stage: 'Ready',
    from_status: 'Pending',
    to_status: 'Ready',
    actor_uid: input.uid,
    actor_operator_id: input.uid,
    actor_name: input.operatorName,
    actor_role: input.role,
    site_id: 'site-a',
    details: { queue_status: 'Ready' },
    created_at: serverTimestamp(),
    schema_version: 1,
  });
  transaction.set(doc(database, `auditLogs/audit-ready-${input.uid}`), {
    audit_id: `audit-ready-${input.uid}`,
    module_name: 'VehicleSessions',
    record_id: sessionId,
    action: 'Stage:Ready',
    operator_id: input.uid,
    account_uid: input.uid,
    site_id: 'site-a',
    created_at: serverTimestamp(),
  });
});

const completeVehicleExitTransaction = (
  database: ReturnType<RulesTestContext['firestore']>,
  input: {
    uid: string;
    operatorName: string;
    role: string;
    suffix: string;
    lostCard?: boolean;
  },
) => runTransaction(database, async transaction => {
  const sessionId = `exit-session-${input.suffix}`;
  const logId = `exit-log-${input.suffix}`;
  const cardId = `exit-card-${input.suffix}`;
  const cardNumber = `EXIT-${input.suffix.toUpperCase()}`;
  const eventId = `exit-event-${input.suffix}`;
  const nextCardStatus = input.lostCard ? 'Lost' : 'Available';
  const sessionReference = doc(database, `vehicleSessions/${sessionId}`);
  const logReference = doc(database, `vehicleLogs/${logId}`);
  const cardReference = doc(database, `parkingCards/${cardId}`);
  const [sessionSnapshot] = await Promise.all([
    transaction.get(sessionReference),
    transaction.get(logReference),
    transaction.get(cardReference),
  ]);

  transaction.update(logReference, {
    status: 'ออกแล้ว', workflow_status: 'completed',
    exit_time: serverTimestamp(), updated_at: serverTimestamp(),
    exit_recorded_by: input.operatorName, exit_account_uid: input.uid,
    exit_operator_id: input.uid, exit_operator_name: input.operatorName,
    exit_role: input.role, exit_site_id: 'site-a', exit_note: '',
    abnormal_note: '', exit_plate_photo_url: '', exit_vehicle_photo_url: '',
  });
  transaction.update(cardReference, {
    status: nextCardStatus, status_normalized: nextCardStatus,
    current_vehicle_plate: '', current_vehicle_log_id: '',
    related_vehicle_log_id: logId, last_activity_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    ...(input.lostCard ? {
      lost_at: serverTimestamp(), lost_reason: 'Card not returned',
      reported_by: input.operatorName, reported_by_account_uid: input.uid,
    } : {}),
  });
  transaction.set(doc(database, `auditLogs/exit-audit-${input.suffix}`), {
    audit_id: `exit-audit-${input.suffix}`, operator_id: input.uid,
    account_uid: input.uid, operator_name: input.operatorName,
    user_name: input.operatorName, site_id: 'site-a', card_number: cardNumber,
    vehicle_log_id: logId,
    action: input.lostCard ? 'VehicleExitCardLost' : 'VehicleExitCompleted',
    module_name: 'ParkingCards', record_id: cardId, previous_state: 'InUse',
    new_state: nextCardStatus, old_value: 'InUse', new_value: nextCardStatus,
    reason: input.lostCard ? 'Card not returned' : '', action_result: 'Success',
    timestamp: serverTimestamp(), created_at: '2026-07-30T00:00:00.000Z',
  });
  transaction.set(doc(database, `parkingCardHistory/exit-history-${input.suffix}`), {
    history_id: `exit-history-${input.suffix}`,
    event_type: input.lostCard ? 'LOST' : 'EXIT', parking_card_id: cardId,
    card_number: cardNumber, site_id: 'site-a', vehicle_log_id: logId,
    operator_id: input.uid, operator_name: input.operatorName,
    previous_state: 'InUse', new_state: nextCardStatus,
    reason: input.lostCard ? 'Card not returned' : '', action_result: 'Success',
    occurred_at: serverTimestamp(), created_at: serverTimestamp(),
  });
  transaction.update(sessionReference, {
    stage: 'Completed', status: 'Completed', queueStatus: 'Completed',
    current_owner: input.uid, sessionVersion: sessionSnapshot.get('sessionVersion') + 1,
    last_updated_by: input.uid, last_activity_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    'stage_updates.Completed': { updatedBy: input.uid, updatedAt: serverTimestamp() },
  });
  transaction.set(doc(database, `vehicleSessions/${sessionId}/activities/${eventId}`), {
    activity_id: eventId, client_event_id: eventId, session_id: sessionId,
    action: 'VehicleExitCompleted', from_stage: 'Active', to_stage: 'Completed',
    from_status: 'InProgress', to_status: 'Completed', actor_uid: input.uid,
    actor_operator_id: input.uid, actor_name: input.operatorName,
    actor_role: input.role, site_id: 'site-a', details: { vehicle_log_id: logId },
    created_at: serverTimestamp(), schema_version: 1,
  });
});

const checkoutKeyTransaction = (
  database: ReturnType<RulesTestContext['firestore']>,
  input: { uid: string; siteId: string; suffix: string; identityNumber?: string },
) => runTransaction(database, async transaction => {
  const logId = `key-log-${input.suffix}`;
  const auditId = `KEY_CHECKOUT_${logId}`;
  const logReference = doc(database, `keyLogs/${logId}`);
  const snapshot = await transaction.get(logReference);
  if (snapshot.exists()) throw new Error('duplicate checkout');
  transaction.set(logReference, {
    key_log_id: logId,
    site_id: input.siteId,
    room_number: 'A-101',
    key_type: 'ห้องพัก',
    borrower_name: 'Borrower A',
    borrower_phone: '',
    borrower_id_number: input.identityNumber ?? '',
    purpose: 'Maintenance',
    checkout_time: serverTimestamp(),
    issued_by: 'Guard A',
    signature_image_url: '',
    borrower_photo_url: '',
    status: 'ถูกเบิก',
    note: '',
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  transaction.set(doc(database, `auditLogs/${auditId}`), {
    audit_id: auditId,
    operator_id: input.uid,
    account_uid: input.uid,
    user_name: 'Guard A',
    operator_name: 'Guard A',
    site_id: input.siteId,
    action: 'KeyCheckout',
    module_name: 'KeyLogs',
    record_id: logId,
    old_value: '',
    new_value: 'ถูกเบิก',
    action_result: 'Success',
    created_at: serverTimestamp(),
  });
});

const returnKeyTransaction = (
  database: ReturnType<RulesTestContext['firestore']>,
  input: {
    uid: string;
    siteId: string;
    suffix: string;
    returnPhoto?: string;
    returnSignature?: string;
  },
) => runTransaction(database, async transaction => {
  const logId = `key-log-${input.suffix}`;
  const auditId = `KEY_RETURN_${logId}`;
  const logReference = doc(database, `keyLogs/${logId}`);
  const snapshot = await transaction.get(logReference);
  if (!snapshot.exists() || snapshot.get('return_time')) throw new Error('already returned');
  transaction.update(logReference, {
    return_time: serverTimestamp(),
    returned_by: 'Guard A',
    ...(input.returnPhoto === undefined ? { return_photo_url: 'https://drive.google.com/file/d/RETURNPHOTO123/view' }
      : input.returnPhoto ? { return_photo_url: input.returnPhoto } : {}),
    ...(input.returnSignature === undefined ? { return_signature_url: 'https://drive.google.com/file/d/RETURNSIGNATURE123/view' }
      : input.returnSignature ? { return_signature_url: input.returnSignature } : {}),
    status: 'คืนแล้ว',
    updated_at: serverTimestamp(),
  });
  transaction.set(doc(database, `auditLogs/${auditId}`), {
    audit_id: auditId,
    operator_id: input.uid,
    account_uid: input.uid,
    user_name: 'Guard A',
    operator_name: 'Guard A',
    site_id: input.siteId,
    action: 'KeyReturn',
    module_name: 'KeyLogs',
    record_id: logId,
    old_value: 'ถูกเบิก',
    new_value: 'คืนแล้ว',
    action_result: 'Success',
    created_at: serverTimestamp(),
  });
});

const seedActiveVehicleExit = async (suffix: string) => {
  const sessionId = `exit-session-${suffix}`;
  const logId = `exit-log-${suffix}`;
  const cardId = `exit-card-${suffix}`;
  const cardNumber = `EXIT-${suffix.toUpperCase()}`;
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, `vehicleSessions/${sessionId}`), {
        ...session(sessionId),
        parking_card_id: cardId, card_number: cardNumber,
        stage: 'Active', status: 'InProgress', queueStatus: 'In Progress',
        vehicle_plate: '1กข1234', target_room: 'A-101', vehicle_log_id: logId,
      }),
      setDoc(doc(database, `vehicleLogs/${logId}`), {
        log_id: logId, vehicle_session_id: sessionId, site_id: 'site-a',
        parking_card_id: cardId, card_number: cardNumber, vehicle_plate: '1กข1234',
        vehicle_type: 'รถยนต์', visitor_name: '', visitor_phone: '',
        target_room: 'A-101', purpose: '',
        entry_time: '2026-07-30T00:00:00.000Z', status: 'กำลังจอด',
        workflow_status: 'active', recorded_by: 'Guard A',
        operator_name: 'Guard A', operator_id: 'guard-a', account_uid: 'guard-a',
        created_at: '2026-07-30T00:00:00.000Z',
        updated_at: '2026-07-30T00:00:00.000Z',
      }),
      setDoc(doc(database, `parkingCards/${cardId}`), {
        firestore_document_id: cardId, card_id: cardId, site_id: 'site-a',
        card_number: cardNumber, card_number_normalized: cardNumber,
        qr_code_value: cardNumber, qr_code_normalized: cardNumber,
        card_type: 'Temporary', status: 'InUse', status_normalized: 'InUse',
        current_vehicle_plate: '1กข1234', current_vehicle_log_id: logId,
        current_vehicle_session_id: '',
        created_at: Timestamp.now(), updated_at: Timestamp.now(),
      }),
    ]);
  });
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(process.env.FIRESTORE_RULES_FILE || 'firestore.rules', 'utf8'),
    },
  });
});

after(async () => environment.cleanup());

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, 'users/guard-a'), {
        status: 'Active', role: 'Guard', site_id: 'site-a', operator_name: 'Guard A',
      }),
      setDoc(doc(database, 'users/guard-b'), {
        status: 'Active', role: 'Guard', site_id: 'site-a', operator_name: 'Guard B',
      }),
      setDoc(doc(database, 'users/manager-a'), {
        status: 'Active', role: 'Manager', site_id: 'site-a', operator_name: 'Manager A',
      }),
      setDoc(doc(database, 'users/admin-a'), {
        status: 'Active', role: 'Admin', site_id: 'site-a', operator_name: 'Admin A',
      }),
      setDoc(doc(database, 'users/shift-a'), {
        status: 'Active', role: 'ShiftHead', site_id: 'site-a', operator_name: 'Shift A',
      }),
      setDoc(doc(database, 'users/shift-head-a'), {
        status: 'Active', role: 'ShiftHead', site_id: 'site-01', operator_name: 'JK-Secure',
      }),
      setDoc(doc(database, 'users/inactive-a'), {
        status: 'Inactive', role: 'Guard', site_id: 'site-a', operator_name: 'Inactive A',
      }),
      setDoc(doc(database, 'users/admin-b'), {
        status: 'Active', role: 'Admin', site_id: 'site-b', operator_name: 'Admin B',
      }),
      setDoc(doc(database, 'users/unknown-a'), {
        status: 'Active', role: 'Supervisor', site_id: 'site-a', operator_name: 'Unknown A',
      }),
      setDoc(doc(database, 'users/legacy-a'), {
        status: 'Active', role: 'ShiftLeader', site_id: 'site-a', operator_name: 'Legacy A',
      }),
      setDoc(doc(database, 'accounts/account-shift-a'), {
        status: 'Active', role: 'Guard', site_id: 'site-b',
      }),
      setDoc(doc(database, 'vehicleSessions/session-a'), session('session-a')),
      setDoc(doc(database, 'siteAnalyticsDaily/site-a_2026-07-24'), {
        site_id: 'site-a', date_key: '2026-07-24', sessions_created: 1,
      }),
      setDoc(doc(database, 'auditLogs/audit-a'), {
        audit_id: 'audit-a', module_name: 'VehicleSessions', record_id: 'session-a',
        action: 'Created', account_uid: 'guard-a', operator_id: 'guard-a',
        site_id: 'site-a', created_at: Timestamp.now(),
      }),
      setDoc(doc(database, 'operatorCredentials/admin'), {
        username: 'admin', operator_id: 'operator-admin', account_id: 'account-admin',
        algorithm: 'scrypt-v1', pin_hash: 'not-client-readable', pin_salt: 'not-client-readable',
        status: 'Active',
      }),
    ]);
  });
});

test('authenticated browser cannot read operator credentials directly', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(getDoc(doc(database, 'operatorCredentials/admin')));
});

test('anonymous browser cannot read operator credentials directly', async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(database, 'operatorCredentials/admin')));
});

test('authenticated UID can read its own canonical session profile', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertSucceeds(getDoc(doc(database, 'users/guard-a')));
});

test('another UID cannot read a session profile', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(getDoc(doc(database, 'users/guard-b')));
});

test('non-admin user cannot modify own role, site or status', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'users/guard-a');
  await assertFails(updateDoc(reference, { role: 'Admin' }));
  await assertFails(updateDoc(reference, { site_id: 'site-b' }));
  await assertFails(updateDoc(reference, { status: 'Inactive' }));
});

test('cross-site session and analytics reads are denied', async () => {
  const database = environment.authenticatedContext('admin-b').firestore();
  await assertFails(getDoc(doc(database, 'vehicleSessions/session-a')));
  await assertFails(getDoc(doc(database, 'siteAnalyticsDaily/site-a_2026-07-24')));
});

[
  { uid: 'guard-a', role: 'Guard' },
  { uid: 'shift-a', role: 'ShiftHead' },
  { uid: 'manager-a', role: 'Manager' },
  { uid: 'admin-a', role: 'Admin' },
].forEach(actor => {
  test(`${actor.role} can read the same-site operational queue`, async () => {
    const database = environment.authenticatedContext(actor.uid).firestore();
    await assertSucceeds(getDocs(query(
      collection(database, 'vehicleSessions'),
      where('site_id', '==', 'site-a'),
      where('queueStatus', 'in', ['Waiting', 'Assigned', 'In Progress', 'Waiting Information', 'Ready']),
      orderBy('queuePosition', 'asc'),
      limit(100),
    )));
  });
});

test('ShiftHead, Manager and Admin can read same-site daily analytics', async () => {
  for (const uid of ['shift-a', 'manager-a', 'admin-a']) {
    const database = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(database, 'siteAnalyticsDaily/site-a_2026-07-24')));
  }
});

test('Guard cannot read daily analytics', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(getDoc(doc(database, 'siteAnalyticsDaily/site-a_2026-07-24')));
});

test('operational queue queries without the site filter are denied', async () => {
  const database = environment.authenticatedContext('admin-a').firestore();
  await assertFails(getDocs(query(
    collection(database, 'vehicleSessions'),
    where('queueStatus', 'in', ['Waiting', 'Assigned', 'In Progress', 'Waiting Information', 'Ready']),
    orderBy('queuePosition', 'asc'),
    limit(100),
  )));
});

test('cross-site operational queue query is denied', async () => {
  const database = environment.authenticatedContext('admin-b').firestore();
  await assertFails(getDocs(query(
    collection(database, 'vehicleSessions'),
    where('site_id', '==', 'site-a'),
    where('queueStatus', 'in', ['Waiting', 'Assigned', 'In Progress', 'Waiting Information', 'Ready']),
    orderBy('queuePosition', 'asc'),
    limit(100),
  )));
});

test('exact sessionVersion increment by one succeeds', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  await assertSucceeds(updateDoc(reference, {
    note: 'current', sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('same sessionVersion is denied when an update requires an increment', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  await assertFails(updateDoc(reference, {
    note: 'stale', last_updated_by: 'guard-a', updated_at: Timestamp.now(),
  }));
});

test('sessionVersion increment greater than one is denied', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    note: 'skip', sessionVersion: 3, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('sessionVersion decrement and non-numeric versions are denied', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  await assertFails(updateDoc(reference, {
    note: 'decrement', sessionVersion: 0, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
  await assertFails(updateDoc(reference, {
    note: 'type-confusion', sessionVersion: '2', last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('protected vehicle-session identity fields cannot be changed', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    opened_by: 'guard-b', sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('cross-site and inactive accounts cannot update a vehicle session', async () => {
  const crossSite = environment.authenticatedContext('admin-b').firestore();
  const inactive = environment.authenticatedContext('inactive-a').firestore();
  const update = {
    note: 'denied', sessionVersion: 2, last_updated_by: 'admin-b',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  };
  await assertFails(updateDoc(doc(crossSite, 'vehicleSessions/session-a'), update));
  await assertFails(updateDoc(doc(inactive, 'vehicleSessions/session-a'), {
    ...update, last_updated_by: 'inactive-a',
  }));
});

test('guard may complete an active same-site session', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'vehicleSessions/session-a'), {
      ...session('session-a'),
      stage: 'Active',
      status: 'InProgress',
      queueStatus: 'In Progress',
    });
  });
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertSucceeds(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    stage: 'Completed', status: 'Completed', queueStatus: 'Completed',
    sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('guard cannot change administrative priority', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    priority: 'Emergency', sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('same-site Manager and Admin may perform intended session updates', async () => {
  const manager = environment.authenticatedContext('manager-a').firestore();
  const admin = environment.authenticatedContext('admin-a').firestore();
  const reference = doc(manager, 'vehicleSessions/session-a');
  await assertSucceeds(updateDoc(reference, {
    priority: 'High', sessionVersion: 2, last_updated_by: 'manager-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'vehicleSessions/session-a'), session('session-a'));
  });
  await assertSucceeds(updateDoc(doc(admin, 'vehicleSessions/session-a'), {
    priority: 'Low', sessionVersion: 2, last_updated_by: 'admin-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('unauthenticated clients cannot update a vehicle session', async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    note: 'anonymous', sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('unauthenticated clients cannot read or list vehicle sessions', async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(database, 'vehicleSessions/session-a')));
});

test('schema pollution and oversized strings are denied on update', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  await assertFails(updateDoc(reference, {
    arbitrary_admin_override: true,
    sessionVersion: 2,
    last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  }));
  await assertFails(updateDoc(reference, {
    note: 'x'.repeat(2001),
    sessionVersion: 2,
    last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  }));
});

test('created timestamp remains immutable', async () => {
  const database = environment.authenticatedContext('manager-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    created_at: Timestamp.now(),
    sessionVersion: 2,
    last_updated_by: 'manager-a',
    last_activity_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  }));
});

test('vehicle-session deletion is Admin-only and same-site', async () => {
  await assertFails(deleteDoc(doc(
    environment.authenticatedContext('manager-a').firestore(),
    'vehicleSessions/session-a',
  )));
  await assertFails(deleteDoc(doc(
    environment.authenticatedContext('admin-b').firestore(),
    'vehicleSessions/session-a',
  )));
  await assertSucceeds(deleteDoc(doc(
    environment.authenticatedContext('admin-a').firestore(),
    'vehicleSessions/session-a',
  )));
});

test('Guard B can continue a same-site session opened and assigned to Guard A', async () => {
  const database = environment.authenticatedContext('guard-b').firestore();
  await assertSucceeds(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    vehicle_plate: '1กข1234', visitor_name: 'Visitor B', target_room: 'A-101',
    note: 'continued by Guard B', stage: 'Ready', status: 'Ready', queueStatus: 'Ready',
    sessionVersion: 2, last_updated_by: 'guard-b',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
  const updated = await getDoc(doc(database, 'vehicleSessions/session-a'));
  if (updated.get('opened_by') !== 'guard-a' || updated.get('assignedTo') !== 'guard-a') {
    throw new Error('Collaborative edit changed origin or assignment metadata.');
  }
  await assertSucceeds(setDoc(doc(database, 'vehicleSessions/session-a/activities/guard-b-details'), {
    activity_id: 'guard-b-details', client_event_id: 'guard-b-details', session_id: 'session-a',
    action: 'VehicleDetailsUpdated', from_stage: 'CardIssued', to_stage: 'Ready',
    from_status: 'Pending', to_status: 'Ready', actor_uid: 'guard-b',
    actor_operator_id: 'guard-b', actor_name: 'Guard B', actor_role: 'Guard',
    site_id: 'site-a', details: {}, created_at: serverTimestamp(), schema_version: 1,
  }));
});

test('ShiftHead can admit a ready session prepared by another same-site guard', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'vehicleSessions/session-a'), {
      ...session('session-a'),
      stage: 'Ready',
      status: 'Ready',
      queueStatus: 'Ready',
      vehicle_plate: '1กข1234',
      target_room: 'A-101',
      entry_plate_photo_url: 'https://example.test/plate.jpg',
      entry_vehicle_photo_url: 'https://example.test/vehicle.jpg',
      sessionVersion: 2,
    });
  });
  const database = environment.authenticatedContext('shift-a').firestore();
  await assertSucceeds(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    stage: 'Active', status: 'InProgress', queueStatus: 'In Progress',
    sessionVersion: 3, last_updated_by: 'shift-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('Guard cannot assign a session to another operator', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    assignedTo: 'guard-b', assigned_to: 'guard-b', assignedBy: 'guard-a',
    assignedAt: Timestamp.now(), current_owner: 'guard-b',
    assignmentVersion: 1, sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('Guard cannot tamper with assignment identity or legacy mirrors', async () => {
  const database = environment.authenticatedContext('guard-b').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  const metadata = {
    sessionVersion: 2, last_updated_by: 'guard-b',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  };
  await assertFails(updateDoc(reference, {
    assignedTo: 'guard-b', assigned_to: 'guard-b', assignmentVersion: 1,
    assignedBy: 'guard-b', assignedAt: Timestamp.now(), ...metadata,
  }));
  await assertFails(updateDoc(reference, {
    assignedBy: 'guard-b', assignmentVersion: 1, ...metadata,
  }));
  await assertFails(updateDoc(reference, {
    assigned_by: 'guard-b', ...metadata,
  }));
  await assertFails(updateDoc(reference, {
    assigned_to: 'guard-b', ...metadata,
  }));
});

test('Guard cannot overwrite current owner through an operational update', async () => {
  const database = environment.authenticatedContext('guard-b').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    current_owner: 'guard-b', note: 'forged owner',
    sessionVersion: 2, last_updated_by: 'guard-b',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('Guard cannot tamper with priority or queue assignment metadata', async () => {
  const database = environment.authenticatedContext('guard-b').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  const metadata = {
    sessionVersion: 2, last_updated_by: 'guard-b',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  };
  await assertFails(updateDoc(reference, { priority: 'Emergency', ...metadata }));
  await assertFails(updateDoc(reference, { queuePosition: 999, ...metadata }));
  await assertFails(updateDoc(reference, { assignmentVersion: 1, ...metadata }));
  await assertFails(updateDoc(reference, {
    assignedAt: Timestamp.now(), assignmentVersion: 1, ...metadata,
  }));
});

test('Guard cannot forge edit-lock identity or canonical operator name', async () => {
  const database = environment.authenticatedContext('guard-b').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  const metadata = {
    sessionVersion: 2, last_updated_by: 'guard-b',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  };
  await assertFails(updateDoc(reference, {
    editing_by: 'guard-a', editing_by_name: 'Guard A',
    editing_since: serverTimestamp(), expires_at: Timestamp.fromMillis(Date.now() + 300_000),
    ...metadata,
  }));
  await assertFails(updateDoc(reference, {
    editing_by: 'guard-b', editing_by_name: 'Forged Name',
    editing_since: serverTimestamp(), expires_at: Timestamp.fromMillis(Date.now() + 300_000),
    ...metadata,
  }));
});

test('Guard can acquire and release only their own edit lock', async () => {
  const database = environment.authenticatedContext('guard-b').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  await assertSucceeds(updateDoc(reference, {
    editing_by: 'guard-b', editing_by_name: 'Guard B',
    editing_since: serverTimestamp(), expires_at: Timestamp.fromMillis(Date.now() + 300_000),
    sessionVersion: 2, last_updated_by: 'guard-b',
    last_activity_at: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(reference, {
    editing_by: '', editing_by_name: '', editing_since: null, expires_at: null,
    sessionVersion: 3, last_updated_by: 'guard-b', updated_at: serverTimestamp(),
  }));
});

test('ShiftHead can assign a session to an active same-site Guard', async () => {
  const database = environment.authenticatedContext('shift-a').firestore();
  await assertSucceeds(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    assignedTo: 'guard-b', assigned_to: 'guard-b', assignedBy: 'shift-a',
    assignedAt: Timestamp.now(), current_owner: 'guard-b',
    assignmentVersion: 1, sessionVersion: 2, last_updated_by: 'shift-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('ShiftHead cannot forge assignment actor or mismatch the legacy mirror', async () => {
  const database = environment.authenticatedContext('shift-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  const metadata = {
    assignedTo: 'guard-b', assignedAt: Timestamp.now(), current_owner: 'guard-b',
    assignmentVersion: 1, sessionVersion: 2, last_updated_by: 'shift-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  };
  await assertFails(updateDoc(reference, {
    ...metadata, assigned_to: 'guard-b', assignedBy: 'manager-a',
  }));
  await assertFails(updateDoc(reference, {
    ...metadata, assigned_to: 'guard-a', assignedBy: 'shift-a',
  }));
});

test('Manager cannot assign a session to an unknown or legacy role', async () => {
  for (const targetUid of ['unknown-a', 'legacy-a']) {
    const database = environment.authenticatedContext('manager-a').firestore();
    await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
      assignedTo: targetUid, assigned_to: targetUid, assignedBy: 'manager-a',
      assignedAt: Timestamp.now(), current_owner: targetUid,
      assignmentVersion: 1, sessionVersion: 2, last_updated_by: 'manager-a',
      last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
    }));
  }
});

test('illegal vehicle-session stage jumps are denied', async () => {
  const database = environment.authenticatedContext('manager-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    stage: 'Completed', status: 'Completed', queueStatus: 'Completed',
    sessionVersion: 2, last_updated_by: 'manager-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('session activity actor identity cannot be falsified', async () => {
  const database = environment.authenticatedContext('guard-b').firestore();
  await assertFails(setDoc(doc(database, 'vehicleSessions/session-a/activities/forged-actor'), {
    activity_id: 'forged-actor', client_event_id: 'forged-actor', session_id: 'session-a',
    action: 'VehicleDetailsUpdated', from_stage: 'CardIssued', to_stage: 'Ready',
    from_status: 'Pending', to_status: 'Ready', actor_uid: 'guard-a',
    actor_operator_id: 'guard-a', actor_name: 'Guard A', actor_role: 'ShiftHead',
    site_id: 'site-a', details: {}, created_at: serverTimestamp(), schema_version: 1,
  }));
});

test('unknown and legacy roles cannot collaboratively update a session', async () => {
  for (const uid of ['unknown-a', 'legacy-a']) {
    const database = environment.authenticatedContext(uid).firestore();
    await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
      note: 'unauthorized collaboration', sessionVersion: 2, last_updated_by: uid,
      last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
    }));
  }
});

test('clients cannot modify trusted queue metrics', async () => {
  const database = environment.authenticatedContext('manager-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    sessionVersion: 2, last_updated_by: 'manager-a',
    queueMetrics: { ...emptyMetrics, waitingSeconds: 999999 },
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('pre-fix Vehicle Entry payload is rejected specifically because it writes queueMetrics', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(runTransaction(database, async transaction => {
    const reference = doc(database, 'vehicleSessions/session-a');
    transaction.update(reference, {
      vehicle_plate: '1กข1234',
      target_room: 'A-101',
      entry_plate_photo_url: 'https://storage.example.test/plate.jpg',
      entry_vehicle_photo_url: 'https://storage.example.test/vehicle.jpg',
      stage: 'Ready',
      status: 'Ready',
      queueStatus: 'Ready',
      queueMetrics: {
        ...emptyMetrics,
        readyAt: Timestamp.now(),
        lastTransitionAt: Timestamp.now(),
        lastEventId: 'ready-pre-fix',
        metricsVersion: 2,
      },
      last_updated_by: 'guard-a',
      sessionVersion: 2,
      last_activity_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      'stage_updates.Ready': { updatedBy: 'guard-a', updatedAt: serverTimestamp() },
    });
  }));
});

[
  { uid: 'guard-a', operatorName: 'Guard A', role: 'Guard' },
  { uid: 'shift-a', operatorName: 'Shift A', role: 'ShiftHead' },
  { uid: 'manager-a', operatorName: 'Manager A', role: 'Manager' },
  { uid: 'admin-a', operatorName: 'Admin A', role: 'Admin' },
].forEach(actor => {
  test(`${actor.role} can atomically save same-site Vehicle Entry evidence as Ready`, async () => {
    const database = environment.authenticatedContext(actor.uid).firestore();
    await assertSucceeds(saveVehicleEntryEvidenceTransaction(database, actor));
  });
});

test('cross-site, inactive, and legacy roles cannot save Vehicle Entry evidence as Ready', async () => {
  for (const actor of [
    { uid: 'admin-b', operatorName: 'Admin B', role: 'Admin' },
    { uid: 'inactive-a', operatorName: 'Inactive A', role: 'Guard' },
    { uid: 'legacy-a', operatorName: 'Legacy A', role: 'ShiftLeader' },
  ]) {
    const database = environment.authenticatedContext(actor.uid).firestore();
    await assertFails(saveVehicleEntryEvidenceTransaction(database, actor));
  }
});

test('Vehicle Entry Ready transaction rejects an unauthorized identity mutation', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(runTransaction(database, async transaction => {
    const reference = doc(database, 'vehicleSessions/session-a');
    transaction.update(reference, {
      stage: 'Ready',
      status: 'Ready',
      queueStatus: 'Ready',
      opened_by: 'guard-b',
      last_updated_by: 'guard-a',
      sessionVersion: 2,
      last_activity_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    transaction.set(doc(database, 'auditLogs/audit-ready-tamper'), {
      audit_id: 'audit-ready-tamper',
      module_name: 'VehicleSessions',
      record_id: 'session-a',
      action: 'Stage:Ready',
      operator_id: 'guard-a',
      account_uid: 'guard-a',
      site_id: 'site-a',
      created_at: serverTimestamp(),
    });
  }));
});

test('analytics collections reject client writes', async () => {
  const database = environment.authenticatedContext('manager-a').firestore();
  await assertFails(setDoc(doc(database, 'siteAnalyticsDaily/site-a_2026-07-25'), {
    site_id: 'site-a', date_key: '2026-07-25', sessions_created: 999,
  }));
});

test('same-site supervisor can read analytics while inactive user cannot', async () => {
  const shiftDatabase = environment.authenticatedContext('shift-a').firestore();
  const inactiveDatabase = environment.authenticatedContext('inactive-a').firestore();
  await assertSucceeds(getDoc(doc(shiftDatabase, 'siteAnalyticsDaily/site-a_2026-07-24')));
  await assertFails(getDoc(doc(inactiveDatabase, 'vehicleSessions/session-a')));
});

test('session activity is append-only', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a/activities/activity-a');
  await assertSucceeds(setDoc(reference, {
    activity_id: 'activity-a', client_event_id: 'activity-a', session_id: 'session-a',
    action: 'QueueStatusChange', from_stage: 'CardIssued', to_stage: 'CardIssued',
    from_status: 'Pending', to_status: 'Pending', actor_uid: 'guard-a',
    actor_operator_id: 'guard-a', actor_name: 'Guard A', actor_role: 'Guard',
    site_id: 'site-a', details: {}, created_at: serverTimestamp(), schema_version: 1,
  }));
  await assertFails(updateDoc(reference, { action: 'Tampered' }));
  await assertFails(deleteDoc(reference));
});

const operationalActivity = (id: string, uid = 'guard-a', role = 'Guard', siteId = 'site-a') => ({
  activity_id: id,
  client_event_id: id,
  session_id: 'session-a',
  vehicle_session_id: 'session-a',
  vehicle_log_id: 'log-a',
  action: 'VehicleActivityAdded',
  activity_type: 'Obstruction',
  title: 'Obstruction',
  description: 'รถจอดกีดขวางทางเข้า',
  location: 'อาคาร A',
  severity: 'High',
  status: 'Recorded',
  photo_urls: [],
  from_stage: 'Active',
  to_stage: 'Active',
  from_status: 'InProgress',
  to_status: 'InProgress',
  actor_uid: uid,
  actor_operator_id: uid,
  actor_name: uid === 'guard-a' ? 'Guard A' : 'Admin B',
  actor_role: role,
  site_id: siteId,
  details: {},
  created_at: serverTimestamp(),
  updated_at: serverTimestamp(),
  schema_version: 1,
});

test('same-site Guard can append concurrent activities while vehicle is inside', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'vehicleSessions/session-a'), {
      ...session('session-a'),
      stage: 'Active',
      status: 'InProgress',
      queueStatus: 'In Progress',
      vehicle_log_id: 'log-a',
    });
  });
  const database = environment.authenticatedContext('guard-a').firestore();
  await Promise.all([
    assertSucceeds(setDoc(doc(database, 'vehicleSessions/session-a/activities/activity-v2-a'), operationalActivity('activity-v2-a'))),
    assertSucceeds(setDoc(doc(database, 'vehicleSessions/session-a/activities/activity-v2-b'), operationalActivity('activity-v2-b'))),
  ]);
});

test('cross-site activity and activity after Completed are denied', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'vehicleSessions/session-a'), {
      ...session('session-a'),
      stage: 'Active',
      status: 'InProgress',
      queueStatus: 'In Progress',
      vehicle_log_id: 'log-a',
    });
  });
  const crossSite = environment.authenticatedContext('admin-b').firestore();
  await assertFails(setDoc(
    doc(crossSite, 'vehicleSessions/session-a/activities/activity-cross-site'),
    operationalActivity('activity-cross-site', 'admin-b', 'Admin', 'site-b'),
  ));
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'vehicleSessions/session-a'), {
      stage: 'Completed',
      status: 'Completed',
      queueStatus: 'Completed',
    });
  });
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(setDoc(
    doc(database, 'vehicleSessions/session-a/activities/activity-after-completed'),
    operationalActivity('activity-after-completed'),
  ));
});

test('operational activity rejects oversized or forged fields', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'vehicleSessions/session-a'), {
      ...session('session-a'),
      stage: 'Active',
      status: 'InProgress',
      queueStatus: 'In Progress',
      vehicle_log_id: 'log-a',
    });
  });
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(setDoc(
    doc(database, 'vehicleSessions/session-a/activities/activity-forged-v2'),
    { ...operationalActivity('activity-forged-v2'), actor_role: 'Admin' },
  ));
  await assertFails(setDoc(
    doc(database, 'vehicleSessions/session-a/activities/activity-too-large'),
    { ...operationalActivity('activity-too-large'), description: 'x'.repeat(2001) },
  ));
});

for (const actor of [
  { uid: 'guard-a', name: 'Guard A', role: 'Guard' },
  { uid: 'shift-a', name: 'Shift A', role: 'ShiftHead' },
]) {
  test(`${actor.role} can atomically edit an active session and its vehicle log`, async () => {
    await environment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      await Promise.all([
        setDoc(doc(database, 'vehicleSessions/session-a'), {
          ...session('session-a'),
          stage: 'Active',
          status: 'InProgress',
          queueStatus: 'In Progress',
          vehicle_plate: 'OLD-1',
          target_room: 'A-101',
          vehicle_log_id: 'log-a',
        }),
        setDoc(doc(database, 'vehicleLogs/log-a'), {
          log_id: 'log-a', vehicle_session_id: 'session-a', site_id: 'site-a',
          card_number: 'CARD-A', parking_card_id: 'card-a', vehicle_plate: 'OLD-1',
          vehicle_type: 'รถยนต์', visitor_name: '', visitor_phone: '',
          target_room: 'A-101', purpose: '', entry_time: '2026-07-30T00:00:00.000Z',
          status: 'กำลังจอด', workflow_status: 'active', recorded_by: 'Guard A',
          account_uid: 'guard-a', operator_id: 'guard-a',
          created_at: '2026-07-30T00:00:00.000Z', updated_at: '2026-07-30T00:00:00.000Z',
        }),
      ]);
    });
    const database = environment.authenticatedContext(actor.uid).firestore();
    await assertSucceeds(runTransaction(database, async transaction => {
      transaction.update(doc(database, 'vehicleSessions/session-a'), {
        vehicle_plate: 'NEW-2', target_room: 'B-202',
        sessionVersion: 2, last_updated_by: actor.uid,
        last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
      });
      transaction.update(doc(database, 'vehicleLogs/log-a'), {
        vehicle_plate: 'NEW-2', target_room: 'B-202', updated_at: serverTimestamp(),
      });
      transaction.set(doc(database, `vehicleSessions/session-a/activities/edit-${actor.uid}`), {
        activity_id: `edit-${actor.uid}`, client_event_id: `edit-${actor.uid}`,
        session_id: 'session-a', action: 'ActiveVehicleDetailsUpdated',
        from_stage: 'Active', to_stage: 'Active', from_status: 'InProgress', to_status: 'InProgress',
        actor_uid: actor.uid, actor_operator_id: actor.uid, actor_name: actor.name,
        actor_role: actor.role, site_id: 'site-a', details: { vehicle_log_id: 'log-a' },
        created_at: serverTimestamp(), schema_version: 1,
      });
      transaction.set(doc(database, `auditLogs/audit-edit-${actor.uid}`), {
        audit_id: `audit-edit-${actor.uid}`, module_name: 'VehicleSessions',
        record_id: 'session-a', vehicle_log_id: 'log-a', action: 'ActiveDetailsUpdated',
        operator_id: actor.uid, account_uid: actor.uid, site_id: 'site-a',
        created_at: serverTimestamp(),
      });
    }));
  });
}

test('Ready to Active transaction reserves one vehicle log and is idempotent on repeat', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, 'vehicleSessions/session-a'), {
        ...session('session-a'),
        stage: 'Ready', status: 'Ready', queueStatus: 'Ready',
        vehicle_plate: '1กข1234', target_room: 'A-101',
        entry_plate_photo_url: '', entry_vehicle_photo_url: '',
      }),
      setDoc(doc(database, 'parkingCards/card-a'), {
        firestore_document_id: 'card-a', card_id: 'card-a', site_id: 'site-a',
        card_number: 'CARD-A', card_number_normalized: 'CARD-A',
        qr_code_value: 'CARD-A', qr_code_normalized: 'CARD-A',
        card_type: 'Temporary', status: 'Reserved', status_normalized: 'Reserved',
        current_vehicle_session_id: 'session-a',
        created_at: Timestamp.now(), updated_at: Timestamp.now(),
      }),
    ]);
  });
  const database = environment.authenticatedContext('guard-a').firestore();
  const admit = () => runTransaction(database, async transaction => {
    const sessionReference = doc(database, 'vehicleSessions/session-a');
    const cardReference = doc(database, 'parkingCards/card-a');
    const sessionSnapshot = await transaction.get(sessionReference);
    if (sessionSnapshot.get('stage') === 'Active') return String(sessionSnapshot.get('vehicle_log_id'));
    await transaction.get(cardReference);
    const logId = 'log-admission-a';
    transaction.set(doc(database, `vehicleLogs/${logId}`), {
      log_id: logId, vehicle_session_id: 'session-a', site_id: 'site-a',
      parking_card_id: 'card-a', card_number: 'CARD-A', vehicle_plate: '1กข1234',
      vehicle_type: 'รถยนต์', visitor_name: '', visitor_phone: '', target_room: 'A-101',
      purpose: '', entry_time: '2026-07-30T00:00:00.000Z', status: 'กำลังจอด',
      workflow_status: 'active', recorded_by: 'Guard A',
      operator_name: 'Guard A', operator_id: 'guard-a', account_uid: 'guard-a',
      created_at: '2026-07-30T00:00:00.000Z', updated_at: '2026-07-30T00:00:00.000Z',
    });
    transaction.update(cardReference, {
      status: 'InUse', status_normalized: 'InUse', current_vehicle_plate: '1กข1234',
      current_vehicle_log_id: logId, current_vehicle_session_id: '',
      last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
    });
    transaction.update(sessionReference, {
      stage: 'Active', status: 'InProgress', queueStatus: 'In Progress',
      vehicle_log_id: logId, current_owner: 'guard-a', last_updated_by: 'guard-a',
      sessionVersion: 2, last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
      editing_by: '', editing_by_name: '', editing_since: null, expires_at: null,
      'stage_updates.Active': { updatedBy: 'guard-a', updatedAt: serverTimestamp() },
    });
    transaction.set(doc(database, 'vehicleSessions/session-a/activities/admit-a'), {
      activity_id: 'admit-a', client_event_id: 'admit-a', session_id: 'session-a',
      action: 'SessionCompletion', from_stage: 'Ready', to_stage: 'Active',
      from_status: 'Ready', to_status: 'InProgress', actor_uid: 'guard-a',
      actor_operator_id: 'guard-a', actor_name: 'Guard A', actor_role: 'Guard',
      site_id: 'site-a', details: { vehicle_log_id: logId },
      created_at: serverTimestamp(), schema_version: 1,
    });
    transaction.set(doc(database, 'auditLogs/audit-admit-a'), {
      audit_id: 'audit-admit-a', module_name: 'VehicleSessions', record_id: 'session-a',
      vehicle_log_id: logId, action: 'Ready->Active', operator_id: 'guard-a',
      account_uid: 'guard-a', site_id: 'site-a', created_at: serverTimestamp(),
    });
    return logId;
  });
  await assertSucceeds(admit());
  await assertSucceeds(admit());
  const logs = await getDocs(query(
    collection(database, 'vehicleLogs'),
    where('site_id', '==', 'site-a'),
    where('vehicle_session_id', '==', 'session-a'),
  ));
  if (logs.size !== 1) throw new Error(`Expected one vehicle log, found ${logs.size}.`);
});

[
  { uid: 'guard-a', operatorName: 'Guard A', role: 'Guard', suffix: 'guard' },
  { uid: 'shift-head-a', operatorName: 'JK-Secure', role: 'ShiftHead', suffix: 'shift-head', siteId: 'site-01' },
  { uid: 'manager-a', operatorName: 'Manager A', role: 'Manager', suffix: 'manager' },
  { uid: 'admin-a', operatorName: 'Admin A', role: 'Admin', suffix: 'admin' },
].forEach(actor => {
  test(`${actor.role} can atomically reserve an available card and create a vehicle session`, async () => {
    await seedAvailableCard(
      `card-${actor.suffix}`,
      `CARD-${actor.suffix.toUpperCase()}`,
      actor.siteId ?? 'site-a',
    );
    const database = environment.authenticatedContext(actor.uid).firestore();
    await assertSucceeds(createVehicleSessionTransaction(database, {
      ...actor,
      siteId: actor.siteId ?? 'site-a',
    }));
  });
});

test('inactive user cannot atomically create a vehicle session', async () => {
  await seedAvailableCard('card-inactive', 'CARD-INACTIVE');
  const database = environment.authenticatedContext('inactive-a').firestore();
  await assertFails(createVehicleSessionTransaction(database, {
    uid: 'inactive-a', operatorName: 'Inactive A', role: 'Guard',
    siteId: 'site-a', suffix: 'inactive',
  }));
});

test('missing user profile cannot atomically create a vehicle session', async () => {
  await seedAvailableCard('card-missing-profile', 'CARD-MISSING-PROFILE');
  const database = environment.authenticatedContext('missing-profile').firestore();
  await assertFails(createVehicleSessionTransaction(database, {
    uid: 'missing-profile', operatorName: 'Missing Profile', role: 'Guard',
    siteId: 'site-a', suffix: 'missing-profile',
  }));
});

test('cross-site user cannot read and reserve a card from another site', async () => {
  await seedAvailableCard('card-wrong-site', 'CARD-WRONG-SITE');
  const database = environment.authenticatedContext('admin-b').firestore();
  await assertFails(createVehicleSessionTransaction(database, {
    uid: 'admin-b', operatorName: 'Admin B', role: 'Admin',
    siteId: 'site-a', suffix: 'wrong-site',
  }));
});

test('unknown role cannot atomically create a vehicle session', async () => {
  await seedAvailableCard('card-unknown', 'CARD-UNKNOWN');
  const database = environment.authenticatedContext('unknown-a').firestore();
  await assertFails(createVehicleSessionTransaction(database, {
    uid: 'unknown-a', operatorName: 'Unknown A', role: 'Supervisor',
    siteId: 'site-a', suffix: 'unknown',
  }));
});

test('legacy ShiftLeader role cannot atomically create a vehicle session', async () => {
  await seedAvailableCard('card-legacy-role', 'CARD-LEGACY-ROLE');
  const database = environment.authenticatedContext('legacy-a').firestore();
  await assertFails(createVehicleSessionTransaction(database, {
    uid: 'legacy-a', operatorName: 'Legacy A', role: 'ShiftLeader',
    siteId: 'site-a', suffix: 'legacy-role',
  }));
});

test('accounts role and site mismatch do not override the canonical users profile', async () => {
  await seedAvailableCard('card-account-mismatch', 'CARD-ACCOUNT-MISMATCH');
  const database = environment.authenticatedContext('shift-a').firestore();
  await assertSucceeds(createVehicleSessionTransaction(database, {
    uid: 'shift-a', operatorName: 'Shift A', role: 'ShiftHead',
    siteId: 'site-a', suffix: 'account-mismatch',
  }));
});

test('deployed legacy session payload is denied for fields outside validVehicleSession allowlist', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'parkingCards/card-legacy-payload'), {
      firestore_document_id: 'card-legacy-payload', card_id: 'card-legacy-payload',
      site_id: 'site-a', card_number: 'R027', card_number_normalized: 'R027',
      qr_code_value: 'R027', qr_code_normalized: 'R027', card_type: 'Temporary',
      status: 'Available', status_normalized: 'Available',
      created_at: Timestamp.now(), updated_at: Timestamp.now(),
    });
  });
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(runTransaction(database, async transaction => {
    transaction.set(doc(database, 'vehicleSessions/session-legacy-payload'), {
      ...session('session-legacy-payload'),
      parking_card_id: 'card-legacy-payload', card_number: 'R027',
      movement_status: 'ENTRY_OPENED', completeness_status: 'INCOMPLETE',
      missing_fields: ['vehicle_plate'], opened_by_operator_id: 'guard-a',
      opened_at: serverTimestamp(),
    });
    transaction.update(doc(database, 'parkingCards/card-legacy-payload'), {
      status: 'Reserved', status_normalized: 'Reserved',
      current_vehicle_session_id: 'session-legacy-payload',
      last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
    });
  }));
});

test('Vehicle Exit rejects the pre-fix trimmed canonical actor name and accepts the exact profile value', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/shift-a'), {
      status: 'Active', role: 'ShiftHead', site_id: 'site-a',
      operator_name: 'Shift A ',
    });
  });
  await seedActiveVehicleExit('canonical-name');
  const database = environment.authenticatedContext('shift-a').firestore();
  await assertFails(completeVehicleExitTransaction(database, {
    uid: 'shift-a', operatorName: 'Shift A', role: 'ShiftHead',
    suffix: 'canonical-name',
  }));
  await assertSucceeds(completeVehicleExitTransaction(database, {
    uid: 'shift-a', operatorName: 'Shift A ', role: 'ShiftHead',
    suffix: 'canonical-name',
  }));
});

for (const actor of [
  { uid: 'guard-a', operatorName: 'Guard A', role: 'Guard' },
  { uid: 'shift-a', operatorName: 'Shift A', role: 'ShiftHead' },
  { uid: 'manager-a', operatorName: 'Manager A', role: 'Manager' },
  { uid: 'admin-a', operatorName: 'Admin A', role: 'Admin' },
]) {
  test(`${actor.role} can atomically complete same-site Vehicle Exit`, async () => {
    const suffix = `role-${actor.uid}`;
    await seedActiveVehicleExit(suffix);
    await assertSucceeds(completeVehicleExitTransaction(
      environment.authenticatedContext(actor.uid).firestore(),
      { ...actor, suffix },
    ));
  });
}

test('Vehicle Exit atomically records a Lost Card transition and immutable history', async () => {
  await seedActiveVehicleExit('lost');
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertSucceeds(completeVehicleExitTransaction(database, {
    uid: 'guard-a', operatorName: 'Guard A', role: 'Guard',
    suffix: 'lost', lostCard: true,
  }));
  await assertFails(updateDoc(doc(database, 'parkingCardHistory/exit-history-lost'), {
    reason: 'tampered',
  }));
});

test('Vehicle Exit atomically records immutable server exit_time and preserves entry_time', async () => {
  const suffix = 'business-time';
  const logId = `exit-log-${suffix}`;
  const database = environment.authenticatedContext('guard-a').firestore();
  await seedActiveVehicleExit(suffix);
  const before = await getDoc(doc(database, `vehicleLogs/${logId}`));
  const originalEntryTime = before.get('entry_time');

  await assertSucceeds(completeVehicleExitTransaction(database, {
    uid: 'guard-a', operatorName: 'Guard A', role: 'Guard', suffix,
  }));

  const completed = await getDoc(doc(database, `vehicleLogs/${logId}`));
  assert.equal(completed.get('status'), 'ออกแล้ว');
  assert.equal(completed.get('workflow_status'), 'completed');
  assert.ok(completed.get('exit_time') instanceof Timestamp);
  assert.deepEqual(completed.get('entry_time'), originalEntryTime);

  await assertFails(completeVehicleExitTransaction(database, {
    uid: 'guard-a', operatorName: 'Guard A', role: 'Guard', suffix,
  }));
  const afterDuplicate = await getDoc(doc(database, `vehicleLogs/${logId}`));
  assert.deepEqual(afterDuplicate.get('exit_time'), completed.get('exit_time'));
});

for (const actor of [
  { uid: 'admin-b', operatorName: 'Admin B', role: 'Admin', label: 'cross-site' },
  { uid: 'inactive-a', operatorName: 'Inactive A', role: 'Guard', label: 'inactive' },
  { uid: 'legacy-a', operatorName: 'Legacy A', role: 'ShiftLeader', label: 'legacy ShiftLeader' },
]) {
  test(`${actor.label} account cannot complete Vehicle Exit`, async () => {
    const suffix = `denied-${actor.uid}`;
    await seedActiveVehicleExit(suffix);
    await assertFails(completeVehicleExitTransaction(
      environment.authenticatedContext(actor.uid).firestore(),
      { ...actor, suffix },
    ));
  });
}

test('audit logs remain immutable', async () => {
  const database = environment.authenticatedContext('manager-a').firestore();
  await assertFails(updateDoc(doc(database, 'auditLogs/audit-a'), { action: 'Tampered' }));
  await assertFails(deleteDoc(doc(database, 'auditLogs/audit-a')));
});

test('Key checkout and return atomically use immutable server business timestamps', async () => {
  const suffix = 'atomic-time';
  const logId = `key-log-${suffix}`;
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertSucceeds(checkoutKeyTransaction(database, {
    uid: 'guard-a', siteId: 'site-a', suffix, identityNumber: '',
  }));

  let checkoutTime: unknown;
  await environment.withSecurityRulesDisabled(async context => {
    const checkout = await getDoc(doc(context.firestore(), `keyLogs/${logId}`));
    const audit = await getDoc(doc(context.firestore(), `auditLogs/KEY_CHECKOUT_${logId}`));
    checkoutTime = checkout.get('checkout_time');
    assert.ok(checkoutTime instanceof Timestamp);
    assert.equal(checkout.get('borrower_id_number'), '');
    assert.equal(checkout.get('status'), 'ถูกเบิก');
    assert.ok(audit.exists());
  });

  await assert.rejects(checkoutKeyTransaction(database, {
    uid: 'guard-a', siteId: 'site-a', suffix,
  }), /duplicate checkout/);
  await assertSucceeds(returnKeyTransaction(database, {
    uid: 'guard-a', siteId: 'site-a', suffix,
  }));

  let firstReturnTime: unknown;
  await environment.withSecurityRulesDisabled(async context => {
    const returned = await getDoc(doc(context.firestore(), `keyLogs/${logId}`));
    const audit = await getDoc(doc(context.firestore(), `auditLogs/KEY_RETURN_${logId}`));
    firstReturnTime = returned.get('return_time');
    assert.ok(firstReturnTime instanceof Timestamp);
    assert.deepEqual(returned.get('checkout_time'), checkoutTime);
    assert.equal(returned.get('status'), 'คืนแล้ว');
    assert.equal(returned.get('borrower_photo_url'), '');
    assert.equal(returned.get('signature_image_url'), '');
    assert.equal(returned.get('return_photo_url'), 'https://drive.google.com/file/d/RETURNPHOTO123/view');
    assert.equal(returned.get('return_signature_url'), 'https://drive.google.com/file/d/RETURNSIGNATURE123/view');
    assert.ok(audit.exists());
  });

  await assert.rejects(returnKeyTransaction(database, {
    uid: 'guard-a', siteId: 'site-a', suffix,
  }), /already returned/);
  await environment.withSecurityRulesDisabled(async context => {
    const returned = await getDoc(doc(context.firestore(), `keyLogs/${logId}`));
    assert.deepEqual(returned.get('return_time'), firstReturnTime);
    assert.equal(returned.get('return_photo_url'), 'https://drive.google.com/file/d/RETURNPHOTO123/view');
    assert.equal(returned.get('return_signature_url'), 'https://drive.google.com/file/d/RETURNSIGNATURE123/view');
  });
});

test('Key Return requires both distinct evidence references in the atomic transition', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  for (const [suffix, returnPhoto, returnSignature] of [
    ['missing-photo', '', 'https://drive.google.com/file/d/RETURNSIGNATURE123/view'],
    ['missing-signature', 'https://drive.google.com/file/d/RETURNPHOTO123/view', ''],
    ['same-reference', 'https://drive.google.com/file/d/SAMEREFERENCE123/view', 'https://drive.google.com/file/d/SAMEREFERENCE123/view'],
  ] as const) {
    await assertSucceeds(checkoutKeyTransaction(database, {
      uid: 'guard-a', siteId: 'site-a', suffix,
    }));
    await assertFails(returnKeyTransaction(database, {
      uid: 'guard-a', siteId: 'site-a', suffix, returnPhoto, returnSignature,
    }));
    await environment.withSecurityRulesDisabled(async context => {
      const record = await getDoc(doc(context.firestore(), `keyLogs/key-log-${suffix}`));
      const audit = await getDoc(doc(context.firestore(), `auditLogs/KEY_RETURN_key-log-${suffix}`));
      assert.equal(record.get('status'), 'ถูกเบิก');
      assert.equal(record.get('return_time'), undefined);
      assert.equal(audit.exists(), false);
    });
  }
});

test('Key Return evidence and timestamp are immutable after completion', async () => {
  const suffix = 'immutable-return-evidence';
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertSucceeds(checkoutKeyTransaction(database, {
    uid: 'guard-a', siteId: 'site-a', suffix,
  }));
  await assertSucceeds(returnKeyTransaction(database, {
    uid: 'guard-a', siteId: 'site-a', suffix,
  }));
  await assertFails(updateDoc(doc(database, `keyLogs/key-log-${suffix}`), {
    return_time: serverTimestamp(),
    return_photo_url: 'https://drive.google.com/file/d/REPLACEDPHOTO123/view',
    return_signature_url: 'https://drive.google.com/file/d/REPLACEDSIGNATURE123/view',
    updated_at: serverTimestamp(),
  }));
});

test('Key transactions deny cross-site writes and arbitrary field mutation', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(checkoutKeyTransaction(database, {
    uid: 'guard-a', siteId: 'site-b', suffix: 'cross-site',
  }));
  await assertSucceeds(checkoutKeyTransaction(database, {
    uid: 'guard-a', siteId: 'site-a', suffix: 'tamper',
  }));
  await assertFails(updateDoc(doc(database, 'keyLogs/key-log-tamper'), {
    borrower_name: 'Tampered',
    updated_at: serverTimestamp(),
  }));
});

const patrolCheckinTransaction = (
  database: ReturnType<RulesTestContext['firestore']>,
  siteId: string,
  suffix: string,
  overrides: Record<string, unknown> = {},
  includePhoto2 = true,
) => runTransaction(database, async transaction => {
  const id = `patrol-${suffix}`;
  const photo2Fields = includePhoto2 ? {
    incident_photo_url: 'https://drive.google.com/file/d/PATROLPHOTOTWO123/view',
    evidence_photo_2_url: 'https://drive.google.com/file/d/PATROLPHOTOTWO123/view',
    evidence_photo_2_file_id: `PATROLTWO${suffix}`,
  } : {};
  transaction.set(doc(database, `patrolLogs/${id}`), {
    patrol_log_id: id, patrol_point_id: 'PP-1', point_name: 'ห้องเครื่อง',
    patrol_point_name: 'ห้องเครื่อง', custom_location: '', guard_name: 'Guard A',
    shift_type: 'เช้า', checkin_time: serverTimestamp(),
    photo_url: 'https://drive.google.com/file/d/PATROLPHOTOONE123/view',
    evidence_photo_1_url: 'https://drive.google.com/file/d/PATROLPHOTOONE123/view',
    evidence_photo_1_file_id: `PATROLONE${suffix}`,
    ...photo2Fields,
    status: 'ปกติ', area_status: 'normal', abnormal_detail: '', abnormal_reason: '',
    captured_at_client: '2026-07-31T05:00:00.000Z', recorded_by_uid: 'guard-a',
    workflow_status: 'completed', shift_id: '2026-07-31_DAY', operational_date: '2026-07-31', site_id: siteId,
    created_at: serverTimestamp(), updated_at: serverTimestamp(), ...overrides,
  });
  transaction.set(doc(database, `auditLogs/PATROL_CHECKIN_${id}`), {
    audit_id: `PATROL_CHECKIN_${id}`, operator_id: 'guard-a', account_uid: 'guard-a',
    user_name: 'Guard A', operator_name: 'Guard A', site_id: siteId,
    action: 'PatrolCheckin', module_name: 'PatrolLogs', record_id: id,
    old_value: '', new_value: String(overrides.area_status || 'normal'),
    action_result: 'Success', created_at: serverTimestamp(),
  });
});

const incidentCreateTransaction = (
  database: ReturnType<RulesTestContext['firestore']>,
  siteId: string,
  suffix: string,
  overrides: Record<string, unknown> = {},
) => runTransaction(database, async transaction => {
  const id = `incident-${suffix}`;
  transaction.set(doc(database, `incidentReports/${id}`), {
    incident_id: id, incident_datetime: Timestamp.fromDate(new Date('2026-07-30T10:00:00Z')),
    reported_at: serverTimestamp(), location: 'Lobby', location_type: 'common_area',
    location_name_snapshot: 'Lobby', incident_type: 'อุปกรณ์ชำรุด',
    description: 'พบอุปกรณ์ชำรุด', photo_url: 'https://drive.google.com/file/d/INCIDENTPHOTO123/view',
    photo_file_id: `INCIDENTPHOTO${suffix}`,
    reported_by: 'Guard A', shift_leader: '', priority: 'Normal', status: 'แจ้งแล้ว',
    incident_status: 'reported', alert_status: 'active',
    recorded_by_uid: 'guard-a', site_id: siteId,
    created_at: serverTimestamp(), updated_at: serverTimestamp(), ...overrides,
  });
  transaction.set(doc(database, `auditLogs/INCIDENT_REPORTED_${id}`), {
    audit_id: `INCIDENT_REPORTED_${id}`, operator_id: 'guard-a', account_uid: 'guard-a',
    user_name: 'Guard A', operator_name: 'Guard A', site_id: siteId,
    action: 'IncidentReported', module_name: 'IncidentReports', record_id: id,
    old_value: '', new_value: 'แจ้งแล้ว', action_result: 'Success',
    created_at: serverTimestamp(),
  });
});

const seedOperationalMedia = async (siteId: string, suffix: string) => {
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, `mediaUploads/PATROLONE${suffix}`), {
        site_id: siteId, module: 'Patrol', module_name: 'PatrolLogs',
        record_id: `patrol-${suffix}`, media_type: 'patrol_photo_1',
      }),
      setDoc(doc(database, `mediaUploads/PATROLTWO${suffix}`), {
        site_id: siteId, module: 'Patrol', module_name: 'PatrolLogs',
        record_id: `patrol-${suffix}`, media_type: 'patrol_photo_2',
      }),
      setDoc(doc(database, `mediaUploads/INCIDENTPHOTO${suffix}`), {
        site_id: siteId, module: 'Incident', module_name: 'IncidentReports',
        record_id: `incident-${suffix}`, media_type: 'incident_photo',
      }),
    ]);
  });
};

test('Patrol same-site atomic check-in succeeds with one required evidence reference', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await seedOperationalMedia('site-a', 'one-photo');
  await assertSucceeds(patrolCheckinTransaction(database, 'site-a', 'one-photo', {}, false));
  const record = await getDoc(doc(database, 'patrolLogs/patrol-one-photo'));
  assert.ok(record.get('checkin_time') instanceof Timestamp);
  assert.equal(record.get('evidence_photo_2_url'), undefined);
  await assertFails(updateDoc(record.ref, { abnormal_reason: 'tampered' }));
});

test('Patrol same-site atomic check-in succeeds with two distinct evidence references', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await seedOperationalMedia('site-a', 'positive');
  await assertSucceeds(patrolCheckinTransaction(database, 'site-a', 'positive'));
  const record = await getDoc(doc(database, 'patrolLogs/patrol-positive'));
  assert.ok(record.get('checkin_time') instanceof Timestamp);
  assert.ok(record.get('created_at') instanceof Timestamp);
  await assertFails(updateDoc(record.ref, { abnormal_reason: 'tampered' }));
});

test('Patrol rejects cross-site, missing first evidence, invalid second evidence, duplicates, abnormal without reason, and arbitrary fields', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  for (const suffix of ['cross-site', 'missing-photo', 'partial-photo2', 'duplicate', 'reason', 'extra']) {
    await seedOperationalMedia(suffix === 'cross-site' ? 'site-b' : 'site-a', suffix);
  }
  await assertFails(patrolCheckinTransaction(database, 'site-b', 'cross-site'));
  await assertFails(patrolCheckinTransaction(database, 'site-a', 'missing-photo', { evidence_photo_1_url: '' }, false));
  await assertFails(patrolCheckinTransaction(database, 'site-a', 'partial-photo2', {
    evidence_photo_2_url: 'https://drive.google.com/file/d/PARTIALPHOTO2/view',
  }, false));
  await assertFails(patrolCheckinTransaction(database, 'site-a', 'duplicate', {
    incident_photo_url: 'https://drive.google.com/file/d/PATROLPHOTOONE123/view',
    evidence_photo_2_url: 'https://drive.google.com/file/d/PATROLPHOTOONE123/view',
    evidence_photo_2_file_id: 'PATROLONEduplicate',
  }));
  await assertFails(patrolCheckinTransaction(database, 'site-a', 'reason', {
    area_status: 'abnormal', status: 'ผิดปกติ', abnormal_reason: '',
  }));
  await assertFails(patrolCheckinTransaction(database, 'site-a', 'extra', { role: 'Admin' }));
});

test('Incident same-site atomic create preserves separate event and server report timestamps', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await seedOperationalMedia('site-a', 'positive');
  await assertSucceeds(incidentCreateTransaction(database, 'site-a', 'positive'));
  const record = await getDoc(doc(database, 'incidentReports/incident-positive'));
  assert.ok(record.get('incident_datetime') instanceof Timestamp);
  assert.ok(record.get('reported_at') instanceof Timestamp);
  assert.notDeepEqual(record.get('incident_datetime'), record.get('reported_at'));
});

test('Incident acknowledgement requires Manager/Admin, same-site atomic audit, and preserves first timestamp', async () => {
  const guard = environment.authenticatedContext('guard-a').firestore();
  const manager = environment.authenticatedContext('manager-a').firestore();
  await seedOperationalMedia('site-a', 'ack');
  await assertSucceeds(incidentCreateTransaction(guard, 'site-a', 'ack'));
  const incidentRef = doc(manager, 'incidentReports/incident-ack');
  const auditRef = doc(manager, 'auditLogs/INCIDENT_ACKNOWLEDGE_incident-ack');
  await assertFails(updateDoc(doc(guard, 'incidentReports/incident-ack'), {
    incident_status: 'acknowledged', alert_status: 'acknowledged',
    acknowledged_at: serverTimestamp(), acknowledged_by: 'guard-a',
    updated_at: serverTimestamp(),
  }));
  await assertSucceeds(runTransaction(manager, async transaction => {
    transaction.update(incidentRef, {
      incident_status: 'acknowledged', alert_status: 'acknowledged',
      acknowledged_at: serverTimestamp(), acknowledged_by: 'manager-a',
      updated_at: serverTimestamp(),
    });
    transaction.set(auditRef, {
      audit_id: auditRef.id, operator_id: 'manager-a', account_uid: 'manager-a',
      user_name: 'Manager A', operator_name: 'Manager A', site_id: 'site-a',
      action: 'Incident:acknowledge', module_name: 'IncidentReports', record_id: 'incident-ack',
      old_value: 'reported', new_value: 'acknowledged', action_result: 'Success',
      created_at: serverTimestamp(),
    });
  }));
  const acknowledged = await getDoc(incidentRef);
  assert.ok(acknowledged.get('acknowledged_at') instanceof Timestamp);
  await assertFails(updateDoc(incidentRef, {
    acknowledged_at: serverTimestamp(), updated_at: serverTimestamp(),
  }));
});

test('Incident rejects cross-site, arbitrary mutation, missing photo, and client-owned reported_at', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  for (const suffix of ['cross-site', 'missing-photo', 'client-time', 'tamper']) {
    await seedOperationalMedia(suffix === 'cross-site' ? 'site-b' : 'site-a', suffix);
  }
  await assertFails(incidentCreateTransaction(database, 'site-b', 'cross-site'));
  await assertFails(incidentCreateTransaction(database, 'site-a', 'missing-photo', { photo_url: '' }));
  await assertFails(incidentCreateTransaction(database, 'site-a', 'client-time', { reported_at: Timestamp.fromDate(new Date(0)) }));
  await assertSucceeds(incidentCreateTransaction(database, 'site-a', 'tamper'));
  await assertFails(updateDoc(doc(database, 'incidentReports/incident-tamper'), {
    description: 'forged', updated_at: serverTimestamp(),
  }));
});
