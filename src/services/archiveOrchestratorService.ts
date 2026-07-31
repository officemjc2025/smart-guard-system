import {
  collection,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createArchiveBatch } from './archiveBatchService';

const MEDIA_COLLECTION = 'media';
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 499;

export interface ArchiveBatchOrchestratorOptions {
  requestedBy: string;
  batchSize?: number;
}

export interface ArchiveBatchOrchestratorResult {
  batchId: string;
  assignedCount: number;
  skippedCount: number;
}

function validateOptions(options: ArchiveBatchOrchestratorOptions): number {
  if (!options.requestedBy.trim()) {
    throw new Error('Archive batch requester is required.');
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}.`);
  }
  return batchSize;
}

/**
 * Creates an archive batch and assigns currently unassigned pending media to it.
 */
export async function orchestrateArchiveBatch(
  options: ArchiveBatchOrchestratorOptions,
): Promise<ArchiveBatchOrchestratorResult> {
  const batchSize = validateOptions(options);
  const pendingMediaQuery = query(
    collection(db, MEDIA_COLLECTION),
    where('archive_status', '==', 'PendingArchive'),
    limit(batchSize),
  );
  const pendingMediaSnapshot = await getDocs(pendingMediaQuery);
  const assignableDocuments: QueryDocumentSnapshot<DocumentData>[] = [];
  let skippedCount = 0;

  for (const mediaDocument of pendingMediaSnapshot.docs) {
    const existingBatchId: unknown = mediaDocument.get('archive_batch_id');
    if (existingBatchId !== null && existingBatchId !== undefined) {
      skippedCount += 1;
      continue;
    }
    assignableDocuments.push(mediaDocument);
  }

  const archiveBatch = await createArchiveBatch({
    sourceCollection: MEDIA_COLLECTION,
    requestedBy: options.requestedBy,
    totalRecords: assignableDocuments.length,
  });
  const assignmentBatch = writeBatch(db);
  for (const mediaDocument of assignableDocuments) {
    assignmentBatch.update(mediaDocument.ref, {
      archive_batch_id: archiveBatch.id,
      updated_at: serverTimestamp(),
    });
  }
  if (assignableDocuments.length > 0) {
    await assignmentBatch.commit();
  }

  return {
    batchId: archiveBatch.id,
    assignedCount: assignableDocuments.length,
    skippedCount,
  };
}
