import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canLoadDashboard,
  isDashboardFailure,
  shouldHydrateAuthProfile,
} from '../src/services/authFlowPolicy';

test('auth observer waits while PIN verification owns the anonymous session', () => {
  assert.equal(shouldHydrateAuthProfile(true), false);
  assert.equal(shouldHydrateAuthProfile(false), true);
});

test('Dashboard cannot load before role and site hydration', () => {
  assert.equal(canLoadDashboard(null), false);
  assert.equal(canLoadDashboard({ status: 'Active', role: 'Admin' }), false);
  assert.equal(canLoadDashboard({ status: 'Active', site_id: 'site-01' }), false);
  assert.equal(canLoadDashboard({ status: 'Inactive', role: 'Admin', site_id: 'site-01' }), false);
  assert.equal(canLoadDashboard({ status: 'Active', role: 'Admin', site_id: 'site-01' }), true);
});

test('Dashboard permission failure remains a Dashboard-stage failure', () => {
  assert.equal(isDashboardFailure('AUTH-13'), true);
  assert.equal(isDashboardFailure('AUTH-05'), false);
});
