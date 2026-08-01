import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createUuid } from '../utils/uuid';
import type {
  ParkingCardRecord,
  VehicleLogRecord,
  VehicleSessionActivity,
  VehicleSessionRecord,
  VehicleSessionStage,
  VehicleSessionStatus,
} from '../types';
import { normalizeCardNumber, normalizeParkingCardData, normalizeQrValue } from './parkingCardService';
import { sanitizeAndValidateFirestoreData } from './firestoreData';
import { appendSessionActivityInTransaction } from './vehicleSessionActivityService';
import { firestoreQueueMetricTransition } from './vehicleSessionMetricsFirestore';
import { assertExpectedSessionVersion } from './vehicleSessionVersionService';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FUNCTIONS_REGION } from '../config/firebaseFunctions';
import { toEpochMillis } from '../utils/dateTime';

const SESSION_COLLECTION = 'vehicleSessions';
const LOCK_DURATION_MS = 5 * 60 * 1000;
const pendingStatuses: VehicleSessionStatus[] = [
  'Draft', 'Pending', 'WaitingPhoto', 'WaitingVisitor',
  'WaitingDestination', 'WaitingEvidence', 'Ready',
];

const timestampText = (value: unknown): string =>
  value instanceof Timestamp ? value.toDate().toISOString() :
    typeof value === 'string' ? value : '';

const identity = (operatorName: string) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('ต้องเข้าสู่ระบบก่อนดำเนินการ Vehicle Session');
  return { uid, operatorName: operatorName.trim() || 'ผู้ปฏิบัติงาน' };
};

function sessionFromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>): VehicleSessionRecord {
  const data = snapshot.data();
  const metrics = typeof data.queueMetrics === 'object' && data.queueMetrics !== null
    ? data.queueMetrics as Record<string, unknown> : {};
  const metricTimestamp = (field: string) => metrics[field] instanceof Timestamp ? metrics[field] as Timestamp : null;
  const metricNumber = (field: string) => typeof metrics[field] === 'number' ? Math.max(0, metrics[field] as number) : 0;
  const activity = Array.isArray(data.activity) ? data.activity.map(item => {
    const row = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
    return {
      action: String(row.action ?? ''),
      stage: String(row.stage ?? 'Created') as VehicleSessionStage,
      by: String(row.by ?? ''),
      byName: String(row.byName ?? ''),
      at: timestampText(row.at),
    };
  }) : [];
  return {
    session_id: String(data.session_id ?? snapshot.id),
    site_id: String(data.site_id ?? ''),
    parking_card_id: String(data.parking_card_id ?? ''),
    card_number: String(data.card_number ?? ''),
    stage: String(data.stage ?? 'Created') as VehicleSessionStage,
    status: String(data.status ?? 'Draft') as VehicleSessionStatus,
    opened_by: String(data.opened_by ?? ''),
    opened_by_name: String(data.opened_by_name ?? ''),
    current_owner: String(data.current_owner ?? ''),
    last_updated_by: String(data.last_updated_by ?? ''),
    assigned_to: String(data.assigned_to ?? ''),
    queueStatus: String(data.queueStatus ?? 'Waiting') as VehicleSessionRecord['queueStatus'],
    priority: String(data.priority ?? 'Normal') as VehicleSessionRecord['priority'],
    assignedTo: data.assignedTo == null
      ? (data.assigned_to ? String(data.assigned_to) : null)
      : String(data.assignedTo),
    assignedBy: data.assignedBy == null ? null : String(data.assignedBy),
    assignedAt: timestampText(data.assignedAt) || undefined,
    queuePosition: data.queuePosition == null ? null : Number(data.queuePosition),
    sessionVersion: typeof data.sessionVersion === 'number' ? data.sessionVersion : 0,
    assignmentVersion: typeof data.assignmentVersion === 'number' ? data.assignmentVersion : 0,
    queueMetrics: {
      firstQueuedAt: metricTimestamp('firstQueuedAt'), firstAssignedAt: metricTimestamp('firstAssignedAt'),
      workStartedAt: metricTimestamp('workStartedAt'), readyAt: metricTimestamp('readyAt'),
      completedAt: metricTimestamp('completedAt'), waitingSeconds: metricNumber('waitingSeconds'),
      workingSeconds: metricNumber('workingSeconds'), totalCycleSeconds: metricNumber('totalCycleSeconds'),
      transferCount: metricNumber('transferCount'), reassignCount: metricNumber('reassignCount'),
      releaseCount: metricNumber('releaseCount'), priorityChangeCount: metricNumber('priorityChangeCount'),
      lastTransitionAt: metricTimestamp('lastTransitionAt'),
      lastEventId: typeof metrics.lastEventId === 'string' ? metrics.lastEventId : '',
      metricsVersion: metricNumber('metricsVersion') || 1,
    },
    last_activity_at: timestampText(data.last_activity_at),
    editing_by: data.editing_by ? String(data.editing_by) : undefined,
    editing_by_name: data.editing_by_name ? String(data.editing_by_name) : undefined,
    editing_since: timestampText(data.editing_since) || undefined,
    expires_at: timestampText(data.expires_at) || undefined,
    vehicle_plate: data.vehicle_plate ? String(data.vehicle_plate) : undefined,
    vehicle_type: data.vehicle_type as VehicleLogRecord['vehicle_type'] | undefined,
    visitor_name: data.visitor_name ? String(data.visitor_name) : undefined,
    visitor_phone: data.visitor_phone ? String(data.visitor_phone) : undefined,
    target_room: data.target_room ? String(data.target_room) : undefined,
    target_unit_id: data.target_unit_id ? String(data.target_unit_id) : undefined,
    target_building: data.target_building ? String(data.target_building) : undefined,
    unit_lookup_status: data.unit_lookup_status === 'matched' || data.unit_lookup_status === 'manual' ? data.unit_lookup_status : undefined,
    purpose: data.purpose ? String(data.purpose) : undefined,
    note: data.note ? String(data.note) : undefined,
    entry_plate_photo_url: data.entry_plate_photo_url ? String(data.entry_plate_photo_url) : undefined,
    entry_vehicle_photo_url: data.entry_vehicle_photo_url ? String(data.entry_vehicle_photo_url) : undefined,
    vehicle_log_id: data.vehicle_log_id ? String(data.vehicle_log_id) : undefined,
    activity,
    created_at: timestampText(data.created_at),
    updated_at: timestampText(data.updated_at),
  };
}

function vehicleLogFromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>): VehicleLogRecord {
  const data = snapshot.data();
  return {
    ...data,
    log_id: String(data.log_id ?? snapshot.id),
    site_id: String(data.site_id ?? ''),
    entry_time: timestampText(data.entry_time),
    exit_time: timestampText(data.exit_time) || undefined,
    created_at: timestampText(data.created_at),
    updated_at: timestampText(data.updated_at),
  } as VehicleLogRecord;
}

export async function listVehicleHistory(siteId: string): Promise<VehicleLogRecord[]> {
  const scopedSiteId = siteId.trim();
  if (!scopedSiteId) throw new Error('siteId is required.');
  const snapshot = await getDocs(query(
    collection(db, 'vehicleLogs'),
    where('site_id', '==', scopedSiteId),
  ));
  return snapshot.docs
    .map(vehicleLogFromSnapshot)
    .sort((left, right) => toEpochMillis(right.entry_time) - toEpochMillis(left.entry_time));
}

