import { canonicalUploadActor } from '../vehicleEvidencePolicy';
import {
  PrivateEvidencePolicyError,
  authorizeRegisteredEvidence,
  validatePrivateImageMetadata,
} from '../privateEvidencePolicy';

const actor = canonicalUploadActor('guard-a', {
  status: 'Active', role: 'Guard', site_id: 'site-a', operator_name: 'Guard A',
});
const fileId = '1AbCdEfGhIjKlMnOpQrSt';

describe('private vehicle evidence authorization', () => {
  it('allows a same-site canonical Guard linked to trusted metadata', () => {
    expect(() => authorizeRegisteredEvidence(fileId, actor, {
      file_id: fileId, site_id: 'site-a', module: 'Vehicle',
    }, { site_id: 'site-a' })).not.toThrow();
  });

  it('denies cross-site, unknown, and unlinked Drive files', () => {
    for (const [metadata, record] of [
      [{ file_id: fileId, site_id: 'site-b', module: 'Vehicle' }, { site_id: 'site-b' }],
      [undefined, undefined],
      [{ file_id: fileId, site_id: 'site-a', module: 'Vehicle' }, undefined],
    ] as const) {
      expect(() => authorizeRegisteredEvidence(fileId, actor, metadata, record))
        .toThrow(PrivateEvidencePolicyError);
    }
  });

  it('denies non-images and oversized files', () => {
    expect(() => validatePrivateImageMetadata(fileId, 'text/html', 100, false))
      .toThrow(PrivateEvidencePolicyError);
    expect(() => validatePrivateImageMetadata(fileId, 'image/jpeg', 11 * 1024 * 1024, false))
      .toThrow(PrivateEvidencePolicyError);
  });

  it('accepts supported bounded image metadata', () => {
    expect(() => validatePrivateImageMetadata(fileId, 'image/webp', 1024, false)).not.toThrow();
  });
});
