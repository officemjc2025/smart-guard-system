import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { defineString } from 'firebase-functions/params';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { Readable } from 'stream';
import { getDriveClient, uploadToDrive } from './drive';
import { type MediaModule } from './types';
import { normalizeRole, sanitizeAndValidateId } from './validation';

admin.initializeApp();

const firestore = admin.firestore();
const ARCHIVE_BATCHES_COLLECTION = 'archiveBatches';
const MEDIA_COLLECTION = 'media';
const ARCHIVE_PAGE_SIZE = 100;
const googleDriveRootFolderId = defineString('GOOGLE_DRIVE_ROOT_FOLDER_ID', {
  description: 'Google Drive folder ID used as the root for archived media.',
});

interface UploadMediaToDriveRequest {
  fileName: string;
  base64Data: string;
  mimeType: string;
}

interface ArchiveBatchToDriveRequest {
  batchId: string;
  lastProcessedCreatedAt?: admin.firestore.Timestamp | null;
  lastProcessedMediaId?: string | null;
}

interface ArchiveBatchToDriveSummary {
  batchId: string;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  lastProcessedCreatedAt: admin.firestore.Timestamp | null;
  lastProcessedMediaId: string | null;
  hasMore: boolean;
}

interface MediaArchiveUploadData {
  base64Data: string;
  fileName: string;
  mimeType: string;
  siteId: string;
  module: MediaModule;
  recordId: string;
  mediaType: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Drive upload failed.';
}

function getString(data: FirebaseFirestore.DocumentData, field: string): string | null {
  const value: unknown = data[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getMediaModule(value: string | null): MediaModule {
  if (
    value === 'Vehicle' ||
    value === 'Contractor' ||
    value === 'Key' ||
    value === 'Patrol' ||
    value === 'Incident'
  ) {
    return value;
  }
  throw new HttpsError('failed-precondition', 'Media document has an unsupported module.');
}

function mediaUploadData(
  mediaId: string,
  data: FirebaseFirestore.DocumentData,
): MediaArchiveUploadData {
  const base64Data =
    getString(data, 'base64_data') ??
    getString(data, 'base64Data') ??
    getString(data, 'file_base64');
  const siteId = getString(data, 'site_id');
  const module = getMediaModule(getString(data, 'module'));

  if (!base64Data || !siteId) {
    throw new HttpsError(
      'failed-precondition',
      'Media document is missing archive upload data.',
    );
  }

  return {
    base64Data,
    fileName: getString(data, 'file_name') ?? `${mediaId}.bin`,
    mimeType:
      getString(data, 'mime_type') ??
      getString(data, 'original_mime_type') ??
      'application/octet-stream',
    siteId,
    module,
    recordId: getString(data, 'record_id') ?? mediaId,
    mediaType: getString(data, 'media_type') ?? 'archive',
  };
}

function archiveCursor(
  request: ArchiveBatchToDriveRequest,
): { createdAt: admin.firestore.Timestamp; mediaId: string } | null {
  const createdAt = request.lastProcessedCreatedAt ?? null;
  const mediaId = request.lastProcessedMediaId ?? null;

  if (createdAt === null && mediaId === null) {
    return null;
  }
  if (
    !(createdAt instanceof admin.firestore.Timestamp) ||
    typeof mediaId !== 'string' ||
    !mediaId.trim()
  ) {
    throw new HttpsError(
      'invalid-argument',
      'lastProcessedCreatedAt and lastProcessedMediaId must be supplied together.',
    );
  }

  return { createdAt, mediaId };
}

async function getDriveFileUrl(fileId: string): Promise<string | null> {
  try {
    const response = await getDriveClient().files.get({
      fileId,
      fields: 'webViewLink',
    });
    return response.data.webViewLink ?? null;
  } catch (_error: unknown) {
    return null;
  }
}

/** Retained legacy callable for direct Base64 uploads. */
export const uploadMediaToDrive = functions.https.onCall(
  async (data: UploadMediaToDriveRequest, context: functions.https.CallableContext) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    if (!data.fileName || !data.base64Data || !data.mimeType) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing file name, data, or mime type.');
    }

    try {
      const response = await getDriveClient().files.create({
        requestBody: { name: data.fileName },
        media: {
          mimeType: data.mimeType,
          body: Readable.from(Buffer.from(data.base64Data, 'base64')),
        },
        fields: 'id, webViewLink',
      });
      return {
        success: true,
        fileId: response.data.id,
        link: response.data.webViewLink,
      };
    } catch (error: unknown) {
      throw new functions.https.HttpsError('internal', errorMessage(error));
    }
  },
);

