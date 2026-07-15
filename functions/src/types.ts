export type MediaModule = 'Vehicle' | 'Contractor' | 'Key' | 'Patrol' | 'Incident';

export type UserRole = 'Guard' | 'ShiftHead' | 'Manager' | 'Admin';

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
  drive_file_id: string;
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
  created_at: any; // FirebaseFirestore.Timestamp
  updated_at: any; // FirebaseFirestore.Timestamp
}

export interface UploadRequestRecord {
  request_id: string;
  status: 'processing' | 'completed' | 'failed';
  account_uid: string;
  operator_id: string;
  client_request_id: string;
  media_id?: string;
  error?: string;
  created_at: any;
  updated_at: any;
}