async function findCard(rawValue: string, siteId: string): Promise<ParkingCardRecord> {
  const raw = rawValue.trim();
  const normalizedCard = normalizeCardNumber(raw);
  const normalizedQr = normalizeQrValue(raw);

  const snapshots = await Promise.all([
    getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('card_number_normalized', '==', normalizedCard), limit(2))),
    getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('qr_code_normalized', '==', normalizedQr), limit(2))),
    getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('card_number', '==', raw), limit(2))),
    getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('qr_code_value', '==', raw), limit(2))),
  ]);

  const matches = new Map(
    snapshots.flatMap(snapshot => snapshot.docs).map(item => [item.id, item]),
  );

  console.info('[Vehicle Session Card Lookup]', {
    raw,
    normalizedCard,
    normalizedQr,
    siteId,
    matches: [...matches.keys()],
  });

  if (matches.size > 1) {
    throw new Error('พบบัตรซ้ำ กรุณาให้ผู้ดูแลตรวจสอบข้อมูล');
  }

  if (matches.size === 0) {
    try {
      const diagnosticSnapshots = await Promise.all([
        getDocs(query(
          collection(db, 'parkingCards'),
          where('card_number_normalized', '==', normalizedCard),
          limit(5),
        )),
        getDocs(query(
          collection(db, 'parkingCards'),
          where('qr_code_normalized', '==', normalizedQr),
          limit(5),
        )),
        getDocs(query(
          collection(db, 'parkingCards'),
          where('card_number', '==', raw),
          limit(5),
        )),
        getDocs(query(
          collection(db, 'parkingCards'),
          where('qr_code_value', '==', raw),
          limit(5),
        )),
      ]);

      const diagnosticMatches = new Map(
        diagnosticSnapshots
          .flatMap(snapshot => snapshot.docs)
          .map(item => [item.id, {
            documentId: item.id,
            siteId: String(item.data().site_id ?? ''),
            cardNumber: String(item.data().card_number ?? ''),
            qrCodeValue: String(item.data().qr_code_value ?? ''),
            status: String(item.data().status ?? ''),
          }]),
      );

      console.warn('[Vehicle Session Card Lookup - Unscoped Diagnostic]', {
        raw,
        requestedSiteId: siteId,
        matches: [...diagnosticMatches.values()],
      });
    } catch (diagnosticError) {
      const code = typeof diagnosticError === 'object' && diagnosticError !== null && 'code' in diagnosticError
        ? String(diagnosticError.code)
        : 'unknown';
      console.warn('[Vehicle Session Card Lookup - Unscoped Diagnostic Unavailable]', {
        raw,
        requestedSiteId: siteId,
        code,
      });
    }

    throw new Error(`ไม่พบบัตรจอดรถ ${raw} ในพื้นที่ ${siteId}`);
  }

  const snapshot = [...matches.values()][0];
  return normalizeParkingCardData(snapshot.id, snapshot.data());
}

function auditReference() {
  const auditId = `AUD_${createUuid()}`;
  return { auditId, reference: doc(db, 'auditLogs', auditId) };
}

async function applyVehicleSessionAnalytics(sessionId: string, siteId: string, workflow: string) {
  const callable = httpsCallable<Record<string, unknown>, unknown>(
    getFunctions(undefined, FUNCTIONS_REGION),
    'applyVehicleSessionAnalyticsUpdate',
  );
  await callable({ sessionId, siteId, workflow });
}

