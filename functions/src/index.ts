import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, onRequest, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { Readable } from 'stream';
import { createOAuthDriveClient, getDriveClient, uploadToDrive } from './drive';
import { type MediaModule } from './types';
import { normalizeRole, sanitizeAndValidateId, validateAndDecodeBase64 } from './validation';
import {
  applyAnalyticsContribution,
  applyVehicleSessionAnalytics,
  requireAnalyticsAdmin,
  requireVehicleWorkflowActor,
  validAnalyticsRange,
} from './vehicleAnalyticsService';
import {
  createCanonicalStaff,
  listCanonicalStaff,
  resetCanonicalStaffPin,
  setCanonicalStaffStatus,
  verifyOperatorPinLogin,
} from './operatorAuthService';

const firebaseApp = admin.initializeApp();
const functionsRegion = defineString('FUNCTIONS_REGION', {
  default: 'us-central1',
  description: 'Per-project Firebase Functions deployment region.',
});
setGlobalOptions({ region: functionsRegion });

const firestore = admin.firestore();
const runtimeProjectId = firebaseApp.options.projectId || process.env.GCLOUD_PROJECT || '';
const ARCHIVE_BATCHES_COLLECTION = 'archiveBatches';
const MEDIA_COLLECTION = 'media';
const ARCHIVE_PAGE_SIZE = 100;
const googleDriveClientId = defineSecret('GOOGLE_DRIVE_CLIENT_ID');
const googleDriveClientSecret = defineSecret('GOOGLE_DRIVE_CLIENT_SECRET');
const googleDriveRefreshToken = defineSecret('GOOGLE_DRIVE_REFRESH_TOKEN');
const googleDriveRootFolderId = defineSecret('GOOGLE_DRIVE_ROOT_FOLDER_ID');
const googleDriveViewerEmail = defineString('GOOGLE_DRIVE_VIEWER_EMAIL', {
  description: 'Google account granted reader access to uploaded evidence.',
});

interface UploadMediaToDriveRequest {
  fileName: string;
  base64Data: string;
  mimeType: string;
}

export const listEligibleQueueOperators = onCall(
  async (request: CallableRequest<{ siteId: string }>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required.');
    const profile = await firestore.collection('users').doc(request.auth.uid).get();
    const profileData = profile.data();
    if (!profile.exists || profileData?.status !== 'Active') {
      throw new HttpsError('permission-denied', 'Active account is required.');
    }
    const role = String(profileData.role || '');
    if (!['ShiftHead', 'Manager', 'Admin'].includes(role)) {
      throw new HttpsError('permission-denied', 'Queue reassignment permission is required.');
    }
    const requestedSiteId = String(request.data.siteId || '').trim();
    const actorSiteId = String(profileData.site_id || 'site-01');
    if (!requestedSiteId || requestedSiteId !== actorSiteId) {
      throw new HttpsError('permission-denied', 'Cross-site operator lookup is not allowed.');
    }
    const snapshot = await firestore.collection('users').where('status', '==', 'Active').get();
    const operators = snapshot.docs
      .filter(item => String(item.get('site_id') || 'site-01') === actorSiteId)
      .map(item => ({
        uid: item.id,
        name: String(item.get('operator_name') || item.get('username') || 'ผู้ปฏิบัติงาน'),
        role: String(item.get('role') || ''),
        shift: String(item.get('shift') || ''),
      }))
      .filter(item => ['Guard', 'ShiftHead', 'Manager', 'Admin'].includes(item.role));
    return { operators };
  },
);

export const verifyOperatorPin = onCall(
  async (request: CallableRequest<{ username: string; pin: string }>) =>
    verifyOperatorPinLogin(firestore, request),
);

export const listStaffAccounts = onCall(
  async (request: CallableRequest<Record<string, never>>) =>
    listCanonicalStaff(firestore, request),
);

export const createStaffAccount = onCall(
  async (request: CallableRequest<{
    username: string;
    pin: string;
    operatorName: string;
    role: string;
    shift?: string;
    phone?: string;
    siteId: string;
    status: 'Active' | 'Inactive';
  }>) => createCanonicalStaff(firestore, request),
);

export const resetStaffPin = onCall(
  async (request: CallableRequest<{ username: string; pin: string }>) =>
    resetCanonicalStaffPin(firestore, request),
);

