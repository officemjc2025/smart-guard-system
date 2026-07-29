import { Timestamp } from 'firebase/firestore';
import type { VehicleQueueStatus } from '../types';
import {
  calculateQueueMetricTransition,
  emptyQueueMetrics,
  type PureQueueMetrics,
  type QueueMetricAction,
} from './vehicleSessionMetricsLogic';

const milliseconds = (value: unknown): number | null =>
  value instanceof Timestamp ? value.toMillis() :
    value instanceof Date ? value.getTime() :
      typeof value === 'number' && Number.isFinite(value) ? value : null;

export function normalizePureQueueMetrics(value: unknown): PureQueueMetrics {
  const data = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const base = emptyQueueMetrics();
  const number = (field: string) => typeof data[field] === 'number' && Number.isFinite(data[field]) ? Math.max(0, data[field] as number) : 0;
  return {
    firstQueuedAt: milliseconds(data.firstQueuedAt),
    firstAssignedAt: milliseconds(data.firstAssignedAt),
    workStartedAt: milliseconds(data.workStartedAt),
    readyAt: milliseconds(data.readyAt),
    completedAt: milliseconds(data.completedAt),
    waitingSeconds: number('waitingSeconds'),
    workingSeconds: number('workingSeconds'),
    totalCycleSeconds: number('totalCycleSeconds'),
    transferCount: number('transferCount'),
    reassignCount: number('reassignCount'),
    releaseCount: number('releaseCount'),
    priorityChangeCount: number('priorityChangeCount'),
    lastTransitionAt: milliseconds(data.lastTransitionAt),
    lastEventId: typeof data.lastEventId === 'string' ? data.lastEventId : '',
    metricsVersion: number('metricsVersion') || base.metricsVersion,
  };
}

const timestamp = (value: number | null) => value === null ? null : Timestamp.fromMillis(value);

export function emptyFirestoreQueueMetrics() {
  const metrics = emptyQueueMetrics();
  return {
    firstQueuedAt: null, firstAssignedAt: null, workStartedAt: null,
    readyAt: null, completedAt: null, waitingSeconds: metrics.waitingSeconds,
    workingSeconds: metrics.workingSeconds, totalCycleSeconds: metrics.totalCycleSeconds,
    transferCount: metrics.transferCount, reassignCount: metrics.reassignCount,
    releaseCount: metrics.releaseCount, priorityChangeCount: metrics.priorityChangeCount,
    lastTransitionAt: null, lastEventId: '', metricsVersion: metrics.metricsVersion,
  };
}

export function firestoreQueueMetricTransition(
  previousSession: Record<string, unknown>,
  nextQueueStatus: VehicleQueueStatus,
  action: QueueMetricAction,
  clientEventId: string,
  occurredAt = Timestamp.now(),
) {
  const metrics = calculateQueueMetricTransition({
    previousSession: {
      queueStatus: previousSession.queueStatus as VehicleQueueStatus | undefined,
      queueMetrics: normalizePureQueueMetrics(previousSession.queueMetrics),
    },
    nextQueueStatus,
    action,
    occurredAt: occurredAt.toMillis(),
    clientEventId,
  });
  return {
    firstQueuedAt: timestamp(metrics.firstQueuedAt),
    firstAssignedAt: timestamp(metrics.firstAssignedAt),
    workStartedAt: timestamp(metrics.workStartedAt),
    readyAt: timestamp(metrics.readyAt),
    completedAt: timestamp(metrics.completedAt),
    waitingSeconds: metrics.waitingSeconds,
    workingSeconds: metrics.workingSeconds,
    totalCycleSeconds: metrics.totalCycleSeconds,
    transferCount: metrics.transferCount,
    reassignCount: metrics.reassignCount,
    releaseCount: metrics.releaseCount,
    priorityChangeCount: metrics.priorityChangeCount,
    lastTransitionAt: timestamp(metrics.lastTransitionAt),
    lastEventId: metrics.lastEventId,
    metricsVersion: metrics.metricsVersion,
  };
}
