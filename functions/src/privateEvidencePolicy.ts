import type { CanonicalUploadActor } from './vehicleEvidencePolicy';

export class PrivateEvidencePolicyError extends Error {
  constructor(message: string, public readonly httpStatus: 403 | 404 | 413 | 415) {
    super(message);
  }
}

const EVIDENCE_MEDIA_TYPES = {
  Vehicle: new Set([
    'entry_plate',
    'entry_vehicle',
    'visitor_document',
    'exit_plate',
    'exit_vehicle',
    'activity_evidence',
  ]),
  Contractor: new Set([
    'contractor_id',
    'contractor_face',
    'contractor_activity',
  ]),
  Key: new Set([
    'key_borrower',
    'sig_key',
    'key_return',
    'sig_key_return',
  ]),
  Patrol: new Set(['patrol_photo_1', 'patrol_photo_2']),
  Incident: new Set(['incident_photo']),
} as const;

export type PrivateEvidenceModule = keyof typeof EVIDENCE_MEDIA_TYPES;

const MODULE_NAMES: Record<PrivateEvidenceModule, ReadonlySet<string>> = {
  Vehicle: new Set(['VehicleLogs', 'VehicleSessionActivities']),
  Contractor: new Set(['ContractorLogs']),
  Key: new Set(['KeyLogs']),
  Patrol: new Set(['PatrolLogs']),
  Incident: new Set(['IncidentReports']),
};

export function authorizeRegisteredEvidence(
  fileId: string,
  actor: CanonicalUploadActor,
  metadata: Record<string, unknown> | undefined,
  linkedRecordId: string,
  linkedRecord: Record<string, unknown> | undefined,
): void {
  if (!metadata || metadata.file_id !== fileId) {
    throw new PrivateEvidencePolicyError('Evidence metadata was not found.', 404);
  }
  const module = String(metadata.module || '') as PrivateEvidenceModule;
  const moduleName = String(metadata.module_name || '');
  const mediaType = String(metadata.media_type || '');
  const recordId = String(metadata.record_id || '');
  if (
    metadata.site_id !== actor.siteId
    || !(module in EVIDENCE_MEDIA_TYPES)
  ) {
    throw new PrivateEvidencePolicyError('Evidence does not belong to the active site.', 403);
  }
  if (!EVIDENCE_MEDIA_TYPES[module].has(mediaType as never)) {
    throw new PrivateEvidencePolicyError('Evidence media type does not match its module.', 403);
  }
  if (moduleName && !MODULE_NAMES[module].has(moduleName)) {
    throw new PrivateEvidencePolicyError('Evidence module name does not match its module.', 403);
  }
  if (
    !recordId
    || recordId !== linkedRecordId
    || !linkedRecord
    || linkedRecord.site_id !== actor.siteId
  ) {
    throw new PrivateEvidencePolicyError('Linked evidence record was not found.', 404);
  }
}

export function validatePrivateImageMetadata(
  fileId: string,
  mimeType: string,
  size: number,
  trashed: boolean,
  maximumBytes = 10 * 1024 * 1024,
): void {
  if (trashed) throw new PrivateEvidencePolicyError('Evidence file was not found.', 404);
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(fileId)) {
    throw new PrivateEvidencePolicyError('Evidence file was not found.', 404);
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new PrivateEvidencePolicyError('Unsupported evidence media type.', 415);
  }
  if (!Number.isFinite(size) || size <= 0 || size > maximumBytes) {
    throw new PrivateEvidencePolicyError('Evidence file exceeds the preview size limit.', 413);
  }
}

export function authorizeDriveEvidenceIdentity(
  actor: CanonicalUploadActor,
  registry: Record<string, unknown>,
  linkedRecordId: string,
  appProperties: Record<string, unknown>,
): void {
  if (appProperties.system !== 'smart-guard') return;
  if (
    appProperties.site_id !== actor.siteId
    || (appProperties.record_id && appProperties.record_id !== linkedRecordId)
    || (appProperties.module && appProperties.module !== registry.module)
    || (appProperties.module_name && appProperties.module_name !== registry.module_name)
    || (appProperties.media_type && appProperties.media_type !== registry.media_type)
  ) {
    throw new PrivateEvidencePolicyError(
      'Drive evidence metadata does not match the authorized record.',
      403,
    );
  }
}