export async function createVehicleSessionFromScan(rawValue: string, requestedSiteId: string, operatorName: string, actorRole = 'Guard') {
  const actor = identity(operatorName);
  const profileReference = doc(db, 'users', actor.uid);
  const profileSnapshot = await getDoc(profileReference);
  if (!profileSnapshot.exists()) throw new Error('ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่');

  const profile = profileSnapshot.data();
  if (profile.status !== 'Active') throw new Error('บัญชีผู้ใช้งานไม่ได้อยู่ในสถานะ Active');
  if (typeof profile.site_id !== 'string' || !profile.site_id.trim()) {
    throw new Error('ข้อมูลผู้ใช้งานไม่มีพื้นที่ปฏิบัติงาน กรุณาติดต่อผู้ดูแลระบบ');
  }
  if (typeof profile.operator_name !== 'string' || !profile.operator_name.trim()) {
    throw new Error('ข้อมูลผู้ใช้งานไม่มีชื่อผู้ปฏิบัติงาน กรุณาติดต่อผู้ดูแลระบบ');
  }
  if (typeof profile.role !== 'string' || !profile.role.trim()) {
    throw new Error('ข้อมูลผู้ใช้งานไม่มีสิทธิ์การใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }

  // Preserve the exact Firestore profile values because Security Rules
  // compare actor identity and site using exact equality.
  const siteId = profile.site_id;
  const canonicalOperatorName = profile.operator_name;
  const canonicalActorRole = profile.role;

  if (requestedSiteId !== siteId) {
    throw new Error('พื้นที่ที่ร้องขอไม่ตรงกับพื้นที่ของบัญชีผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่');
  }

  console.info('[Vehicle Session Canonical Identity]', {
    authUid: actor.uid,
    requestedSiteId,
    requestedOperatorName: operatorName,
    requestedActorRole: actorRole,
    canonicalSiteId: siteId,
    canonicalOperatorName,
    canonicalActorRole,
  });

  const card = await findCard(rawValue, siteId);
  if (card.status === 'Reserved') {
    const linkedSessionId = String(card.current_vehicle_session_id || '');
    if (!linkedSessionId) {
      throw new Error(`บัตร ${card.card_number} ถูกจอง แต่ไม่มี Vehicle Session อ้างอิง กรุณาติดต่อหัวหน้ากะ`);
    }
    const linkedSession = await getDoc(doc(db, SESSION_COLLECTION, linkedSessionId));
    if (!linkedSession.exists()
        || linkedSession.get('site_id') !== siteId
        || linkedSession.get('parking_card_id') !== card.firestore_document_id
        || ['Completed', 'Cancelled'].includes(String(linkedSession.get('status') || ''))) {
      throw new Error(`ข้อมูลการจองบัตร ${card.card_number} ไม่สอดคล้องกับ Vehicle Session`);
    }
    console.info('[Vehicle Session Existing Reservation Reused]', {
      timestamp: new Date().toISOString(),
      cardDocumentId: card.firestore_document_id,
      sessionId: linkedSessionId,
    });
    return linkedSessionId;
  }
  if (card.status === 'InUse') {
    throw new Error(`บัตร ${card.card_number} อยู่ระหว่างใช้งาน กรุณาดำเนินการผ่านขั้นตอนรถออก`);
  }
  if (card.status !== 'Available') {
    throw new Error(`บัตร ${card.card_number} ไม่พร้อมใช้งาน (${card.status})`);
  }
  const sessionId = `VS_${createUuid()}`;
  const eventId = `SESSION_${createUuid()}`;
  const audit = auditReference();
  const sessionRef = doc(db, SESSION_COLLECTION, sessionId);
  const cardRef = doc(db, 'parkingCards', card.firestore_document_id);
  console.info('[Vehicle Session Transaction Start]', {
    timestamp: new Date().toISOString(),
    rawValue,
    sessionId,
    activityId: eventId,
    auditId: audit.auditId,
    cardDocumentId: card.firestore_document_id,
  });
  await runTransaction(db, async transaction => {
    const currentCard = await transaction.get(cardRef);
    if (!currentCard.exists()) throw new Error('ไม่พบบัตรจอดรถ');
    const current = normalizeParkingCardData(currentCard.id, currentCard.data());
    if (current.status !== 'Available') throw new Error(`บัตรนี้ไม่พร้อมใช้งาน (${current.status})`);
    const occurredAt = Timestamp.now();
    transaction.set(sessionRef, {
      session_id: sessionId, site_id: siteId, parking_card_id: card.firestore_document_id,
      card_number: card.card_number, stage: 'CardIssued', status: 'Pending',
      opened_by: actor.uid, opened_by_name: canonicalOperatorName, current_owner: actor.uid,
      last_updated_by: actor.uid, assigned_to: actor.uid, assignedTo: actor.uid, assignedBy: actor.uid,
      assignedAt: serverTimestamp(), queueStatus: 'Assigned', priority: 'Normal', queuePosition: Date.now(),
      last_activity_at: serverTimestamp(),
      activity: [],
      stage_updates: { CardIssued: { updatedBy: actor.uid, updatedAt: serverTimestamp() } },
      assignmentVersion: 0, queueSchemaVersion: 1,
      sessionVersion: 1,
      queueMetrics: firestoreQueueMetricTransition({ queueStatus: 'Waiting' }, 'Assigned', 'TakeJob', eventId, occurredAt),
      created_at: serverTimestamp(), updated_at: serverTimestamp(),
    });
    appendSessionActivityInTransaction(transaction, {
      sessionId, siteId, action: 'SessionCreatedFromQr', toStage: 'CardIssued',
      toStatus: 'Pending', actorName: canonicalOperatorName, actorRole: canonicalActorRole,
      clientEventId: eventId,
    }, actor.uid);
    transaction.update(cardRef, {
      status: 'Reserved', status_normalized: 'Reserved', current_vehicle_session_id: sessionId,
      last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
    });
    transaction.set(audit.reference, {
      audit_id: audit.auditId, module_name: 'VehicleSessions',
      record_id: sessionId, action: 'Created->CardIssued', operator_id: actor.uid,
      account_uid: actor.uid, site_id: siteId, created_at: serverTimestamp(),
    });
  });
  console.info('[Vehicle Session Transaction Committed]', {
    timestamp: new Date().toISOString(),
    sessionId,
    activityId: eventId,
    auditId: audit.auditId,
    cardDocumentId: card.firestore_document_id,
  });
  await applyVehicleSessionAnalytics(sessionId, siteId, 'Vehicle Entry');
  return sessionId;
}

export interface VehicleSessionPatch {
  vehicle_plate?: string;
  vehicle_type?: VehicleLogRecord['vehicle_type'];
  visitor_name?: string;
  visitor_phone?: string;
  target_room?: string;
  target_unit_id?: string;
  target_building?: string;
  unit_lookup_status?: 'matched' | 'manual';
  purpose?: string;
  note?: string;
  entry_plate_photo_url?: string;
  entry_vehicle_photo_url?: string;
}

export async function updateVehicleSession(
  sessionId: string,
  patch: VehicleSessionPatch,
  stage: VehicleSessionStage,
  status: VehicleSessionStatus,
  operatorName: string,
  actorRole = 'Guard',
  expectedVersion?: number,
) {
  const actor = identity(operatorName);
  const queueStatus = status === 'Ready' ? 'Ready' :
    status.startsWith('Waiting') ? 'Waiting Information' : 'In Progress';
  const reference = doc(db, SESSION_COLLECTION, sessionId);
  const result = await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('ไม่พบ Vehicle Session');
    const actualVersion = typeof snapshot.get('sessionVersion') === 'number' ? snapshot.get('sessionVersion') as number : 0;
    if (expectedVersion !== undefined) assertExpectedSessionVersion(sessionId, expectedVersion, actualVersion, snapshot.data());
    const eventId = `SESSION_${createUuid()}`;
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...patch, stage, status, queueStatus, last_updated_by: actor.uid,
      sessionVersion: actualVersion + 1,
      last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
      [`stage_updates.${stage}`]: { updatedBy: actor.uid, updatedAt: serverTimestamp() },
    }));
    appendSessionActivityInTransaction(transaction, {
      sessionId, siteId: snapshot.get('site_id'), action: 'QueueStatusChange',
      fromStage: snapshot.get('stage'), toStage: stage,
      fromStatus: snapshot.get('status'), toStatus: status,
      actorName: actor.operatorName, actorRole,
      details: { queue_status: queueStatus }, clientEventId: eventId,
    }, actor.uid);
    const audit = auditReference();
    transaction.set(audit.reference, {
      audit_id: audit.auditId, module_name: 'VehicleSessions',
      record_id: sessionId, action: `Stage:${stage}`, operator_id: actor.uid,
      account_uid: actor.uid, site_id: snapshot.get('site_id'), created_at: serverTimestamp(),
    });
    return { nextVersion: actualVersion + 1, siteId: String(snapshot.get('site_id') || '') };
  });
  await applyVehicleSessionAnalytics(sessionId, result.siteId, 'Vehicle Update');
  return result.nextVersion;
}

