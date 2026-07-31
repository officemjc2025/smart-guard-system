import {
  UploadPolicyError,
  allowedUploadOrigins,
  canonicalUploadActor,
  corsDecision,
  parseHttpMediaUpload,
  validateVehicleEvidenceResource,
} from '../vehicleEvidencePolicy';
import { validateAndDecodeBase64 } from '../validation';

const request = {
  fileName: 'plate_in_session-a.jpg',
  base64Data: '/9j/4AAQSkZJRg==',
  mimeType: 'image/jpeg',
  moduleName: 'VehicleLogs',
  recordId: 'session-a',
  siteId: 'site-a',
  mediaType: 'entry_plate',
};
const actor = canonicalUploadActor('guard-a', {
  status: 'Active', role: 'Guard', site_id: 'site-a',
  operator_id: 'operator-a', operator_name: 'Guard A',
});

describe('Vehicle Evidence CORS policy', () => {
  it.each([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ])('allows development OPTIONS without authentication: %s', origin => {
    expect(corsDecision('OPTIONS', origin, 'securityprojectv1-staging')).toEqual({
      allowed: true, preflightStatus: 204, allowOrigin: origin,
    });
  });

  it('allows the staging Hosting origin and configured origins', () => {
    const origins = allowedUploadOrigins('securityprojectv1-staging', 'https://staging.example.test');
    expect(origins.has('https://securityprojectv1-staging.web.app')).toBe(true);
    expect(origins.has('https://staging.example.test')).toBe(true);
  });

  it.each([
    'http://192.168.1.20:3000',
    'http://10.0.0.12:3000',
    'http://172.16.5.8:3000',
    'http://172.31.255.9:3000',
  ])('allows a private-LAN Vite origin only on staging: %s', origin => {
    expect(corsDecision('OPTIONS', origin, 'securityprojectv1-staging')).toEqual({
      allowed: true, preflightStatus: 204, allowOrigin: origin,
    });
    expect(corsDecision('OPTIONS', origin, 'securityprojectv1')).toEqual({
      allowed: false, preflightStatus: 403,
    });
  });

  it.each([
    'http://192.168.1.20:3001',
    'https://192.168.1.20:3000',
    'http://8.8.8.8:3000',
    'http://172.15.1.2:3000',
    'http://172.32.1.2:3000',
  ])('denies non-canonical LAN development origins: %s', origin => {
    expect(corsDecision('OPTIONS', origin, 'securityprojectv1-staging').allowed).toBe(false);
  });

  it('denies a disallowed origin before authentication or Drive work', () => {
    expect(corsDecision('OPTIONS', 'https://evil.example', 'securityprojectv1-staging')).toEqual({
      allowed: false, preflightStatus: 403,
    });
  });
});

describe('Vehicle Evidence upload authorization', () => {
  it.each(['Guard', 'ShiftHead', 'Manager', 'Admin'])('allows canonical active role %s', role => {
    expect(canonicalUploadActor('actor', {
      status: 'Active', role, site_id: 'site-a', operator_name: 'Actor',
    }).role).toBe(role);
  });

  it.each([
    { status: 'Inactive', role: 'Guard' },
    { status: 'Active', role: 'ShiftLeader' },
    { status: 'Active', role: 'Supervisor' },
  ])('denies inactive, legacy, and unknown profiles: %o', profile => {
    expect(() => canonicalUploadActor('actor', { ...profile, site_id: 'site-a' }))
      .toThrow(UploadPolicyError);
  });

  it('allows an active same-site Vehicle Session', () => {
    expect(() => validateVehicleEvidenceResource(request, actor, {
      site_id: 'site-a', status: 'Pending',
    })).not.toThrow();
  });

  it('denies missing, cross-site, completed, and cancelled sessions', () => {
    expect(() => validateVehicleEvidenceResource(request, actor, undefined)).toThrow(UploadPolicyError);
    expect(() => validateVehicleEvidenceResource(request, actor, {
      site_id: 'site-b', status: 'Pending',
    })).toThrow(UploadPolicyError);
    for (const status of ['Completed', 'Cancelled']) {
      expect(() => validateVehicleEvidenceResource(request, actor, {
        site_id: 'site-a', status,
      })).toThrow(UploadPolicyError);
    }
  });
});

describe('Vehicle Evidence request validation', () => {
  it('accepts the strict request contract', () => {
    expect(parseHttpMediaUpload(request)).toEqual(request);
  });

  it.each([
    { ...request, fileName: '../secret.jpg' },
    { ...request, fileName: '' },
    { ...request, mediaType: '' },
    { ...request, base64Data: '' },
    { ...request, recordId: '../session-a' },
  ])('rejects an invalid request: %o', invalid => {
    expect(() => parseHttpMediaUpload(invalid)).toThrow(UploadPolicyError);
  });

  it('rejects an unsupported media type', () => {
    expect(() => validateVehicleEvidenceResource(
      { ...request, mediaType: 'executable' },
      actor,
      { site_id: 'site-a', status: 'Pending' },
    )).toThrow(UploadPolicyError);
  });

  it('rejects empty, oversized, invalid-signature, and MIME-mismatched files', () => {
    expect(() => validateAndDecodeBase64('', 'image/jpeg')).toThrow();
    expect(() => validateAndDecodeBase64(
      Buffer.alloc((2 * 1024 * 1024) + 1, 0).toString('base64'),
      'image/jpeg',
    )).toThrow();
    expect(() => validateAndDecodeBase64(Buffer.from('not-an-image').toString('base64'), 'image/jpeg'))
      .toThrow();
    const pngHeader = Buffer.from('89504E470D0A1A0A00000000', 'hex').toString('base64');
    expect(() => validateAndDecodeBase64(pngHeader, 'image/jpeg')).toThrow();
  });
});
