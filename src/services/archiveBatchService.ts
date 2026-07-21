import {
  collection,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentSnapshot,
  type FieldValue,
  type FirestoreDataConverter,
  type UpdateData,
} from 'firebase/firestore';
import { db } from '../firebase';

const ARCHIVE_BATCHES_COLLECTION = 'archiveBatches';

export type ArchiveBatchStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export type ArchiveBatchVerificationStatus =
  | 'pending'
  | 'verified'
  | 'failed';

export interface ArchiveBatchWriteModel {
  sourceCollection: string;
  requestedBy: string;
  totalRecords: number;
  metadata?: Record<string, unknown>;
}

export interface ArchiveBatchMutableFields {
  status?: ArchiveBatchStatus;
  verificationStatus?: ArchiveBatchVerificationStatus;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ArchiveBatchRecord extends ArchiveBatchWriteModel {
  id: string;
  status: ArchiveBatchStatus;
  verificationStatus: ArchiveBatchVerificationStatus;
  processedCount: number;
  successCount: number;
  failedCount: number;
  retryCount: number;
  errorMessage: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
}

type ArchiveBatchFirestoreRecord = Omit<ArchiveBatchRecord, 'id'>;
type ArchiveBatchCreateData = Omit<ArchiveBatchFirestoreRecord, 'createdAt' | 'updatedAt'> & {
  createdAt: FieldValue;
  updatedAt: FieldValue;
};

type ArchiveBatchUpdateData = UpdateData<ArchiveBatchFirestoreRecord> & {
  updatedAt: FieldValue;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isArchiveBatchFirestoreRecord(
  value: unknown,
): value is ArchiveBatchFirestoreRecord {
  if (!isRecord(value)) return false;
  const metadataIsValid =
    value.metadata === undefined || isRecord(value.metadata);
  return (
    typeof value.sourceCollection === 'string' &&
    typeof value.requestedBy === 'string' &&
    typeof value.totalRecords === 'number' &&
    metadataIsValid &&
    ['pending', 'processing', 'completed', 'failed'].includes(String(value.status)) &&
    ['pending', 'verified', 'failed'].includes(String(value.verificationStatus)) &&
    typeof value.processedCount === 'number' &&
    typeof value.successCount === 'number' &&
    typeof value.failedCount === 'number' &&
    typeof value.retryCount === 'number' &&
    (typeof value.errorMessage === 'string' || value.errorMessage === null) &&
    value.createdAt instanceof Timestamp &&
    value.updatedAt instanceof Timestamp &&
    (value.completedAt instanceof Timestamp || value.completedAt === null)
  );
}

const archiveBatchConverter: FirestoreDataConverter<ArchiveBatchFirestoreRecord> = {
  toFirestore(model) {
    return model;
  },
  fromFirestore(snapshot) {
    const data: unknown = snapshot.data();
    if (!isArchiveBatchFirestoreRecord(data)) {
      throw new Error(`Archive batch "${snapshot.id}" contains invalid data.`);
    }
    return data;
  },
};

function archiveBatchReference(batchId: string) {
  const batches = collection(db, ARCHIVE_BATCHES_COLLECTION).withConverter(
    archiveBatchConverter,
  );
  return doc(batches, batchId);
}

function requireBatchId(batchId: string): void {
  if (!batchId.trim()) {
    throw new Error('Archive batch ID is required.');
  }
}

function toArchiveBatchRecord(
  snapshot: DocumentSnapshot<ArchiveBatchFirestoreRecord>,
): ArchiveBatchRecord {
  const snapshotId = snapshot.id;
  if (!snapshot.exists()) {
    throw new Error(`Archive batch "${snapshotId}" was not found.`);
  }

  return {
    id: snapshotId,
    ...snapshot.data(),
  };
}

async function readRequiredArchiveBatch(batchId: string): Promise<ArchiveBatchRecord> {
  const snapshot = await getDoc(archiveBatchReference(batchId));
  return toArchiveBatchRecord(snapshot);
}

/** Generates a collision-resistant, sortable client-side archive batch ID. */
export function generateBatchId(): string {
  const randomPart = globalThis.crypto.randomUUID().replace(/-/g, '');
  return `archive_${Date.now().toString(36)}_${randomPart}`;
}

/** Creates an archive batch and returns the server-resolved Firestore document. */
export async function createArchiveBatch(
  model: ArchiveBatchWriteModel,
): Promise<ArchiveBatchRecord> {
  if (!model.sourceCollection.trim()) {
    throw new Error('Archive source collection is required.');
  }
  if (!model.requestedBy.trim()) {
    throw new Error('Archive batch requester is required.');
  }
  if (!Number.isInteger(model.totalRecords) || model.totalRecords < 0) {
    throw new Error('Archive batch totalRecords must be a non-negative integer.');
  }

  const batchId = generateBatchId();
  const data: ArchiveBatchCreateData = {
    ...model,
    status: 'pending',
    verificationStatus: 'pending',
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    retryCount: 0,
    errorMessage: null,
    completedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(archiveBatchReference(batchId), data);
  return readRequiredArchiveBatch(batchId);
}

export async function getArchiveBatch(
  batchId: string,
): Promise<ArchiveBatchRecord | null> {
  requireBatchId(batchId);
  const snapshot = await getDoc(archiveBatchReference(batchId));
  return snapshot.exists() ? toArchiveBatchRecord(snapshot) : null;
}

export async function updateArchiveBatch(
  batchId: string,
  fields: ArchiveBatchMutableFields,
): Promise<ArchiveBatchRecord> {
  requireBatchId(batchId);
  const data: ArchiveBatchUpdateData = {
    ...fields,
    updatedAt: serverTimestamp(),
  };
  await updateDoc(archiveBatchReference(batchId), data);
  return readRequiredArchiveBatch(batchId);
}

export async function completeArchiveBatch(
  batchId: string,
  verificationStatus: ArchiveBatchVerificationStatus = 'verified',
): Promise<ArchiveBatchRecord> {
  requireBatchId(batchId);
  await updateDoc(archiveBatchReference(batchId), {
    status: 'completed',
    verificationStatus,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return readRequiredArchiveBatch(batchId);
}

async function incrementArchiveBatchCounter(
  batchId: string,
  counter: 'successCount' | 'failedCount' | 'retryCount' | 'processedCount',
): Promise<ArchiveBatchRecord> {
  requireBatchId(batchId);
  await updateDoc(archiveBatchReference(batchId), {
    [counter]: increment(1),
    updatedAt: serverTimestamp(),
  });
  return readRequiredArchiveBatch(batchId);
}

export function incrementSuccess(batchId: string): Promise<ArchiveBatchRecord> {
  return incrementArchiveBatchCounter(batchId, 'successCount');
}

export function incrementFailed(batchId: string): Promise<ArchiveBatchRecord> {
  return incrementArchiveBatchCounter(batchId, 'failedCount');
}

export function incrementRetry(batchId: string): Promise<ArchiveBatchRecord> {
  return incrementArchiveBatchCounter(batchId, 'retryCount');
}

export function incrementProcessed(batchId: string): Promise<ArchiveBatchRecord> {
  return incrementArchiveBatchCounter(batchId, 'processedCount');
}
