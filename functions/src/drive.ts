import { Readable } from 'stream';
import { google, drive_v3 } from 'googleapis';
import { HttpsError } from 'firebase-functions/v2/https';
import { MediaModule } from './types';
import { logger } from 'firebase-functions';

let driveClient: drive_v3.Drive | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface GoogleDriveOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function normalizeGoogleDriveOAuthCredentials(
  credentials: GoogleDriveOAuthCredentials,
): GoogleDriveOAuthCredentials {
  const normalized = {
    clientId: String(credentials.clientId || '').trim(),
    clientSecret: String(credentials.clientSecret || '').trim(),
    refreshToken: String(credentials.refreshToken || '').trim(),
  };
  if (!normalized.clientId || !normalized.clientSecret || !normalized.refreshToken) {
    throw new Error('Google Drive OAuth secrets are not configured.');
  }
  return normalized;
}

export function requireGoogleDriveRootFolderId(value: unknown): string {
  const rootFolderId = String(value || '').trim();
  if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured.');
  return rootFolderId;
}

/** Creates a Drive client owned by the configured human OAuth user. */
export function createOAuthDriveClient(
  credentials: GoogleDriveOAuthCredentials,
): drive_v3.Drive {
  const normalized = normalizeGoogleDriveOAuthCredentials(credentials);
  const oauth2Client = new google.auth.OAuth2(
    normalized.clientId,
    normalized.clientSecret,
  );
  oauth2Client.setCredentials({ refresh_token: normalized.refreshToken });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

/** Initializes the cached Drive client with backend-only OAuth user credentials. */
export function getDriveClient(): drive_v3.Drive {
  if (!driveClient) {
    try {
      driveClient = createOAuthDriveClient({
        clientId: process.env.GOOGLE_DRIVE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? '',
        refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? '',
      });
      logger.info('[Google Drive Service] OAuth2 user client initialized.');
    } catch (err: unknown) {
      logger.error('[Google Drive Service] Initialization failed:', err);
      throw new HttpsError('internal', 'ไม่สามารถเชื่อมต่อระบบคลาวด์สำหรับ Google Drive Media ได้');
    }
  }
  return driveClient;
}

/**
 * Finds or creates a subfolder by name under a given parent folder ID in Google Drive.
 */
async function getOrCreateSubFolder(
  drive: drive_v3.Drive,
  parentFolderId: string,
  folderName: string
): Promise<string> {
  try {
    // Search for existing folder with this name under the parent
    const q = `name = '${folderName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await drive.files.list({
      q,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    const files = res.data.files || [];
    if (files.length > 0 && files[0].id) {
      return files[0].id;
    }

    // Create the folder if not found
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    };

    const folder = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id',
    });

    if (!folder.data.id) {
      throw new Error(`Failed to retrieve ID of created folder: ${folderName}`);
    }

    return folder.data.id;
  } catch (error: unknown) {
    logger.error(`[Google Drive Service] Error in getOrCreateSubFolder for '${folderName}':`, error);
    throw new HttpsError('internal', `เกิดข้อผิดพลาดในการสร้างโฟลเดอร์เก็บข้อมูลสื่อ: ${errorMessage(error)}`);
  }
}

/**
 * Traverses or creates the entire standard site & date folder structure:
 * Root ID -> site_id -> Module Name -> YYYY -> MM -> DD
 */
export async function getOrCreateDestinationFolder(
  siteId: string,
  module: MediaModule,
  rootFolderId: string
): Promise<string> {
  const drive = getDriveClient();
  
  const today = new Date();
  const yearStr = today.getFullYear().toString();
  const monthStr = (today.getMonth() + 1).toString().padStart(2, '0');
  const dayStr = today.getDate().toString().padStart(2, '0');

  const pathParts = [
    siteId,
    module,
    yearStr,
    monthStr,
    dayStr
  ];

  let currentParentId = rootFolderId;

  for (const part of pathParts) {
    currentParentId = await getOrCreateSubFolder(drive, currentParentId, part);
  }

  return currentParentId;
}

export interface DriveUploadResult {
  fileId: string;
  folderId: string;
}

/**
 * Uploads media file to Google Drive under the calculated directory.
 */
export async function uploadToDrive(
  siteId: string,
  module: MediaModule,
  recordId: string,
  mediaType: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  rootFolderId: string
): Promise<DriveUploadResult> {
  const drive = getDriveClient();

  // Find or create correct destination folder
  const folderId = await getOrCreateDestinationFolder(siteId, module, rootFolderId);

  // App properties for metadata (non-sensitive)
  const appProperties = {
    system: 'smart-guard',
    site_id: siteId,
    module: module,
    record_id: recordId,
    media_type: mediaType,
  };

  const fileMetadata: drive_v3.Schema$File = {
    name: fileName,
    parents: [folderId],
    appProperties,
  };

  const media = {
    mimeType: mimeType,
    body: Readable.from(buffer),
  };

  try {
    const res = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, mimeType',
    });

    if (!res.data.id) {
      throw new Error('Google Drive API did not return a valid file ID');
    }

    logger.info(`[Google Drive Service] File uploaded successfully to folder '${folderId}': ${res.data.id}`);
    return {
      fileId: res.data.id,
      folderId: folderId
    };
  } catch (error: unknown) {
    logger.error('[Google Drive Service] Upload to Drive failed:', error);
    throw new HttpsError('internal', `ไม่สามารถอัปโหลดไฟล์สื่อไปยังคลาวด์ Google Drive ได้: ${errorMessage(error)}`);
  }
}

/**
 * Deletes a file from Google Drive (used for rollback on Firestore error).
 */
export async function deleteFromDrive(fileId: string): Promise<void> {
  const drive = getDriveClient();
  try {
    await drive.files.delete({ fileId });
    logger.info(`[Google Drive Service] Rollback delete succeeded for file ID: ${fileId}`);
  } catch (error: unknown) {
    logger.error(`[Google Drive Service] Rollback delete failed for file ID ${fileId}:`, error);
    // Do not throw to let the caller handle Firestore orphan log
  }
}

/**
 * Downloads a file from Google Drive and returns it as a base64 encoded string.
 */
export async function downloadFromDriveAsBase64(fileId: string): Promise<string> {
  const drive = getDriveClient();
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    const buffer = Buffer.from(response.data as ArrayBuffer);
    return buffer.toString('base64');
  } catch (error: unknown) {
    logger.error(`[Google Drive Service] Failed to download file ${fileId}:`, error);
    throw new HttpsError('internal', `ไม่สามารถดาวน์โหลดไฟล์รูปภาพจาก Google Drive ได้: ${errorMessage(error)}`);
  }
}
