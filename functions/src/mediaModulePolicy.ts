import {
  type CanonicalUploadActor,
  type HttpMediaUploadRequest,
  UploadPolicyError,
} from './vehicleEvidencePolicy';

const MEDIA_TYPE_PREFIXES: Record<string, readonly string[]> = {
  ContractorLogs: ['contractor_id', 'contractor_face', 'contractor_activity'],
  KeyLogs: ['key_borrower', 'sig_key'],
  PatrolLogs: ['patrol_', 'patrol_abn_'],
  IncidentReports: ['incident_'],
};

export function validateNonVehicleMediaUpload(
  request: HttpMediaUploadRequest,
  actor: CanonicalUploadActor,
  resource?: Record<string, unknown>,
): void {
  const prefixes = MEDIA_TYPE_PREFIXES[request.moduleName];
  if (!prefixes || !prefixes.some(prefix => request.mediaType === prefix || request.mediaType.startsWith(prefix))) {
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
}
