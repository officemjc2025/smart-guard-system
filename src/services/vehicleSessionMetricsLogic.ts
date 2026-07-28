import type { VehicleQueueStatus } from '../types';

export interface PureQueueMetrics {
  firstQueuedAt: number | null;
  firstAssignedAt: number | null;
  workStartedAt: number | null;
  readyAt: number | null;
  completedAt: number | null;
  waitingSeconds: number;
  workingSeconds: number;
  totalCycleSeconds: number;
  transferCount: number;
  reassignCount: number;
  releaseCount: number;
  priorityChangeCount: number;
  lastTransitionAt: number | null;
  lastEventId: string;
  metricsVersion: number;
}

export type QueueMetricAction =
  | 'Created' | 'TakeJob' | 'TransferJob' | 'AdministrativeOverride'
  | 'ReleaseJob' | 'PriorityChange' | 'QueueStatusChange'
  | 'SessionCompletion' | 'Cancelled';

export interface QueueMetricSession {
  queueStatus?: VehicleQueueStatus;
  queueMetrics?: Partial<PureQueueMetrics>;
}

export interface QueueMetricTransitionInput {
  previousSession: QueueMetricSession;
  nextQueueStatus: VehicleQueueStatus;
  action: QueueMetricAction;
  occurredAt: Date | number;
  clientEventId: string;
}

export const emptyQueueMetrics = (occurredAt?: Date | number): PureQueueMetrics => {
  const time = occurredAt === undefined ? null : Math.max(0, occurredAt instanceof Date ? occurredAt.getTime() : occurredAt);
  return {
    firstQueuedAt: time, firstAssignedAt: null, workStartedAt: null,
    readyAt: null, completedAt: null, waitingSeconds: 0, workingSeconds: 0,
    totalCycleSeconds: 0, transferCount: 0, reassignCount: 0,
    releaseCount: 0, priorityChangeCount: 0, lastTransitionAt: time,
    lastEventId: '', metricsVersion: 1,
  };
};

const secondsBetween = (from: number | null, to: number) =>
  from === null ? 0 : Math.max(0, Math.floor((to - from) / 1000));

export function calculateQueueMetricTransition(input: QueueMetricTransitionInput): PureQueueMetrics {
  const occurredAt = Math.max(0, input.occurredAt instanceof Date ? input.occurredAt.getTime() : input.occurredAt);
  const base = { ...emptyQueueMetrics(), ...input.previousSession.queueMetrics };
  if (base.lastEventId === input.clientEventId) return base;
  if (base.completedAt !== null && input.nextQueueStatus !== 'Completed') {
    throw new Error('Completed queue metrics are immutable.');
  }
  const previousStatus = input.previousSession.queueStatus ?? 'Waiting';
  const next = { ...base, lastEventId: input.clientEventId, lastTransitionAt: occurredAt, metricsVersion: Math.max(1, base.metricsVersion + 1) };
  if (next.firstQueuedAt === null) next.firstQueuedAt = occurredAt;

  if (previousStatus === 'Waiting' && input.nextQueueStatus === 'Assigned') {
    next.firstAssignedAt ??= occurredAt;
    next.waitingSeconds += secondsBetween(base.lastTransitionAt ?? base.firstQueuedAt, occurredAt);
  }
  if (input.nextQueueStatus === 'In Progress' && previousStatus !== 'In Progress') {
    next.workStartedAt ??= occurredAt;
  }
  if (previousStatus === 'In Progress' && input.nextQueueStatus !== 'In Progress') {
    next.workingSeconds += secondsBetween(base.lastTransitionAt ?? base.workStartedAt, occurredAt);
  }
  if (input.nextQueueStatus === 'Ready') next.readyAt ??= occurredAt;
  if (input.nextQueueStatus === 'Completed') {
    next.completedAt ??= occurredAt;
    next.totalCycleSeconds = secondsBetween(next.firstQueuedAt, occurredAt);
  }
  if (input.action === 'TransferJob') next.transferCount += 1;
  if (input.action === 'AdministrativeOverride') next.reassignCount += 1;
  if (input.action === 'ReleaseJob') next.releaseCount += 1;
  if (input.action === 'PriorityChange') next.priorityChangeCount += 1;
  return next;
}
