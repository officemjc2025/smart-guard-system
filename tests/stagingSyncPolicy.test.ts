import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  assertSafeProjects,
  diffCollection,
  documentHash,
  isInsideOperationalWindow,
  operationalCutoff,
  snapshotMode,
} from '../scripts/lib/staging-sync';

test('safety policy permits only production to staging with exact confirmation', () => {
  assert.doesNotThrow(() => assertSafeProjects({
    sourceProjectId: PRODUCTION_PROJECT_ID,
    targetProjectId: STAGING_PROJECT_ID,
    confirmation: STAGING_PROJECT_ID,
  }));
  assert.throws(() => assertSafeProjects({
    sourceProjectId: STAGING_PROJECT_ID,
    targetProjectId: PRODUCTION_PROJECT_ID,
    confirmation: STAGING_PROJECT_ID,
  }));
  assert.throws(() => assertSafeProjects({
    sourceProjectId: PRODUCTION_PROJECT_ID,
    targetProjectId: STAGING_PROJECT_ID,
    confirmation: '',
  }));
});

test('operational policies calculate inclusive timestamp windows', () => {
  const now = new Date('2026-07-29T00:00:00.000Z');
  const cutoff = operationalCutoff(snapshotMode('7d'), now);
  assert.equal(cutoff?.toISOString(), '2026-07-22T00:00:00.000Z');
  assert.equal(isInsideOperationalWindow('vehicleLogs', { entry_time: '2026-07-22T00:00:00.000Z' }, cutoff), true);
  assert.equal(isInsideOperationalWindow('vehicleLogs', { entry_time: '2026-07-21T23:59:59.999Z' }, cutoff), false);
  assert.equal(isInsideOperationalWindow('vehicleLogs', {}, cutoff), false);
});

test('diff detects missing, extra, and content mismatch deterministically', () => {
  const source = [
    { id: 'same', data: { value: 1 }, hash: documentHash({ value: 1 }) },
    { id: 'changed', data: { value: 2 }, hash: documentHash({ value: 2 }) },
    { id: 'missing', data: { value: 3 }, hash: documentHash({ value: 3 }) },
  ];
  const target = [
    { id: 'same', data: { value: 1 }, hash: documentHash({ value: 1 }) },
    { id: 'changed', data: { value: 9 }, hash: documentHash({ value: 9 }) },
    { id: 'extra', data: { value: 4 }, hash: documentHash({ value: 4 }) },
  ];
  const diff = diffCollection('parkingCards', source, target);
  assert.deepEqual(diff.missingIds, ['missing']);
  assert.deepEqual(diff.extraIds, ['extra']);
  assert.deepEqual(diff.mismatchedIds, ['changed']);
  // Staging-only extras are reported but deliberately preserved; only the
  // missing and mismatched source documents produce writes.
  assert.equal(diff.estimatedWrites, 2);
  assert.equal(diff.estimatedReads, 6);
});
