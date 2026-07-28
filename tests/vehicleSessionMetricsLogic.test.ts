import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQueueMetricTransition, emptyQueueMetrics } from '../src/services/vehicleSessionMetricsLogic';

const transition = (status: 'Waiting' | 'Assigned' | 'In Progress' | 'Waiting Information' | 'Ready' | 'Completed', metrics = emptyQueueMetrics(0), next: Parameters<typeof calculateQueueMetricTransition>[0]['nextQueueStatus'], action: Parameters<typeof calculateQueueMetricTransition>[0]['action'], at = 10000, id = `${action}-${at}`) =>
  calculateQueueMetricTransition({ previousSession: { queueStatus: status, queueMetrics: metrics }, nextQueueStatus: next, action, occurredAt: at, clientEventId: id });

test('waiting duration is calculated and non-negative', () => {
  assert.equal(transition('Waiting', emptyQueueMetrics(0), 'Assigned', 'TakeJob', 5000).waitingSeconds, 5);
  assert.equal(transition('Waiting', emptyQueueMetrics(10000), 'Assigned', 'TakeJob', 5000).waitingSeconds, 0);
});
test('working duration excludes Waiting Information', () => {
  const started = transition('Assigned', emptyQueueMetrics(0), 'In Progress', 'QueueStatusChange', 1000);
  const paused = transition('In Progress', started, 'Waiting Information', 'QueueStatusChange', 6000);
  const resumed = transition('Waiting Information', paused, 'In Progress', 'QueueStatusChange', 11000);
  const ready = transition('In Progress', resumed, 'Ready', 'QueueStatusChange', 15000);
  assert.equal(ready.workingSeconds, 9);
});
test('total cycle duration is creation to completion', () => {
  assert.equal(transition('Ready', emptyQueueMetrics(1000), 'Completed', 'SessionCompletion', 11000).totalCycleSeconds, 10);
});
test('transfer reassignment release and priority counters remain separate', () => {
  let metrics = transition('Assigned', emptyQueueMetrics(0), 'Assigned', 'TransferJob', 1000);
  metrics = transition('Assigned', metrics, 'Assigned', 'AdministrativeOverride', 2000);
  metrics = transition('Assigned', metrics, 'Waiting', 'ReleaseJob', 3000);
  metrics = transition('Waiting', metrics, 'Waiting', 'PriorityChange', 4000);
  assert.deepEqual([metrics.transferCount, metrics.reassignCount, metrics.releaseCount, metrics.priorityChangeCount], [1, 1, 1, 1]);
});
test('repeated idempotent event does not increment twice', () => {
  const first = transition('Assigned', emptyQueueMetrics(0), 'Assigned', 'TransferJob', 1000, 'event-1');
  const repeated = transition('Assigned', first, 'Assigned', 'TransferJob', 1000, 'event-1');
  assert.equal(repeated.transferCount, 1);
});
test('legacy missing milestones are tolerated', () => {
  const result = calculateQueueMetricTransition({ previousSession: {}, nextQueueStatus: 'Waiting', action: 'Created', occurredAt: 1000, clientEventId: 'legacy' });
  assert.equal(result.firstQueuedAt, 1000);
});
test('completed metrics are frozen', () => {
  const completed = transition('Ready', emptyQueueMetrics(0), 'Completed', 'SessionCompletion', 1000);
  assert.throws(() => transition('Completed', completed, 'In Progress', 'QueueStatusChange', 2000));
});
