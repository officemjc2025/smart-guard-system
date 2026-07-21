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
} from 'firebase/firestore';
import { db } from '../firebase';

const MEDIA_COLLECTION = 'media';

export type MediaArchiveStatus =
  | 'PendingArchive'
  | 'Archived'
  | 'ArchiveFailed';

export interface MediaUploadWriteModel {
  media_id: string;
  storage_path: string;
  storage_bucket: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  module_name: string;
  record_id: string;
  site_id: string;
  uploaded_by: string;
  archive_batch_id?: string | null;
}

export interface MediaUploadRecord extends MediaUploadWriteModel {
  archive_status: MediaArchiveStatus;
  drive_file_id: string | null;
  drive_file_url: string | null;
  retry_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: Timestamp | null;
}

type MediaUploadMutableFields = Partial<
  Omit<
    MediaUploadRecord,
    'media_id' | 'created_at' | 'updated_at' | 'retry_count' | 'archived_at'
  >
>;

type MediaUploadCreateData = Omit<
  MediaUploadRecord,
  'created_at' | 'updated_at'
> & {
  created_at: FieldValue;
  updated_at: FieldValue;
};

type MediaUploadUpdateData = MediaUploadMutableFields & {
  updated_at: FieldValue;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMediaUploadRecord(value: unknown): value is MediaUploadRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.media_id === 'string' &&
    typeof value.storage_path === 'string' &&
    typeof value.storage_bucket === 'string' &&
    typeof value.file_name === 'string' &&
    typeof value.mime_type === 'string' &&
    typeof value.file_size === 'number' &&
    typeof value.module_name === 'string' &&
    typeof value.record_id === 'string' &&
    typeof value.site_id === 'string' &&
    typeof value.uploaded_by === 'string' &&
    (typeof value.archive_batch_id === 'string' ||
      value.archive_batch_id === null ||
      value.archive_batch_id === undefined) &&
    ['PendingArchive', 'Archived', 'ArchiveFailed'].includes(String(value.archive_status)) &&
    (typeof value.drive_file_id === 'string' || value.drive_file_id === null) &&
    (typeof value.drive_file_url === 'string' || value.drive_file_url === null) &&
    typeof value.retry_count === 'number' &&
    value.created_at instanceof Timestamp &&
    value.updated_at instanceof Timestamp &&
    (value.archived_at instanceof Timestamp || value.archived_at === null)
  );
}

const mediaConverter: FirestoreDataConverter<MediaUploadRecord> = {
  toFirestore(model) {
    return model;
  },
  fromFirestore(snapshot) {
    const data: unknown = snapshot.data();
    if (!isMediaUploadRecord(data)) {
      throw new Error(`Media record "${snapshot.id}" contains invalid data.`);
    }
    return data;
  },
};

function mediaReference(mediaId: string) {
  const media = collection(db, MEDIA_COLLECTION).withConverter(mediaConverter);
  return doc(media, mediaId);
}

function requireMediaId(mediaId: string): void {
  if (!mediaId.trim()) {
    throw new Error('Media ID is required.');
  }
}

function toMediaUploadRecord(
  snapshot: DocumentSnapshot<MediaUploadRecord>,
): MediaUploadRecord {
  const snapshotId = snapshot.id;
  if (!snapshot.exists()) {
    throw new Error(`Media record "${snapshotId}" was not found.`);
  }

  return snapshot.data();
}

async function readRequiredMediaRecord(mediaId: string): Promise<MediaUploadRecord> {
  const snapshot = await getDoc(mediaReference(mediaId));
  return toMediaUploadRecord(snapshot);
}

function requireText(value: string, fieldName: string): void {
  if (!value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }
}

export async function createMediaRecord(
  model: MediaUploadWriteModel,
): Promise<MediaUploadRecord> {
  requireMediaId(model.media_id);
  requireText(model.storage_path, 'storage_path');
  requireText(model.storage_bucket, 'storage_bucket');
  requireText(model.file_name, 'file_name');
  requireText(model.mime_type, 'mime_type');
  requireText(model.module_name, 'module_name');
  requireText(model.record_id, 'record_id');
  requireText(model.site_id, 'site_id');
  requireText(model.uploaded_by, 'uploaded_by');
  if (!Number.isFinite(model.file_size) || model.file_size < 0) {
    throw new Error('file_size must be a non-negative number.');
  }

  const data: MediaUploadCreateData = {
    ...model,
    archive_batch_id: model.archive_batch_id ?? null,
    archive_status: 'PendingArchive',
    drive_file_id: null,
    drive_file_url: null,
    retry_count: 0,
    archived_at: null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };
  await setDoc(mediaReference(model.media_id), data);
  return readRequiredMediaRecord(model.media_id);
}

export async function getMediaRecord(
  mediaId: string,
): Promise<MediaUploadRecord | null> {
  requireMediaId(mediaId);
  const snapshot = await getDoc(mediaReference(mediaId));
  return snapshot.exists() ? toMediaUploadRecord(snapshot) : null;
}

export async function updateMediaRecord(
  mediaId: string,
  fields: MediaUploadMutableFields,
): Promise<MediaUploadRecord> {
  requireMediaId(mediaId);
  const data: MediaUploadUpdateData = {
    ...fields,
    updated_at: serverTimestamp(),
  };
  await updateDoc(mediaReference(mediaId), data);
  return readRequiredMediaRecord(mediaId);
}

export async function markPendingArchive(
  mediaId: string,
  archiveBatchId: string,
): Promise<MediaUploadRecord> {
  requireMediaId(mediaId);
  requireText(archiveBatchId, 'archive_batch_id');
  await updateDoc(mediaReference(mediaId), {
    archive_batch_id: archiveBatchId,
    archive_status: 'PendingArchive',
    updated_at: serverTimestamp(),
  });
  return readRequiredMediaRecord(mediaId);
}

export async function markArchived(
  mediaId: string,
  driveFileId: string,
  driveFileUrl: string | null = null,
): Promise<MediaUploadRecord> {
  requireMediaId(mediaId);
  requireText(driveFileId, 'drive_file_id');
  await updateDoc(mediaReference(mediaId), {
    drive_file_id: driveFileId,
    drive_file_url: driveFileUrl,
    archive_status: 'Archived',
    archived_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return readRequiredMediaRecord(mediaId);
}

export async function markArchiveFailed(
  mediaId: string,
): Promise<MediaUploadRecord> {
  requireMediaId(mediaId);
  await updateDoc(mediaReference(mediaId), {
    archive_status: 'ArchiveFailed',
    retry_count: increment(1),
    updated_at: serverTimestamp(),
  });
  return readRequiredMediaRecord(mediaId);
}
