import type { CanonicalUploadActor } from './vehicleEvidencePolicy';

export class PrivateEvidencePolicyError extends Error {
  constructor(message: string, public readonly httpStatus: 403 | 404 | 413 | 415) {
    super(message);
  }
}

export function authorizeRegisteredEvidence(
  fileId: string,
  actor: CanonicalUploadActor,
  metadata: Record<string, unknown> | undefined,
  linkedRecord: Record<string, unknown> | undefined,
): void {
  if (!metadata || metadata.file_id !== fileId) {
    throw new PrivateEvidencePolicyError('Evidence metadata was not found.', 404);
  }
  if (metadata.site_id !== actor.siteId || metadata.module !== 'Vehicle') {
    throw new PrivateEvidencePolicyError('Evidence does not belong to the active site.', 403);
  }
  if (!linkedRecord || linkedRecord.site_id !== actor.siteId) {
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