export const archiveBatchToDrive = onCall(
  async (
    request: CallableRequest<ArchiveBatchToDriveRequest>,
  ): Promise<ArchiveBatchToDriveSummary> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const accountSnapshot = await firestore
      .collection('accounts')
      .doc(request.auth.uid)
      .get();
    const accountData = accountSnapshot.data();
    if (!accountSnapshot.exists || !accountData) {
      throw new HttpsError('permission-denied', 'Authenticated account was not found.');
    }

    const accountRole = getString(accountData, 'role') ?? '';
    const normalizedRole = normalizeRole(accountRole);
    if (normalizedRole !== 'Admin' && normalizedRole !== 'Manager') {
      throw new HttpsError('permission-denied', 'Only Admin and Manager accounts can archive media.');
    }

    const batchId = sanitizeAndValidateId(request.data.batchId, 'batchId');
    const cursor = archiveCursor(request.data);
    const rootFolderId = googleDriveRootFolderId.value().trim();
    if (!rootFolderId) {
      throw new HttpsError('failed-precondition', 'GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured.');
    }

    const batchReference = firestore.collection(ARCHIVE_BATCHES_COLLECTION).doc(batchId);
    if (!(await batchReference.get()).exists) {
      throw new HttpsError('not-found', 'Archive batch was not found.');
    }

    let mediaQuery = firestore
      .collection(MEDIA_COLLECTION)
      .where('archive_batch_id', '==', batchId)
      .where('archive_status', '==', 'PendingArchive')
      .orderBy('created_at', 'asc')
      .orderBy(admin.firestore.FieldPath.documentId(), 'asc');
    if (cursor) {
      mediaQuery = mediaQuery.startAfter(cursor.createdAt, cursor.mediaId);
    }

    const mediaSnapshot = await mediaQuery.limit(ARCHIVE_PAGE_SIZE + 1).get();
    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let lastProcessedCreatedAt: admin.firestore.Timestamp | null = null;
    let lastProcessedMediaId: string | null = null;
    let hasMore = false;

    for (const mediaDocument of mediaSnapshot.docs) {
      if (processedCount === ARCHIVE_PAGE_SIZE) {
        hasMore = true;
        break;
      }

      processedCount += 1;
      lastProcessedMediaId = mediaDocument.id;
      const queuedCreatedAt = mediaDocument.get('created_at');
      lastProcessedCreatedAt =
        queuedCreatedAt instanceof admin.firestore.Timestamp ? queuedCreatedAt : null;

      try {
        const latestMediaSnapshot = await mediaDocument.ref.get();
        if (!latestMediaSnapshot.exists) {
          skippedCount += 1;
          continue;
        }

        const latestMedia = latestMediaSnapshot.data();
        if (!latestMedia) {
          skippedCount += 1;
          continue;
        }
        if (
          getString(latestMedia, 'drive_file_id') ||
          getString(latestMedia, 'archive_status') === 'Archived'
        ) {
          skippedCount += 1;
          continue;
        }

        const uploadData = mediaUploadData(mediaDocument.id, latestMedia);
        const uploadResult = await uploadToDrive(
          uploadData.siteId,
          uploadData.module,
          uploadData.recordId,
          uploadData.mediaType,
          uploadData.fileName,
          uploadData.mimeType,
          Buffer.from(uploadData.base64Data, 'base64'),
          rootFolderId,
        );
        const driveFileUrl = await getDriveFileUrl(uploadResult.fileId);
        const mediaUpdate: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
          drive_file_id: uploadResult.fileId,
          archive_status: 'Archived',
          archived_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (driveFileUrl) {
          mediaUpdate.drive_file_url = driveFileUrl;
        }
        await latestMediaSnapshot.ref.update(mediaUpdate);
        successCount += 1;
      } catch (_error: unknown) {
        failedCount += 1;
      }
    }

    if (processedCount > 0) {
      await batchReference.update({
        processedCount: admin.firestore.FieldValue.increment(processedCount),
        successCount: admin.firestore.FieldValue.increment(successCount),
        failedCount: admin.firestore.FieldValue.increment(failedCount),
        skippedCount: admin.firestore.FieldValue.increment(skippedCount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return {
      batchId,
      processedCount,
      successCount,
      failedCount,
      skippedCount,
      lastProcessedCreatedAt,
      lastProcessedMediaId,
      hasMore,
    };
  },
);