export const setStaffAccountStatus = onCall(
  async (request: CallableRequest<{ username: string; status: 'Active' | 'Inactive' }>) =>
    setCanonicalStaffStatus(firestore, request),
);

export const previewSiteDailyAnalyticsRebuild = onCall(
  async (request: CallableRequest<{ siteId: string; startDate: string; endDate: string }>) => {
    const actor = await requireAnalyticsAdmin(firestore, request);
    const range = validAnalyticsRange(request.data.startDate, request.data.endDate);
    const snapshot = await firestore.collection('vehicleSessions')
      .where('site_id', '==', actor.siteId)
      .where('queueMetrics.completedAt', '>=', admin.firestore.Timestamp.fromDate(range.start))
      .where('queueMetrics.completedAt', '<=', admin.firestore.Timestamp.fromDate(range.end))
      .limit(5000).get();
    return { scanned: snapshot.size, eligible: snapshot.size, range_days_max: 31, writes: 0 };
  },
);

export const rebuildSiteDailyAnalytics = onCall(
  async (request: CallableRequest<{ siteId: string; startDate: string; endDate: string; confirmed: boolean }>) => {
    const actor = await requireAnalyticsAdmin(firestore, request);
    if (request.data.confirmed !== true) throw new HttpsError('failed-precondition', 'Dry-run preview confirmation is required.');
    const range = validAnalyticsRange(request.data.startDate, request.data.endDate);
    const snapshot = await firestore.collection('vehicleSessions')
      .where('site_id', '==', actor.siteId)
      .where('queueMetrics.completedAt', '>=', admin.firestore.Timestamp.fromDate(range.start))
      .where('queueMetrics.completedAt', '<=', admin.firestore.Timestamp.fromDate(range.end))
      .limit(5000).get();
    let processed = 0;
    for (const session of snapshot.docs) {
      await applyAnalyticsContribution(firestore, session.id, session.data());
      processed += 1;
    }
    const auditId = `AUD_${crypto.randomUUID()}`;
    await firestore.collection('auditLogs').doc(auditId).set({
      audit_id: auditId, module_name: 'Analytics', record_id: actor.siteId,
      action: 'AnalyticsRebuild', operator_id: actor.uid, account_uid: actor.uid,
      site_id: actor.siteId, created_at: admin.firestore.FieldValue.serverTimestamp(),
      reason: `${request.data.startDate}..${request.data.endDate}`,
    });
    return { scanned: snapshot.size, processed, lastDocumentId: snapshot.docs.at(-1)?.id || null };
  },
);

export const applyVehicleSessionAnalyticsUpdate = onCall(
  async (request: CallableRequest<{ sessionId: string; siteId: string; workflow: string }>) => {
    const actor = await requireVehicleWorkflowActor(firestore, request);
    const sessionId = String(request.data.sessionId || '').trim();
    if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId is required.');
    const snapshot = await firestore.collection('vehicleSessions').doc(sessionId).get();
    if (!snapshot.exists) throw new HttpsError('not-found', 'Vehicle session was not found.');
    if (snapshot.get('site_id') !== actor.siteId) {
      throw new HttpsError('permission-denied', 'Cross-site analytics access is not allowed.');
    }
    return applyVehicleSessionAnalytics(firestore, sessionId);
  },
);

interface HttpMediaUploadRequest extends UploadMediaToDriveRequest {
  moduleName: string;
  recordId: string;
  siteId: string;
  uploadedBy: string;
}

