import { canonicalUploadActor } from '../vehicleEvidencePolicy';
import {
  PrivateEvidencePolicyError,
  authorizeDriveEvidenceIdentity,
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
      media_type: 'entry_vehicle', record_id: 'session-a',
    }, 'session-a', { site_id: 'site-a' })).not.toThrow();
  });

  it('allows active, exited, and historical Contractor records at the same site', () => {
    for (const status of ['กำลังปฏิบัติงาน', 'ออกแล้ว', 'Archived']) {
      expect(() => authorizeRegisteredEvidence(fileId, actor, {
        file_id: fileId,
        site_id: 'site-a',
        module: 'Contractor',
        module_name: 'ContractorLogs',
        media_type: 'contractor_id',
        record_id: 'CON_1',
      }, 'CON_1', { site_id: 'site-a', status })).not.toThrow();
    }
  });

  it('allows same-site Key evidence for borrowed and returned records', () => {
    for (const status of ['ถูกเบิก', 'คืนแล้ว']) {
      for (const mediaType of ['key_borrower', 'sig_key', 'key_return', 'sig_key_return']) {
        expect(() => authorizeRegisteredEvidence(fileId, actor, {
          file_id: fileId,
          site_id: 'site-a',
          module: 'Key',
          module_name: 'KeyLogs',
          media_type: mediaType,
          record_id: 'KEY_LOG_1',
        }, 'KEY_LOG_1', { site_id: 'site-a', status })).not.toThrow();
      }
    }
  });

  it('does not allow Key evidence identity to cross modules or records', () => {
    expect(() => authorizeRegisteredEvidence(fileId, actor, {
      file_id: fileId, site_id: 'site-a', module: 'Key',
      module_name: 'KeyLogs', media_type: 'entry_vehicle', record_id: 'KEY_LOG_1',
    }, 'KEY_LOG_1', { site_id: 'site-a' })).toThrow(PrivateEvidencePolicyError);
    expect(() => authorizeRegisteredEvidence(fileId, actor, {
      file_id: fileId, site_id: 'site-a', module: 'Vehicle',
      module_name: 'VehicleLogs', media_type: 'key_borrower', record_id: 'KEY_LOG_1',
    }, 'KEY_LOG_1', { site_id: 'site-a' })).toThrow(PrivateEvidencePolicyError);
    expect(() => authorizeRegisteredEvidence(fileId, actor, {
      file_id: fileId, site_id: 'site-a', module: 'Key',
      module_name: 'KeyLogs', media_type: 'sig_key', record_id: 'KEY_LOG_1',
    }, 'KEY_LOG_2', { site_id: 'site-a' })).toThrow(PrivateEvidencePolicyError);
  });

  it('denies cross-site, unknown, mismatched, and unlinked Drive files', () => {
    for (const [metadata, linkedId, record] of [
      [{ file_id: fileId, site_id: 'site-b', module: 'Vehicle', media_type: 'entry_vehicle', record_id: 'session-a' }, 'session-a', { site_id: 'site-b' }],
      [undefined, '', undefined],
      [{ file_id: fileId, site_id: 'site-a', module: 'Vehicle', media_type: 'entry_vehicle', record_id: 'session-a' }, 'session-b', { site_id: 'site-a' }],
      [{ file_id: fileId, site_id: 'site-a', module: 'Vehicle', media_type: 'entry_vehicle', record_id: 'session-a' }, 'session-a', undefined],
    ] as const) {
      expect(() => authorizeRegisteredEvidence(fileId, actor, metadata, linkedId, record))
        .toThrow(PrivateEvidencePolicyError);
    }
  });

  it('does not allow Vehicle and Contractor evidence identities to cross modules', () => {
    expect(() => authorizeRegisteredEvidence(fileId, actor, {
      file_id: fileId,
      site_id: 'site-a',
      module: 'Contractor',
      media_type: 'entry_vehicle',
      record_id: 'CON_1',
    }, 'CON_1', { site_id: 'site-a' })).toThrow(PrivateEvidencePolicyError);
    expect(() => authorizeRegisteredEvidence(fileId, actor, {
      file_id: fileId,
      site_id: 'site-a',
      module: 'Vehicle',
      media_type: 'contractor_face',
      record_id: 'session-a',
    }, 'session-a', { site_id: 'site-a' })).toThrow(PrivateEvidencePolicyError);
  });

  it('rejects a mismatched moduleName when new metadata supplies it', () => {
    expect(() => authorizeRegisteredEvidence(fileId, actor, {
      file_id: fileId,
      site_id: 'site-a',
      module: 'Contractor',
      module_name: 'VehicleLogs',
      media_type: 'contractor_face',
      record_id: 'CON_1',
    }, 'CON_1', { site_id: 'site-a' })).toThrow(PrivateEvidencePolicyError);
  });

  it('accepts matching Drive Key identity and rejects every mismatched identity field', () => {
    const registry = {
      site_id: 'site-a', module: 'Key', module_name: 'KeyLogs',
      media_type: 'key_borrower', record_id: 'KEY_LOG_1',
    };
    const driveIdentity = {
      system: 'smart-guard', site_id: 'site-a', module: 'Key',
      module_name: 'KeyLogs', media_type: 'key_borrower', record_id: 'KEY_LOG_1',
    };
    expect(() => authorizeDriveEvidenceIdentity(
      actor, registry, 'KEY_LOG_1', driveIdentity,
    )).not.toThrow();
    for (const [field, value] of [
      ['site_id', 'site-b'],
      ['module', 'Vehicle'],
      ['module_name', 'VehicleLogs'],
      ['media_type', 'entry_vehicle'],
      ['record_id', 'KEY_LOG_2'],
    ]) {
      expect(() => authorizeDriveEvidenceIdentity(
        actor, registry, 'KEY_LOG_1', { ...driveIdentity, [field]: value },
      )).toThrow(PrivateEvidencePolicyError);
    }
  });

  it('keeps legacy missing module_name compatible without bypassing registered identity', () => {
    const registry = {
      site_id: 'site-a', module: 'Key',
      media_type: 'sig_key', record_id: 'KEY_LOG_1',
    };
    expect(() => authorizeDriveEvidenceIdentity(actor, registry, 'KEY_LOG_1', {
      system: 'smart-guard', site_id: 'site-a', module: 'Key',
      media_type: 'sig_key', record_id: 'KEY_LOG_1',
    })).not.toThrow();
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
