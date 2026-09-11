import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedWorkItemTransition } from '../src/services/workItemPolicy';

test('Work Center lifecycle accepts only explicit transitions', () => {
  assert.equal(isAllowedWorkItemTransition('Open', 'Acknowledged', 'Guard'), true);
  assert.equal(isAllowedWorkItemTransition('Open', 'InProgress', 'Guard'), false);
  assert.equal(isAllowedWorkItemTransition('Acknowledged', 'InProgress', 'Guard'), true);
  assert.equal(isAllowedWorkItemTransition('InProgress', 'Waiting', 'Guard'), true);
  assert.equal(isAllowedWorkItemTransition('Waiting', 'InProgress', 'Guard'), true);
  assert.equal(isAllowedWorkItemTransition('InProgress', 'Resolved', 'Guard'), false);
  assert.equal(isAllowedWorkItemTransition('InProgress', 'Resolved', 'Guard', 'Fixed and verified'), true);
  assert.equal(isAllowedWorkItemTransition('Resolved', 'Closed', 'ShiftHead'), true);
  assert.equal(isAllowedWorkItemTransition('Resolved', 'InProgress', 'Guard'), false);
  assert.equal(isAllowedWorkItemTransition('Resolved', 'InProgress', 'Manager', 'Reopened for follow-up'), true);
  assert.equal(isAllowedWorkItemTransition('Open', 'Closed', 'Admin'), false);
});