export async function updateActiveVehicleSession(
  sessionId: string,
  patch: VehicleSessionPatch,
  operatorName: string,
  actorRole: string,
  expectedVersion: number,
): Promise<number> {
  const actor = identity(operatorName);
  return runTransaction(db, async transaction => {
    const sessionReference = doc(db, SESSION_COLLECTION, sessionId);
    const sessionSnapshot = await transaction.get(sessionReference);
    if (!sessionSnapshot.exists()) throw new Error('ไม่พบ Vehicle Session');
    const data = sessionSnapshot.data();
    const actualVersion = typeof data.sessionVersion === 'number' ? data.sessionVersion : 0;
    assertExpectedSessionVersion(sessionId, expectedVersion, actualVersion, data);
    if (data.stage !== 'Active' || data.status !== 'InProgress' || !data.vehicle_log_id) {
      throw new Error('แก้ข้อมูลหลังรถเข้าได้เฉพาะ Session ที่รถอยู่ในพื้นที่');
    }
    const logReference = doc(db, 'vehicleLogs', String(data.vehicle_log_id));
    const logSnapshot = await transaction.get(logReference);
    if (!logSnapshot.exists() || logSnapshot.get('vehicle_session_id') !== sessionId || logSnapshot.get('status') !== 'กำลังจอด') {
      throw new Error('ข้อมูล Vehicle Log ไม่สอดคล้องกับ Session');
    }
    const eventId = `SESSION_${createUuid()}`;
    const mutablePatch = sanitizeAndValidateFirestoreData({ ...patch });
    transaction.update(sessionReference, {
      ...mutablePatch,
      last_updated_by: actor.uid,
      sessionVersion: actualVersion + 1,
      last_activity_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    transaction.update(logReference, {
      ...mutablePatch,
      updated_at: serverTimestamp(),
    });
    appendSessionActivityInTransaction(transaction, {
      sessionId,
      siteId: String(data.site_id),
      action: 'ActiveVehicleDetailsUpdated',
      fromStage: 'Active',
      toStage: 'Active',
      fromStatus: 'InProgress',
      toStatus: 'InProgress',
      actorName: actor.operatorName,
      actorRole,
      details: { vehicle_log_id: String(data.vehicle_log_id) },
      clientEventId: eventId,
    }, actor.uid);
    const audit = auditReference();
    transaction.set(audit.reference, {
      audit_id: audit.auditId,
      module_name: 'VehicleSessions',
      record_id: sessionId,
      vehicle_log_id: String(data.vehicle_log_id),
      action: 'ActiveDetailsUpdated',
      operator_id: actor.uid,
      account_uid: actor.uid,
      site_id: String(data.site_id),
      created_at: serverTimestamp(),
    });
    return actualVersion + 1;
  });
}

export async function getVehicleSession(sessionId: string): Promise<VehicleSessionRecord> {
  const snapshot = await getDoc(doc(db, SESSION_COLLECTION, sessionId));
  if (!snapshot.exists()) throw new Error('ไม่พบ Vehicle Session');
  const session = sessionFromSnapshot(snapshot);
  if ((!session.entry_plate_photo_url || !session.entry_vehicle_photo_url) && session.vehicle_log_id) {
    const logSnapshot = await getDoc(doc(db, 'vehicleLogs', session.vehicle_log_id));
    if (logSnapshot.exists()) {
      const log = vehicleLogFromSnapshot(logSnapshot);
      return {
        ...session,
        entry_plate_photo_url: session.entry_plate_photo_url || log.entry_plate_photo_url,
        entry_vehicle_photo_url: session.entry_vehicle_photo_url || log.entry_vehicle_photo_url,
      };
    }
  }
  return session;
}

export async function acquireVehicleSessionLock(sessionId: string, operatorName: string, adminOverride = false, expectedVersion?: number): Promise<VehicleSessionRecord> {
  const actor = identity(operatorName);
  await runTransaction(db, async transaction => {
    const reference = doc(db, SESSION_COLLECTION, sessionId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('ไม่พบ Vehicle Session');
    const actualVersion = typeof snapshot.get('sessionVersion') === 'number' ? snapshot.get('sessionVersion') as number : 0;
    if (expectedVersion !== undefined) assertExpectedSessionVersion(sessionId, expectedVersion, actualVersion, snapshot.data());
    const editingBy = String(snapshot.get('editing_by') ?? '');
    const expiresAt = snapshot.get('expires_at');
    const locked = expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now();
    if (locked && editingBy !== actor.uid && !adminOverride) throw new Error('รายการนี้กำลังแก้ไขโดยผู้ปฏิบัติงานท่านอื่น');
    transaction.update(reference, {
      editing_by: actor.uid, editing_by_name: actor.operatorName,
      editing_since: serverTimestamp(), expires_at: Timestamp.fromMillis(Date.now() + LOCK_DURATION_MS),
      last_updated_by: actor.uid, last_activity_at: serverTimestamp(),
      sessionVersion: actualVersion + 1,
    });
  });
  return getVehicleSession(sessionId);
}

export async function releaseVehicleSessionLock(sessionId: string) {
  const actor = identity('');
  await runTransaction(db, async transaction => {
    const reference = doc(db, SESSION_COLLECTION, sessionId);
    const snapshot = await transaction.get(reference);
    if (snapshot.exists() && snapshot.get('editing_by') === actor.uid) {
      const actualVersion = typeof snapshot.get('sessionVersion') === 'number' ? snapshot.get('sessionVersion') as number : 0;
      transaction.update(reference, { editing_by: '', editing_by_name: '', editing_since: null, expires_at: null, sessionVersion: actualVersion + 1, last_updated_by: actor.uid, updated_at: serverTimestamp() });
    }
  });
}

export async function completeVehicleSession(sessionId: string, operatorName: string, actorRole = 'Guard', expectedVersion?: number) {
  const actor = identity(operatorName);
  const result = await runTransaction(db, async transaction => {
    const sessionRef = doc(db, SESSION_COLLECTION, sessionId);
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists()) throw new Error('ไม่พบ Vehicle Session');
    const data = sessionSnapshot.data();
    const actualVersion = typeof data.sessionVersion === 'number' ? data.sessionVersion : 0;
    if (expectedVersion !== undefined) assertExpectedSessionVersion(sessionId, expectedVersion, actualVersion, data);
    if (!data.vehicle_plate || !data.target_room) {
      throw new Error('กรุณาระบุทะเบียนรถและปลายทาง');
    }
    if (data.stage === 'Active' && data.status === 'InProgress' && data.vehicle_log_id) {
      return { logId: String(data.vehicle_log_id), siteId: String(data.site_id || ''), alreadyActive: true };
    }
    if (data.status === 'Completed' || data.status === 'Cancelled') throw new Error('Vehicle Session นี้ปิดแล้ว');
    if (data.stage !== 'Ready' || data.status !== 'Ready') throw new Error('Vehicle Session ต้องอยู่ในสถานะพร้อมเข้าพื้นที่ก่อนยืนยัน');
    const cardRef = doc(db, 'parkingCards', String(data.parking_card_id));
    const cardSnapshot = await transaction.get(cardRef);
    if (!cardSnapshot.exists() || cardSnapshot.get('current_vehicle_session_id') !== sessionId || cardSnapshot.get('status') !== 'Reserved') {
      throw new Error('สถานะบัตรไม่ตรงกับ Vehicle Session');
    }
    const logId = `V_${createUuid()}`;
    const now = new Date().toISOString();
    const log = sanitizeAndValidateFirestoreData({
      log_id: logId, vehicle_session_id: sessionId, site_id: data.site_id, parking_card_id: data.parking_card_id,
      card_number: data.card_number, vehicle_plate: data.vehicle_plate,
      vehicle_type: data.vehicle_type || 'รถยนต์', visitor_name: data.visitor_name || '',
      visitor_phone: data.visitor_phone || '', target_room: data.target_room,
      target_unit_id: data.target_unit_id, target_building: data.target_building,
      unit_lookup_status: data.unit_lookup_status, purpose: data.purpose || '',
      entry_time: now, entry_plate_photo_url: data.entry_plate_photo_url,
      entry_vehicle_photo_url: data.entry_vehicle_photo_url, status: 'กำลังจอด',
      workflow_status: 'active', recorded_by: actor.operatorName, note: data.note || '',
      created_at: now, updated_at: now, operator_name: actor.operatorName,
      operator_id: actor.uid, account_uid: actor.uid,
    });
    transaction.set(doc(db, 'vehicleLogs', logId), log);
    transaction.update(cardRef, {
      status: 'InUse', status_normalized: 'InUse', current_vehicle_plate: data.vehicle_plate,
      current_vehicle_log_id: logId, current_vehicle_session_id: '',
      last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
    });
    const eventId = `SESSION_${createUuid()}`;
    transaction.update(sessionRef, {
      stage: 'Active', status: 'InProgress', queueStatus: 'In Progress', vehicle_log_id: logId,
      sessionVersion: actualVersion + 1,
      current_owner: actor.uid, last_updated_by: actor.uid, last_activity_at: serverTimestamp(),
      updated_at: serverTimestamp(), editing_by: '', editing_by_name: '', editing_since: null,
      expires_at: null, 'stage_updates.Active': { updatedBy: actor.uid, updatedAt: serverTimestamp() },
    });
    appendSessionActivityInTransaction(transaction, {
      sessionId, siteId: data.site_id, action: 'SessionCompletion',
      fromStage: data.stage, toStage: 'Active', fromStatus: data.status, toStatus: 'InProgress',
      actorName: actor.operatorName, actorRole, details: { vehicle_log_id: logId },
      clientEventId: eventId,
    }, actor.uid);
    const audit = auditReference();
    transaction.set(audit.reference, {
      audit_id: audit.auditId, module_name: 'VehicleSessions',
      record_id: sessionId, vehicle_log_id: logId, action: 'Ready->Active',
      operator_id: actor.uid, account_uid: actor.uid, site_id: data.site_id,
      created_at: serverTimestamp(),
    });
    return { logId, siteId: String(data.site_id || ''), alreadyActive: false };
  });
  if (!result.alreadyActive) await applyVehicleSessionAnalytics(sessionId, result.siteId, 'Vehicle Entry Completion');
  return { logId: result.logId, alreadyActive: result.alreadyActive };
}

export function subscribePendingVehicleSessions(siteId: string, callback: (sessions: VehicleSessionRecord[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, SESSION_COLLECTION), where('site_id', '==', siteId), where('status', 'in', pendingStatuses), orderBy('last_activity_at', 'desc'), limit(50)),
    snapshot => callback(snapshot.docs.map(sessionFromSnapshot)),
  );
}

export function subscribeAssignedVehicleSessions(siteId: string, callback: (sessions: VehicleSessionRecord[]) => void): Unsubscribe {
  const uid = auth.currentUser?.uid;
  if (!uid) return () => undefined;
  return onSnapshot(
    query(collection(db, SESSION_COLLECTION), where('site_id', '==', siteId), where('assignedTo', '==', uid), where('status', 'in', pendingStatuses), orderBy('last_activity_at', 'desc'), limit(50)),
    snapshot => callback(snapshot.docs.map(sessionFromSnapshot)),
  );
}

export function subscribeActiveVehicleSessions(siteId: string, callback: (sessions: VehicleSessionRecord[]) => void): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, SESSION_COLLECTION),
      where('site_id', '==', siteId),
      where('status', '==', 'InProgress'),
      orderBy('last_activity_at', 'desc'),
      limit(100),
    ),
    snapshot => callback(snapshot.docs.map(sessionFromSnapshot)),
  );
}
