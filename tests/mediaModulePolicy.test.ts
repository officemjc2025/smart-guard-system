import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNonVehicleMediaUpload } from '../functions/src/mediaModulePolicy';
import type {
  CanonicalUploadActor,
  HttpMediaUploadRequest,
} from '../functions/src/vehicleEvidencePolicy';

const actor: CanonicalUploadActor = {
  uid: 'guard-1',
  operatorId: 'guard-1',
  operatorName: 'Guard One',
  role: 'Guard',
  siteId: 'site-01',
};

const request = (overrides: Partial<HttpMediaUploadRequest> = {}): HttpMediaUploadRequest => ({
  fileName: 'contractor.jpg',
  base64Data: 'AA==',
  mimeType: 'image/jpeg',
  moduleName: 'ContractorLogs',
  recordId: 'CON_123',
  siteId: 'site-01',
  mediaType: 'contractor_face',
  ...overrides,
});

test('Contractor entry evidence is authorized by canonical site and module media type', () => {
  assert.doesNotThrow(() => validateNonVehicleMediaUpload(request(), actor));
});

test('Contractor evidence rejects the formerly hardcoded cross-site value', () => {
  assert.throws(
    () => validateNonVehicleMediaUpload(request({ siteId: 'smart-guard' }), actor),
    error => error instanceof Error && error.message === 'Cross-site upload is not allowed.',
  );
});

test('Contractor activity evidence requires an active same-site record', () => {
  assert.throws(
    () => validateNonVehicleMediaUpload(request({ mediaType: 'contractor_activity' }), actor),
    /active Contractor record/,
  );
  assert.doesNotThrow(() => validateNonVehicleMediaUpload(
    request({ mediaType: 'contractor_activity' }),
    actor,
    { site_id: 'site-01', status: 'กำลังปฏิบัติงาน' },
  ));
});

test('module policy rejects Vehicle media identity on Contractor uploads', () => {
  assert.throws(
    () => validateNonVehicleMediaUpload(request({ mediaType: 'entry_vehicle' }), actor),
    /Unsupported media type/,
  );
});

test('Key evidence accepts only canonical same-site media identities', () => {
  const keyRequest = request({
    moduleName: 'KeyLogs',
    recordId: 'KEY_LOG_1',
    mediaType: 'key_borrower',
  });
  assert.doesNotThrow(() => validateNonVehicleMediaUpload(keyRequest, actor));
  assert.doesNotThrow(() => validateNonVehicleMediaUpload(
    { ...keyRequest, mediaType: 'sig_key' },
    actor,
  ));
  assert.doesNotThrow(() => validateNonVehicleMediaUpload(
    { ...keyRequest, mediaType: 'key_return' },
    actor,
    { site_id: 'site-01', status: 'ถูกเบิก' },
  ));
  assert.doesNotThrow(() => validateNonVehicleMediaUpload(
    { ...keyRequest, mediaType: 'sig_key_return' },
    actor,
    { site_id: 'site-01', status: 'ถูกเบิก' },
  ));
  assert.throws(
    () => validateNonVehicleMediaUpload(
      { ...keyRequest, mediaType: 'key_return' },
      actor,
      { site_id: 'site-01', status: 'คืนแล้ว' },
    ),
    /borrowed same-site Key record/,
  );
  assert.throws(
    () => validateNonVehicleMediaUpload({ ...keyRequest, mediaType: 'entry_vehicle' }, actor),
    /Unsupported media type/,
  );
  assert.throws(
    () => validateNonVehicleMediaUpload({ ...keyRequest, mediaType: 'key_return_tampered' }, actor),
    /Unsupported media type/,
  );
  assert.throws(
    () => validateNonVehicleMediaUpload({ ...keyRequest, siteId: 'site-02' }, actor),
    /Cross-site/,
  );
});
