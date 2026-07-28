import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExpectedSessionVersion, incrementSessionVersions, SessionConflictError } from '../src/services/vehicleSessionVersionService';

test('session version increments exactly once', () => assert.deepEqual(incrementSessionVersions(4, 2, false), { sessionVersion: 5, assignmentVersion: 2 }));
test('assignment increments both versions', () => assert.deepEqual(incrementSessionVersions(4, 2, true), { sessionVersion: 5, assignmentVersion: 3 }));
test('stale expected version throws typed conflict', () => assert.throws(() => assertExpectedSessionVersion('S1', 2, 3), SessionConflictError));
test('retry with latest succeeds', () => assert.equal(assertExpectedSessionVersion('S1', 3, 3), 3));
test('legacy missing version normalizes to zero', () => assert.equal(assertExpectedSessionVersion('S1', 0, undefined), 0));
test('concurrent stale client cannot pass assertion', () => {
  assert.equal(assertExpectedSessionVersion('S1', 1, 1), 1);
  assert.throws(() => assertExpectedSessionVersion('S1', 1, 2), SessionConflictError);
});
