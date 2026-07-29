import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canOverrideLock,
  canTakeAssignment,
  deriveQueueStatus,
  isSameSite,
  isStaleAssignment,
  queueDefaultsForLegacy,
  uniqueClientEventIds,
} from '../src/services/vehicleQueueLogic';

test('two guards cannot take the same assigned job', () => {
  const assigned = { assignedTo: 'guard-a', version: 1, siteId: 'site-01' };
  assert.equal(canTakeAssignment(assigned, 'guard-a'), true);
  assert.equal(canTakeAssignment(assigned, 'guard-b'), false);
});

test('transfer is blocked while another client holds a live lock', () => {
  const locked = { assignedTo: 'guard-a', version: 1, siteId: 'site-01', editingBy: 'guard-a', expiresAtMs: 20_000 };
  assert.equal(canOverrideLock(locked, 'shift-head', false, 10_000), false);
});

test('release after reassignment is rejected by ownership snapshot', () => {
  assert.equal(canTakeAssignment({ assignedTo: 'guard-b', version: 2, siteId: 'site-01' }, 'guard-a'), false);
});

test('stale client save is detected by assignment version', () => {
  assert.equal(isStaleAssignment(3, 4), true);
  assert.equal(isStaleAssignment(4, 4), false);
});

test('expired soft lock can be continued', () => {
  const expired = { assignedTo: 'guard-a', version: 1, siteId: 'site-01', editingBy: 'guard-b', expiresAtMs: 9_999 };
  assert.equal(canOverrideLock(expired, 'guard-a', false, 10_000), true);
});

test('administrative override bypasses a live lock', () => {
  const locked = { assignedTo: 'guard-a', version: 1, siteId: 'site-01', editingBy: 'guard-b', expiresAtMs: 20_000 };
  assert.equal(canOverrideLock(locked, 'admin', true, 10_000), true);
});

test('offline replay retains one entry per client event id', () => {
  assert.deepEqual(uniqueClientEventIds(['evt-1', 'evt-2', 'evt-1']), ['evt-1', 'evt-2']);
});

test('duplicate activity client_event_id resolves deterministically', () => {
  assert.equal(uniqueClientEventIds(['same', 'same']).length, 1);
});

test('same-site access is accepted', () => {
  assert.equal(isSameSite('site-01', 'site-01'), true);
});

test('cross-site access is rejected', () => {
  assert.equal(isSameSite('site-02', 'site-01'), false);
});

test('legacy defaults are deterministic and do not auto-assign', () => {
  const defaults = queueDefaultsForLegacy({ stage: 'Created', status: 'Pending' });
  assert.equal(defaults.assignedTo, null);
  assert.equal(defaults.priority, 'Normal');
  assert.equal(defaults.queueSchemaVersion, 1);
  assert.equal(deriveQueueStatus({ stage: 'Completed', status: 'Completed' }), 'Completed');
});
