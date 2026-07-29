import { doc, increment, runTransaction, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, db } from '../firebase';
import { FUNCTIONS_REGION } from '../config/firebaseFunctions';
import type { VehicleQueuePriority } from '../types';
import { appendSessionActivityInTransaction } from './vehicleSessionActivityService';
import { assertExpectedSessionVersion } from './vehicleSessionVersionService';

export interface QueueActor {
  operatorName: string;
  role: string;
  siteId: string;
}

export interface EligibleQueueOperator {
  uid: string;
  name: string;
  role: string;
  shift: string;
}

export async function listEligibleQueueOperators(siteId: string): Promise<EligibleQueueOperator[]> {
  const callable = httpsCallable<{ siteId: string }, { operators: EligibleQueueOperator[] }>(
    getFunctions(undefined, FUNCTIONS_REGION),
    'listEligibleQueueOperators',
  );
  const result = await callable({ siteId });
  return result.data.operators;
}

function actor(context: QueueActor) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('ต้องเข้าสู่ระบบก่อนจัดการคิว');
  return { uid, ...context };
}

export interface AssignmentOptions {
  note?: string;
  expectedAssignmentVersion?: number;
  expectedSessionVersion?: number;
  administrativeOverride?: boolean;
}

async function writeConflictAudit(sessionId: string, current: ReturnType<typeof actor>, message: string) {
  const auditId = `AUD_${crypto.randomUUID()}`;
  await setDoc(doc(db, 'auditLogs', auditId), {
    audit_id: auditId, module_name: 'VehicleSessions', record_id: sessionId,
    action: 'AssignmentConflict', operator_id: current.uid, account_uid: current.uid,
    site_id: current.siteId, reason: message.slice(0, 1000), created_at: serverTimestamp(),
  });
}

async function assign(sessionId: string, targetUid: string, action: string, context: QueueActor, options: AssignmentOptions = {}) {
  const current = actor(context);
  try {
    await runTransaction(db, async transaction => {
      const reference = doc(db, 'vehicleSessions', sessionId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists() || snapshot.get('site_id') !== current.siteId) throw new Error('ไม่พบงานในพื้นที่นี้');
      const assignedTo = String(snapshot.get('assignedTo') ?? '');
      const version = Number(snapshot.get('assignmentVersion') ?? 0);
      const sessionVersion = Number(snapshot.get('sessionVersion') ?? 0);
      if (options.expectedAssignmentVersion !== undefined && options.expectedAssignmentVersion !== version) throw new Error('ข้อมูลคิวถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรช');
      if (options.expectedSessionVersion !== undefined) assertExpectedSessionVersion(sessionId, options.expectedSessionVersion, sessionVersion, snapshot.data());
      if (action === 'TakeJob' && assignedTo && assignedTo !== current.uid) throw new Error('งานนี้มีผู้รับผิดชอบแล้ว กรุณารีเฟรชคิว');
      if (action === 'TransferJob' && !['ShiftHead', 'Manager', 'Admin'].includes(current.role)) throw new Error('ไม่มีสิทธิ์โอนงาน');
      const expiresAt = snapshot.get('expires_at');
      const activeForeignLock = expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now() && snapshot.get('editing_by') !== current.uid;
      if (action === 'TransferJob' && activeForeignLock && !options.administrativeOverride) throw new Error('งานกำลังถูกแก้ไขโดยผู้ใช้อื่น');
      const auditId = `AUD_${crypto.randomUUID()}`;
      const eventId = `QUEUE_${crypto.randomUUID()}`;
      const nextQueueStatus = targetUid ? 'Assigned' : 'Waiting';
      transaction.update(reference, {
        assignedTo: targetUid || null, assignedBy: current.uid,
        assignedAt: targetUid ? serverTimestamp() : null, queueStatus: nextQueueStatus,
        current_owner: targetUid || '', last_updated_by: current.uid, assignmentVersion: increment(1),
        sessionVersion: sessionVersion + 1,
        last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
      });
      appendSessionActivityInTransaction(transaction, {
        sessionId, siteId: current.siteId, action,
        fromStage: snapshot.get('stage'), toStage: snapshot.get('stage'),
        fromStatus: snapshot.get('status'), toStatus: snapshot.get('status'),
        actorName: current.operatorName, actorRole: current.role,
        details: { note: options.note || '', previous_assignee: assignedTo, new_assignee: targetUid },
        clientEventId: eventId,
      }, current.uid);
      transaction.set(doc(db, 'auditLogs', auditId), {
        audit_id: auditId, module_name: 'VehicleSessions', record_id: sessionId,
        action, operator_id: current.uid, account_uid: current.uid,
        site_id: current.siteId, reason: options.note || '', created_at: serverTimestamp(),
      });
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.includes('ผู้ใช้อื่น') || message.includes('ผู้รับผิดชอบแล้ว')) {
      await writeConflictAudit(sessionId, current, message);
    }
    throw reason;
  }
}

export const takeVehicleJob = (sessionId: string, context: QueueActor, options?: AssignmentOptions) =>
  assign(sessionId, actor(context).uid, 'TakeJob', context, options);

export const transferVehicleJob = (sessionId: string, targetUid: string, context: QueueActor, options?: AssignmentOptions) =>
  assign(sessionId, targetUid, options?.administrativeOverride ? 'AdministrativeOverride' : 'TransferJob', context, options);

export const releaseVehicleJob = (sessionId: string, context: QueueActor, options?: AssignmentOptions) =>
  assign(sessionId, '', 'ReleaseJob', context, options);

export async function setVehicleJobPriority(sessionId: string, priority: VehicleQueuePriority, context: QueueActor, options?: AssignmentOptions) {
  const current = actor(context);
  if (!['ShiftHead', 'Manager', 'Admin'].includes(current.role)) throw new Error('ไม่มีสิทธิ์กำหนด Priority');
  await runTransaction(db, async transaction => {
    const reference = doc(db, 'vehicleSessions', sessionId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists() || snapshot.get('site_id') !== current.siteId) throw new Error('ไม่พบงานในพื้นที่นี้');
    const auditId = `AUD_${crypto.randomUUID()}`;
    const sessionVersion = Number(snapshot.get('sessionVersion') ?? 0);
    if (options?.expectedSessionVersion !== undefined) assertExpectedSessionVersion(sessionId, options.expectedSessionVersion, sessionVersion, snapshot.data());
    const eventId = `QUEUE_${crypto.randomUUID()}`;
    transaction.update(reference, {
      priority, last_updated_by: current.uid, last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
      sessionVersion: sessionVersion + 1,
    });
    appendSessionActivityInTransaction(transaction, {
      sessionId, siteId: current.siteId, action: 'PriorityChange',
      fromStage: snapshot.get('stage'), toStage: snapshot.get('stage'),
      fromStatus: snapshot.get('status'), toStatus: snapshot.get('status'),
      actorName: current.operatorName, actorRole: current.role,
      details: { priority }, clientEventId: eventId,
    }, current.uid);
    transaction.set(doc(db, 'auditLogs', auditId), {
      audit_id: auditId, module_name: 'VehicleSessions', record_id: sessionId,
      action: `Priority:${priority}`, operator_id: current.uid, account_uid: current.uid,
      site_id: current.siteId, created_at: serverTimestamp(),
    });
  });
}
