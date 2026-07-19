import * as admin from 'firebase-admin';

export type MediaModule = 'Vehicle' | 'Contractor' | 'Key' | 'Patrol' | 'Incident';

export type UserRole = 'Guard' | 'ShiftHead' | 'Manager' | 'Admin';

export type ArchiveStatus = 'PendingArchive' | 'Archived';

export type ArchiveBatchStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type ArchiveBatchVerificationStatus = 'pending' | 'verified' | 'failed';

export interface UploadMediaRequest {
  operatorId: string;
  module: MediaModule;
  recordId: string;
  mediaType: string;
  fileName?: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64Data: string;
  clientRequestId: string;
}

export interface GetMediaAccessRequest {
  mediaId: string;
  operatorId: string;
}

export interface ArchiveMediaRequest {
  mediaId: string;
  operatorId: string;
}

export interface MediaFileRecord {
  media_id: string;
  provider: 'google_drive';
  drive_file_id?: string;
  drive_file_url?: string;
  drive_folder_id: string;
  module: MediaModule;
  record_id: string;
  media_type: string;
  original_mime_type: string;
  stored_mime_type: string;
  size_bytes: number;
  sha256: string;
  account_uid: string;
  login_email: string;
  operator_id: string;
  operator_name: string;
  role: UserRole;
  site_id: string;
  upload_request_id: string;
  status: 'Active' | 'Archived' | 'Deleted';
  archive_batch_id?: string;
  archive_status?: ArchiveStatus;
  archived_at?: admin.firestore.Timestamp;
  created_at: admin.firestore.Timestamp;
  updated_at: admin.firestore.Timestamp;
}

/** Media fields used by the archive worker before the file is moved to Drive. */
export interface ArchiveMediaRecord {
  media_id: string;
  archive_batch_id: string;
  archive_status: ArchiveStatus;
  drive_file_id?: string;
  drive_file_url?: string;
  archived_at?: admin.firestore.Timestamp;
  created_at: admin.firestore.Timestamp;
  updated_at: admin.firestore.Timestamp;
}

/** Persistent batch state and cursor fields used to resume archive processing. */
export interface ArchiveBatchWorkerRecord {
  batch_id: string;
  status: ArchiveBatchStatus;
  verification_status: ArchiveBatchVerificationStatus;
  processed_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  last_processed_created_at: admin.firestore.Timestamp | null;
  last_processed_media_id: string | null;
  created_at: admin.firestore.Timestamp;
  updated_at: admin.firestore.Timestamp;
  completed_at: admin.firestore.Timestamp | null;
}

export interface UploadRequestRecord {
  request_id: string;
  status: 'processing' | 'completed' | 'failed';
  account_uid: string;
  operator_id: string;
  client_request_id: string;
  media_id?: string;
  error?: string;
  created_at: admin.firestore.Timestamp;
  updated_at: admin.firestore.Timestamp;
}
