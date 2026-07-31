import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOptionalIdentityNumber } from '../src/services/keyIdentityPolicy';

test('Key identity number is optional and preserves non-national document identifiers', () => {
  assert.equal(normalizeOptionalIdentityNumber(''), '');
  assert.equal(normalizeOptionalIdentityNumber('  '), '');
  assert.equal(normalizeOptionalIdentityNumber('PASS-A12345'), 'PASS-A12345');
});

test('Key Thai national identity number is normalized and requires 13 digits', () => {
  assert.equal(normalizeOptionalIdentityNumber('1-2345-67890-12-3'), '1234567890123');
  assert.throws(() => normalizeOptionalIdentityNumber('123456789012'), /13 หลัก/);
});
