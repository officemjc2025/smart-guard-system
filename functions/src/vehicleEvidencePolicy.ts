export const CANONICAL_UPLOAD_ROLES = ['Guard', 'ShiftHead', 'Manager', 'Admin'] as const;
export const VEHICLE_EVIDENCE_MEDIA_TYPES = [
  'entry_plate',
  'entry_vehicle',
  'visitor_document',
  'exit_plate',
  'exit_vehicle',
  'activity_evidence',
] as const;

export type VehicleEvidenceMediaType = typeof VEHICLE_EVIDENCE_MEDIA_TYPES[number];

export interface HttpMediaUploadRequest {
  fileName: string;
  base64Data: string;
  mimeType: string;
  moduleName: string;
  recordId: string;
  siteId: string;
  mediaType: string;
}

export interface CanonicalUploadActor {
  uid: string;
  operatorId: string;
  operatorName: string;
  role: typeof CANONICAL_UPLOAD_ROLES[number];
  siteId: string;
}

export class UploadPolicyError extends Error {
  constructor(
    public readonly code:
      | 'UPLOAD_UNAUTHENTICATED'
      | 'UPLOAD_FORBIDDEN'
      | 'UPLOAD_INVALID_FILE'
      | 'UPLOAD_NOT_FOUND',
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
  }
}

const localDevelopmentOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

export function allowedUploadOrigins(projectId: string, configuredOrigins = ''): Set<string> {
  const hostingOrigins = [
    'https://securityprojectv1.web.app',
    'https://securityprojectv1.firebaseapp.com',
    'https://securityprojectv1-staging.web.app',
    'https://securityprojectv1-staging.firebaseapp.com',
  ];
  const configured = configuredOrigins
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const projectOrigins = projectId === 'securityprojectv1-staging'
    ? hostingOrigins.filter(origin => origin.includes('securityprojectv1-staging'))
    : hostingOrigins.filter(origin => !origin.includes('securityprojectv1-staging'));
  return new Set([...localDevelopmentOrigins, ...projectOrigins, ...configured]);
}

export function corsDecision(
  method: string,
  origin: string | undefined,
  projectId: string,
  configuredOrigins = '',
): { allowed: boolean; preflightStatus: 204 | 403 | null; allowOrigin?: string } {
  const allowed = !origin || allowedUploadOrigins(projectId, configuredOrigins).has(origin);
  return {
    allowed,
    preflightStatus: method === 'OPTIONS' ? (allowed ? 204 : 403) : null,
    ...(origin && allowed ? { allowOrigin: origin } : {}),
  };
}

function requiredString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new UploadPolicyError('UPLOAD_INVALID_FILE', `Missing required field: ${field}`, 400);
  }
  return value.trim();
}

export function parseHttpMediaUpload(value: unknown): HttpMediaUploadRequest {
  if (typeof value !== 'object' || value === null) {
    throw new UploadPolicyError('UPLOAD_INVALID_FILE', 'Request body must be a JSON object.', 400);
  }
  const data = value as Record<string, unknown>;
  const fileName = requiredString(data, 'fileName');
  if (fileName.length > 180 || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(fileName)
    || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new UploadPolicyError('UPLOAD_INVALID_FILE', 'Evidence file name is invalid.', 400);
  }
  const recordId = requiredString(data, 'recordId');
  const siteId = requiredString(data, 'siteId');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordId)) {
    throw new UploadPolicyError('UPLOAD_INVALID_FILE', 'Evidence record ID is invalid.', 400);
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(siteId)) {
    throw new UploadPolicyError('UPLOAD_INVALID_FILE', 'Evidence site ID is invalid.', 400);
  }
  return {
    fileName,
    base64Data: requiredString(data, 'base64Data'),
    mimeType: requiredString(data, 'mimeType'),
    moduleName: requiredString(data, 'moduleName'),
    recordId,
    siteId,
    mediaType: requiredString(data, 'mediaType'),
  };
}

export function canonicalUploadActor(
  uid: string,
  profile: Record<string, unknown> | undefined,
): CanonicalUploadActor {
  if (!profile || profile.status !== 'Active') {
    throw new UploadPolicyError('UPLOAD_FORBIDDEN', 'Active user profile is required.', 403);
  }
  const role = String(profile.role || '');
  if (!CANONICAL_UPLOAD_ROLES.includes(role as CanonicalUploadActor['role'])) {
    throw new UploadPolicyError('UPLOAD_FORBIDDEN', 'Canonical upload role is required.', 403);
  }
  const siteId = String(profile.site_id || '').trim();
  if (!siteId) throw new UploadPolicyError('UPLOAD_FORBIDDEN', 'Canonical site is required.', 403);
  return {
    uid,
    operatorId: String(profile.operator_id || ''),
    operatorName: String(profile.operator_name || ''),
    role: role as CanonicalUploadActor['role'],
    siteId,
  };
}

export function validateVehicleEvidenceResource(
  request: HttpMediaUploadRequest,
  actor: CanonicalUploadActor,
  resource: Record<string, unknown> | undefined,
): void {
  if (!VEHICLE_EVIDENCE_MEDIA_TYPES.includes(request.mediaType as VehicleEvidenceMediaType)) {
    throw new UploadPolicyError('UPLOAD_INVALID_FILE', 'Unsupported vehicle evidence media type.', 400);
  }
  if (!resource) {
    throw new UploadPolicyError('UPLOAD_NOT_FOUND', 'Vehicle evidence record was not found.', 404);
  }
  if (request.siteId !== actor.siteId || resource.site_id !== actor.siteId) {
    throw new UploadPolicyError('UPLOAD_FORBIDDEN', 'Cross-site upload is not allowed.', 403);
  }
  const entryEvidence = ['entry_plate', 'entry_vehicle', 'visitor_document', 'activity_evidence'].includes(request.mediaType);
  if (entryEvidence && ['Completed', 'Cancelled'].includes(String(resource.status || ''))) {
    throw new UploadPolicyError('UPLOAD_FORBIDDEN', 'The Vehicle Session no longer accepts entry evidence.', 403);
  }
  if (!entryEvidence && (
    resource.status === 'ออกแล้ว'
    || resource.workflow_status === 'completed'
  )) {
    throw new UploadPolicyError('UPLOAD_FORBIDDEN', 'The completed vehicle exit no longer accepts evidence.', 403);
  }
}
