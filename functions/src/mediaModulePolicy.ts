import {
  type CanonicalUploadActor,
  type HttpMediaUploadRequest,
  UploadPolicyError,
} from './vehicleEvidencePolicy';

const EXACT_MEDIA_TYPES: Record<string, ReadonlySet<string>> = {
  ContractorLogs: new Set(['contractor_id', 'contractor_face', 'contractor_activity']),
  KeyLogs: new Set(['key_borrower', 'sig_key', 'key_return', 'sig_key_return']),
  PatrolLogs: new Set(['patrol_photo_1', 'patrol_photo_2']),
  IncidentReports: new Set(['incident_photo']),
};

export function validateNonVehicleMediaUpload(
  request: HttpMediaUploadRequest,
  actor: CanonicalUploadActor,
  resource?: Record<string, unknown>,
): void {
  const exactTypes = EXACT_MEDIA_TYPES[request.moduleName];
  if (!exactTypes?.has(request.mediaType)) {
    throw new UploadPolicyError('UPLOAD_INVALID_FILE', 'Unsupported media type for this module.', 400);
  }
  if (request.siteId !== actor.siteId) {
    throw new UploadPolicyError('UPLOAD_FORBIDDEN', 'Cross-site upload is not allowed.', 403);
  }
  if (resource && resource.site_id !== actor.siteId) {
    throw new UploadPolicyError('UPLOAD_FORBIDDEN', 'The referenced record belongs to another site.', 403);
  }
  if (
    request.moduleName === 'ContractorLogs'
    && request.mediaType === 'contractor_activity'
    && (!resource || resource.status !== 'กำลังปฏิบัติงาน')
  ) {
    throw new UploadPolicyError(
      resource ? 'UPLOAD_FORBIDDEN' : 'UPLOAD_NOT_FOUND',
      'An active Contractor record is required for activity evidence.',
      resource ? 403 : 404,
    );
  }
  if (
    request.moduleName === 'KeyLogs'
    && ['key_return', 'sig_key_return'].includes(request.mediaType)
    && (!resource || resource.status !== 'ถูกเบิก')
  ) {
    throw new UploadPolicyError(
      resource ? 'UPLOAD_FORBIDDEN' : 'UPLOAD_NOT_FOUND',
      'A borrowed same-site Key record is required for return evidence.',
      resource ? 403 : 404,
    );
  }
}
