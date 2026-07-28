import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registeredImportModuleKeys,
  resolveImportAdapter,
} from '../src/services/importExport/importAdapterRegistry';
import { IMPORT_EXPORT_MODULES } from '../src/services/importExport/modules';

test('every allowlisted import module resolves to an explicit adapter', () => {
  const allowlisted = Object.values(IMPORT_EXPORT_MODULES).map(module => module.key).sort();
  assert.deepEqual(registeredImportModuleKeys().sort(), allowlisted);
  allowlisted.forEach(key => assert.doesNotThrow(() => resolveImportAdapter(key)));
});

test('unknown import modules fail closed', () => {
  assert.throws(
    () => resolveImportAdapter('users/../../operatorCredentials'),
    /Unsupported import module/,
  );
});

test('workflow-owned log imports cannot dispatch to Firestore collections', () => {
  for (const key of ['vehicle-logs', 'contractor-logs', 'patrol-logs', 'key-logs']) {
    assert.equal(resolveImportAdapter(key), 'workflowDenied');
  }
});
