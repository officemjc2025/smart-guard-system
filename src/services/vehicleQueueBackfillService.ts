import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { sanitizeAndValidateFirestoreData } from './firestoreData';
import { queueDefaultsForLegacy } from './vehicleQueueLogic';

const QUEUE_SCHEMA_VERSION = 1;
const requiredQueueFields = [
  'queueStatus', 'priority', 'assignedTo', 'assignedBy',
  'assignedAt', 'queuePosition', 'queueSchemaVersion', 'assignmentVersion',
  'sessionVersion', 'queueMetrics',
] as const;

export interface QueueBackfillError {
  documentId: string;
  message: string;
}

export interface QueueBackfillResult {
  scanned: number;
  eligible: number;
  skipped: number;
  updated: number;
  invalid: number;
  failed: number;
  lastDocumentId: string | null;
  errors: QueueBackfillError[];
}

export interface QueueBackfillOptions {
  siteId: string;
  batchSize?: number;
  startAfterDocumentId?: string;
  repairMode?: boolean;
  onProgress?: (result: QueueBackfillResult) => void;
}

const emptyResult = (): QueueBackfillResult => ({
  scanned: 0, eligible: 0, skipped: 0, updated: 0,
  invalid: 0, failed: 0, lastDocumentId: null, errors: [],
});

function validateLegacySession(snapshot: QueryDocumentSnapshot<DocumentData>, siteId: string): string | null {
  const data = snapshot.data();
  if (data.site_id !== siteId) return 'Session belongs to another site.';
  if (typeof data.session_id !== 'string' || data.session_id !== snapshot.id) return 'Invalid session_id.';
  if (typeof data.stage !== 'string' || typeof data.status !== 'string') return 'Missing stage or status.';
  return null;
}

function isMigrated(data: DocumentData): boolean {
  return data.queueSchemaVersion === QUEUE_SCHEMA_VERSION &&
    requiredQueueFields.every(field => field in data);
}

function migrationPayload(snapshot: DocumentSnapshot<DocumentData>, actorUid: string, repairMode: boolean) {
  const data = snapshot.data();
  const defaults = queueDefaultsForLegacy(data);
  const proposed = repairMode
    ? defaults
    : Object.fromEntries(Object.entries(defaults).filter(([key]) => !(key in data)));
  return sanitizeAndValidateFirestoreData({
    ...proposed,
    ...(!('assignmentVersion' in data) ? { assignmentVersion: 0 } : {}),
    ...(!('sessionVersion' in data) ? { sessionVersion: 0 } : {}),
    ...(!('queueMetrics' in data) ? { queueMetrics: {
      firstQueuedAt: null, firstAssignedAt: null, workStartedAt: null, readyAt: null, completedAt: null,
      waitingSeconds: 0, workingSeconds: 0, totalCycleSeconds: 0,
      transferCount: 0, reassignCount: 0, releaseCount: 0, priorityChangeCount: 0,
      lastTransitionAt: null, lastEventId: '', metricsVersion: 1,
    } } : {}),
    queue_migrated_at: serverTimestamp(),
    queue_migrated_by: actorUid,
    queueSchemaVersion: QUEUE_SCHEMA_VERSION,
  });
}

async function scanBackfill(
  options: QueueBackfillOptions,
  write: boolean,
): Promise<QueueBackfillResult> {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) throw new Error('ต้องเข้าสู่ระบบด้วย Admin ก่อนทำ Queue Backfill');
  const batchSize = Math.min(Math.max(options.batchSize ?? 200, 1), 400);
  const result = emptyResult();
  let cursor = options.startAfterDocumentId || '';
  while (true) {
    const pageQuery = cursor
      ? query(collection(db, 'vehicleSessions'), where('site_id', '==', options.siteId), orderBy(documentId()), startAfter(cursor), limit(batchSize))
      : query(collection(db, 'vehicleSessions'), where('site_id', '==', options.siteId), orderBy(documentId()), limit(batchSize));
    const page = await getDocs(pageQuery);
    if (page.empty) break;
    const batch = writeBatch(db);
    let pendingWrites = 0;
    for (const snapshot of page.docs) {
      result.scanned += 1;
      result.lastDocumentId = snapshot.id;
      cursor = snapshot.id;
      const invalidReason = validateLegacySession(snapshot, options.siteId);
      if (invalidReason) {
        result.invalid += 1;
        result.errors.push({ documentId: snapshot.id, message: invalidReason });
        continue;
      }
      if (isMigrated(snapshot.data()) && !options.repairMode) {
        result.skipped += 1;
        continue;
      }
      result.eligible += 1;
      if (write) {
        try {
          batch.update(snapshot.ref, migrationPayload(snapshot, actorUid, options.repairMode === true));
          pendingWrites += 1;
        } catch (reason) {
          result.failed += 1;
          result.errors.push({ documentId: snapshot.id, message: reason instanceof Error ? reason.message : String(reason) });
        }
      }
    }
    if (write && pendingWrites) {
      try {
        await batch.commit();
        result.updated += pendingWrites;
      } catch (reason) {
        result.failed += pendingWrites;
        result.errors.push({ documentId: result.lastDocumentId || '', message: reason instanceof Error ? reason.message : String(reason) });
        options.onProgress?.({ ...result, errors: [...result.errors] });
        break;
      }
    }
    options.onProgress?.({ ...result, errors: [...result.errors] });
    if (page.size < batchSize) break;
  }
  return result;
}

export const previewVehicleQueueBackfill = (options: QueueBackfillOptions) =>
  scanBackfill(options, false);

export const runVehicleQueueBackfill = (options: QueueBackfillOptions) =>
  scanBackfill(options, true);

export const resumeVehicleQueueBackfill = (options: QueueBackfillOptions, lastDocumentId: string) =>
  scanBackfill({ ...options, startAfterDocumentId: lastDocumentId }, true);

export async function repairVehicleQueueRecord(siteId: string, documentId: string): Promise<QueueBackfillResult> {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) throw new Error('ต้องเข้าสู่ระบบด้วย Admin ก่อนซ่อม Queue Record');
  const result = emptyResult();
  const snapshot = await getDoc(doc(db, 'vehicleSessions', documentId));
  if (!snapshot.exists() || snapshot.get('site_id') !== siteId) {
    result.invalid = 1;
    result.errors.push({ documentId, message: 'Session not found in the selected site.' });
    return result;
  }
  result.scanned = 1;
  result.eligible = 1;
  result.lastDocumentId = snapshot.id;
  const batch = writeBatch(db);
  batch.update(snapshot.ref, migrationPayload(snapshot, actorUid, true));
  await batch.commit();
  result.updated = 1;
  return result;
}
