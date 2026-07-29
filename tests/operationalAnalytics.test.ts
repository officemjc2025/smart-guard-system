import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsContributionDelta, analyticsDateKey, boundedAnalyticsRange, protectCsvFormula } from '../src/services/operationalAnalyticsLogic';

test('completion contribution is counted once', () => {
  const first = analyticsContributionDelta({ createdCounted: true, completedCounted: false }, { created: true, completed: true });
  const duplicate = analyticsContributionDelta(first.next, { created: true, completed: true });
  assert.equal(first.completed, 1); assert.equal(duplicate.completed, 0); assert.equal(duplicate.created, 0);
});
test('ledger prevents duplicate creation', () => assert.equal(analyticsContributionDelta({ createdCounted: true, completedCounted: false }, { created: true, completed: false }).created, 0));
test('Bangkok daily key handles UTC cross-midnight', () => assert.equal(analyticsDateKey(new Date('2026-07-23T18:30:00Z')), '2026-07-24'));
test('bounded preview range accepts 31 days', () => assert.ok(boundedAnalyticsRange('2026-07-01', '2026-07-31')));
test('unsafe rebuild range is rejected', () => assert.throws(() => boundedAnalyticsRange('2026-01-01', '2026-03-01')));
test('CSV formula injection is escaped', () => ['=SUM(1,2)', '+1', '-1', '@cmd'].forEach(value => assert.ok(protectCsvFormula(value).startsWith("'"))));
