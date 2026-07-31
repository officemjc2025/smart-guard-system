import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateContractorWorkspace,
  beginContractorWorkspaceRelease,
  createIdleContractorWorkspace,
  failContractorWorkspaceRelease,
  validateOptionalNationalId,
} from '../src/services/contractorWorkspace';
import type { ContractorLogRecord } from '../src/types';

const record = {
  contractor_log_id: 'CON_1',
  contractor_name: 'ช่างหนึ่ง',
  status: 'กำลังปฏิบัติงาน',
} as ContractorLogRecord;

test('Contractor Workspace lifecycle is isolated from Contractor business status', () => {
  const active = activateContractorWorkspace(record);
  assert.equal(active.lifecycle, 'active');
  assert.equal(active.record?.status, 'กำลังปฏิบัติงาน');
});

test('release failure preserves the selected Contractor record for retry', () => {
  const active = activateContractorWorkspace(record);
  const failed = failContractorWorkspaceRelease(
    beginContractorWorkspaceRelease(active),
    new Error('permission denied'),
  );
  assert.equal(failed.lifecycle, 'release-failed');
  assert.equal(failed.contractorId, 'CON_1');
  assert.equal(failed.record, record);
});

test('national ID is optional but must contain exactly 13 digits when supplied', () => {
  assert.equal(validateOptionalNationalId(''), '');
  assert.equal(validateOptionalNationalId('123 4567890123'), '1234567890123');
  assert.throws(() => validateOptionalNationalId('1234'), /13 หลัก/);
});

test('idle Contractor Workspace does not contain a business record', () => {
  assert.deepEqual(createIdleContractorWorkspace(), {
    lifecycle: 'idle',
    contractorId: '',
    record: null,
    releaseError: '',
  });
});