const productionOrigin = 'https://securityprojectv1.web.app';
const stagingOrigin = 'https://securityprojectv1-staging.web.app';
const allowedAppOrigins = new Set([
  runtimeProjectId === 'securityprojectv1-staging'
    ? stagingOrigin
    : productionOrigin,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required field: ${field}`);
  }
  return value.trim();
}

function parseHttpMediaUpload(value: unknown): HttpMediaUploadRequest {
  if (!isRecord(value)) throw new Error('Request body must be a JSON object.');
  return {
    fileName: requiredString(value, 'fileName'),
    base64Data: requiredString(value, 'base64Data'),
    mimeType: requiredString(value, 'mimeType'),
    moduleName: requiredString(value, 'moduleName'),
    recordId: requiredString(value, 'recordId'),
    siteId: requiredString(value, 'siteId'),
    uploadedBy: requiredString(value, 'uploadedBy'),
  };
}

function uploadModule(moduleName: string): MediaModule {
  const modules: Record<string, MediaModule> = {
    VehicleLogs: 'Vehicle',
    ContractorLogs: 'Contractor',
    KeyLogs: 'Key',
    PatrolLogs: 'Patrol',
    IncidentReports: 'Incident',
  };
  const module = modules[moduleName];
  if (!module) throw new Error('Unsupported media module.');
  return module;
}

type UploadStage =
  | 'Verify Firebase Token'
  | 'Verify Active Account'
  | 'Locate Root Folder'
  | 'Create Site Folder'
  | 'Create Date Folder'
  | 'Decode Base64 Image'
  | 'Upload Image'
  | 'Set Drive Permission'
  | 'Generate View URL'
  | 'Persist Upload Metadata'
  | 'Return JSON';

function stackTrace(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function runUploadStage<T>(
  stage: UploadStage,
  operation: () => Promise<T> | T,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    functions.logger.info('media_upload_stage', {
      stage,
      duration_ms: Date.now() - startedAt,
      success: true,
      error: null,
    });
    return result;
  } catch (error: unknown) {
    functions.logger.error('media_upload_stage', {
      stage,
      duration_ms: Date.now() - startedAt,
      success: false,
      error: errorMessage(error),
      stack: stackTrace(error),
    });
    throw error;
  }
}

async function findOrCreateDriveFolder(
  drive: ReturnType<typeof createOAuthDriveClient>,
  parentFolderId: string,
  folderName: string,
): Promise<string> {
  const escapedName = folderName.replace(/'/g, "\\'");
  const listed = await withTransientDriveRetry(() => drive.files.list({
    q: `name = '${escapedName}' and '${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  }));
  const existingId = listed.data.files?.[0]?.id;
  if (existingId) return existingId;
  const created = await withTransientDriveRetry(() => drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
    supportsAllDrives: true,
  }));
  if (!created.data.id) throw new Error(`Drive did not return an ID for folder ${folderName}.`);
  return created.data.id;
}

const transientDriveStatuses = new Set([429, 500, 502, 503, 504]);

function driveErrorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === 'number') return error.status;
  const response = error.response;
  if (isRecord(response) && typeof response.status === 'number') return response.status;
  return null;
}

async function withTransientDriveRetry<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error: unknown) {
      const status = driveErrorStatus(error);
      if (!status || !transientDriveStatuses.has(status) || attempt >= 2) throw error;
      attempt += 1;
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
    }
  }
}

function maskedEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
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
export const uploadMediaToDrive = onCall(
  {
    secrets: [
      googleDriveClientId,
      googleDriveClientSecret,
      googleDriveRefreshToken,
    ],
  },
  async (request: CallableRequest<UploadMediaToDriveRequest>) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated.');
    }
    const data = request.data;
    if (!data.fileName || !data.base64Data || !data.mimeType) {
      throw new HttpsError('invalid-argument', 'Missing file name, data, or mime type.');
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
      throw new HttpsError('internal', errorMessage(error));
    }
  },
);

