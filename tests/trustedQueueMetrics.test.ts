import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { calculateTrustedQueueMetrics, inferQueueMetricAction } from '../functions/src/queueMetrics';

const timestamp = (milliseconds: number) => Timestamp.fromMillis(milliseconds);

const empty = {
  firstQueuedAt: timestamp(1000), firstAssignedAt: null, workStartedAt: null,
  readyAt: null, completedAt: null, waitingSeconds: 0, workingSeconds: 0,
  totalCycleSeconds: 0, transferCount: 0, reassignCount: 0, releaseCount: 0,
  priorityChangeCount: 0, lastTransitionAt: timestamp(1000),
  lastEventId: 'old', metricsVersion: 1,
};

test('trusted backend uses server event time for queue duration', () => {
  const result = calculateTrustedQueueMetrics({
    before: { queueStatus: 'Waiting', queueMetrics: empty },
    after: { queueStatus: 'Assigned', queueMetrics: { ...empty, waitingSeconds: 999999 } },
    action: 'TakeJob', occurredAt: new Date(11000), eventId: 'server-event',
  });
  assert.equal(result.waitingSeconds, 10);
  assert.equal(result.lastEventId, 'server-event');
});

test('trusted action inference distinguishes transfer and priority changes', () => {
  assert.equal(inferQueueMetricAction(
    { queueStatus: 'Assigned', assignedTo: 'a' },
    { queueStatus: 'Assigned', assignedTo: 'b' },
  ), 'TransferJob');
  assert.equal(inferQueueMetricAction(
    { queueStatus: 'Assigned', assignedTo: 'a', priority: 'Normal' },
    { queueStatus: 'Assigned', assignedTo: 'a', priority: 'High' },
  ), 'PriorityChange');
});