/** Authenticated production media endpoint with explicit CORS and Drive destination handling. */
export const uploadVehicleEvidence = onRequest(
  {
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [
      googleDriveClientId,
      googleDriveClientSecret,
      googleDriveRefreshToken,
      googleDriveRootFolderId,
    ],
  },
  async (request, response) => {
    const requestOrigin = request.get('Origin');
    if (requestOrigin && allowedAppOrigins.has(requestOrigin)) {
      response.set('Access-Control-Allow-Origin', requestOrigin);
      response.set('Vary', 'Origin');
    }
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Max-Age', '3600');

    if (request.method === 'OPTIONS') {
      if (requestOrigin && !allowedAppOrigins.has(requestOrigin)) {
        response.status(403).send('Origin not allowed.');
        return;
      }
      response.status(204).send('');
      return;
    }
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    if (requestOrigin && !allowedAppOrigins.has(requestOrigin)) {
      response.status(403).json({ error: 'Origin not allowed.' });
      return;
    }

    let currentStage: UploadStage = 'Verify Firebase Token';
    let uploadContext: Record<string, string | null> = {
      firebase_uid: null, operator_id: null, site_id: null,
    };
    try {
      const authorization = request.get('Authorization');
      const decodedToken = await runUploadStage(currentStage, async () => {
        if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication is required.');
        return admin.auth().verifyIdToken(authorization.slice(7));
      });

      currentStage = 'Verify Active Account';
      const account = await runUploadStage(currentStage, async () => {
        const profile = await firestore.collection('users').doc(decodedToken.uid).get();
        if (!profile.exists || profile.get('status') !== 'Active') {
          throw new Error('Active user profile is required.');
        }
        return profile.data() ?? {};
      });
      uploadContext = {
        firebase_uid: decodedToken.uid,
        operator_id: String(account.operator_id || ''),
        site_id: String(account.site_id || ''),
      };

      const drive = createOAuthDriveClient({
        clientId: googleDriveClientId.value(),
        clientSecret: googleDriveClientSecret.value(),
        refreshToken: googleDriveRefreshToken.value(),
      });

      currentStage = 'Locate Root Folder';
      const driveConfiguration = await runUploadStage(currentStage, async () => {
        const about = await withTransientDriveRetry(() => drive.about.get({
          fields: 'user,storageQuota',
        }));
        const authenticatedEmail = about.data.user?.emailAddress ?? '';
        if (!authenticatedEmail) throw new Error('Google Drive OAuth did not return an authenticated user.');
        const configuredId = googleDriveRootFolderId.value().trim();
        if (!configuredId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured.');
        const root = await withTransientDriveRetry(() => drive.files.get({
          fileId: configuredId,
          fields: 'id,name,mimeType,owners(emailAddress),capabilities(canAddChildren)',
          supportsAllDrives: true,
        }));
        if (root.data.mimeType !== 'application/vnd.google-apps.folder') {
          throw new Error('Configured Google Drive root is not a folder.');
        }
        const rootFolderWritable = root.data.capabilities?.canAddChildren === true;
        if (!rootFolderWritable) {
          throw new Error('Authenticated Drive owner cannot add files to the configured root folder.');
        }
        const quota = about.data.storageQuota;
        const limit = quota?.limit ? Number(quota.limit) : null;
        const usage = quota?.usage ? Number(quota.usage) : 0;
        const storageQuotaAvailable = limit === null || usage < limit;
        if (!storageQuotaAvailable) throw new Error('Authenticated Drive owner has no available storage quota.');
        functions.logger.info('media_upload_drive_root', {
          authenticated_drive_user: maskedEmail(authenticatedEmail),
          root_folder_writable: rootFolderWritable,
          storage_quota_available: storageQuotaAvailable,
        });
        return {
          rootFolderId: configuredId,
          authenticatedEmail,
          rootFolderWritable,
          storageQuotaAvailable,
        };
      });

      const requestBody = isRecord(request.body) ? request.body : {};
      if (requestBody.diagnostic === true) {
        if (account.role !== 'Admin') {
          response.status(403).json({ success: false, message: 'Admin role is required.' });
          return;
        }
        response.status(200).json({
          success: true,
          authType: 'OAuth2User',
          authenticatedDriveUserEmail: maskedEmail(driveConfiguration.authenticatedEmail),
          rootFolderAccessible: true,
          rootFolderWritable: driveConfiguration.rootFolderWritable,
          storageQuotaAvailable: driveConfiguration.storageQuotaAvailable,
        });
        return;
      }

      const data = parseHttpMediaUpload(request.body);
      const module = uploadModule(data.moduleName);
      if (data.siteId !== uploadContext.site_id) {
        response.status(403).json({ success: false, stage: 'Verify Active Account', message: 'Cross-site upload is not allowed.' });
        return;
      }

      currentStage = 'Create Site Folder';
      const siteFolderId = await runUploadStage(
        currentStage,
        () => findOrCreateDriveFolder(drive, driveConfiguration.rootFolderId, data.siteId),
      );

      currentStage = 'Create Date Folder';
      const destinationFolderId = await runUploadStage(currentStage, async () => {
        const now = new Date();
        const path = [
          module,
          String(now.getUTCFullYear()),
          String(now.getUTCMonth() + 1).padStart(2, '0'),
          String(now.getUTCDate()).padStart(2, '0'),
        ];
        let parentId = siteFolderId;
        for (const part of path) {
          parentId = await findOrCreateDriveFolder(drive, parentId, part);
        }
        return parentId;
      });

      currentStage = 'Decode Base64 Image';
      const fileBuffer = await runUploadStage(currentStage, () => {
        if (!/^image\/(jpeg|png|webp)$/.test(data.mimeType)) throw new Error('Unsupported image MIME type.');
        const validated = validateAndDecodeBase64(
          data.base64Data,
          data.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
          2 * 1024 * 1024,
        );
        functions.logger.info('media_upload_payload', {
          mime_type: data.mimeType,
          file_name: data.fileName,
          buffer_length: validated.sizeBytes,
        });
        return validated.buffer;
      });

      currentStage = 'Upload Image';
      const fileId = await runUploadStage(currentStage, async () => {
        const uploaded = await withTransientDriveRetry(() => drive.files.create({
          requestBody: {
            name: data.fileName,
            parents: [destinationFolderId],
            appProperties: {
              system: 'smart-guard',
              site_id: data.siteId,
              module,
              record_id: data.recordId,
              media_type: data.fileName,
            },
          },
          media: { mimeType: data.mimeType, body: Readable.from(fileBuffer) },
          fields: 'id',
          supportsAllDrives: true,
        }));
        if (!uploaded.data.id) throw new Error('Google Drive upload completed without a file ID.');
        return uploaded.data.id;
      });

      currentStage = 'Set Drive Permission';
      await runUploadStage(currentStage, async () => {
        const viewerEmail = googleDriveViewerEmail.value().trim();
        if (!viewerEmail) throw new Error('GOOGLE_DRIVE_VIEWER_EMAIL is not configured.');
        await withTransientDriveRetry(() => drive.permissions.create({
          fileId,
          requestBody: { type: 'user', role: 'reader', emailAddress: viewerEmail },
          sendNotificationEmail: false,
          supportsAllDrives: true,
        }));
      });

      currentStage = 'Generate View URL';
      const urls = await runUploadStage(currentStage, async () => {
        const file = await withTransientDriveRetry(() => drive.files.get({
          fileId,
          fields: 'id,mimeType,size,webViewLink,webContentLink,thumbnailLink',
          supportsAllDrives: true,
        }));
        if (!file.data.id || !file.data.webViewLink) {
          throw new Error('Google Drive did not return a view URL for the uploaded file.');
        }
        return {
          driveUrl: file.data.webViewLink,
          webContentLink: file.data.webContentLink ?? '',
          thumbnailUrl: file.data.thumbnailLink ?? '',
          mimeType: file.data.mimeType ?? data.mimeType,
          size: file.data.size ? Number(file.data.size) : fileBuffer.length,
        };
      });

      currentStage = 'Persist Upload Metadata';
      await runUploadStage(currentStage, () => firestore.collection('mediaUploads').doc(fileId).set({
        file_id: fileId,
        folder_id: destinationFolderId,
        media_url: urls.driveUrl,
        thumbnail_url: urls.thumbnailUrl,
        mime_type: urls.mimeType,
        size_bytes: urls.size,
        module,
        record_id: data.recordId,
        site_id: data.siteId,
        operator_id: uploadContext.operator_id,
        auth_uid: uploadContext.firebase_uid,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      }));

      currentStage = 'Return JSON';
      await runUploadStage(currentStage, () => {
        response.status(200).json({
          success: true,
          fileId,
          folderId: destinationFolderId,
          mimeType: urls.mimeType,
          size: urls.size,
          webViewLink: urls.driveUrl,
          webContentLink: urls.webContentLink,
          driveUrl: urls.driveUrl,
          thumbnailUrl: urls.thumbnailUrl,
          mediaUrl: urls.driveUrl,
        });
      });
    } catch (error: unknown) {
      functions.logger.error('media_upload_failed', {
        function_name: 'uploadVehicleEvidence',
        failure_stage: currentStage,
        ...uploadContext,
        error_code: error instanceof HttpsError ? error.code : 'internal',
        exception: errorMessage(error),
      });
      response.status(
        currentStage === 'Verify Firebase Token' ? 401 :
          currentStage === 'Verify Active Account' ? 403 :
            error instanceof HttpsError && (error.code === 'invalid-argument' || error.code === 'failed-precondition') ? 400 : 500,
      ).json({
        success: false,
        stage: currentStage,
        message: errorMessage(error),
      });
    }
  },
);

export const archiveBatchToDrive = onCall(
  {
    secrets: [
      googleDriveClientId,
      googleDriveClientSecret,
      googleDriveRefreshToken,
      googleDriveRootFolderId,
    ],
  },
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
