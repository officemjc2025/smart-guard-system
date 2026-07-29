import { Timestamp, type DocumentData } from 'firebase-admin/firestore';

export type QueueStatus =
  | 'Waiting' | 'Assigned' | 'In Progress'
  | 'Waiting Information' | 'Ready' | 'Completed';

export type QueueMetricAction =
  | 'Created' | 'TakeJob' | 'TransferJob' | 'AdministrativeOverride'
  | 'ReleaseJob' | 'PriorityChange' | 'QueueStatusChange'
  | 'SessionCompletion' | 'Cancelled';

interface QueueMetrics {
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

const timestampMillis = (value: unknown): number | null => {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === 'object' && 'toMillis' in value &&
      typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const milliseconds = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  return null;
};

const finiteCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function normalizeQueueMetrics(value: unknown): QueueMetrics {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    firstQueuedAt: timestampMillis(data.firstQueuedAt),
    firstAssignedAt: timestampMillis(data.firstAssignedAt),
    workStartedAt: timestampMillis(data.workStartedAt),
    readyAt: timestampMillis(data.readyAt),
    completedAt: timestampMillis(data.completedAt),
    waitingSeconds: finiteCount(data.waitingSeconds),
    workingSeconds: finiteCount(data.workingSeconds),
    totalCycleSeconds: finiteCount(data.totalCycleSeconds),
    transferCount: finiteCount(data.transferCount),
    reassignCount: finiteCount(data.reassignCount),
    releaseCount: finiteCount(data.releaseCount),
    priorityChangeCount: finiteCount(data.priorityChangeCount),
    lastTransitionAt: timestampMillis(data.lastTransitionAt),
    lastEventId: typeof data.lastEventId === 'string' ? data.lastEventId : '',
    metricsVersion: Math.max(1, finiteCount(data.metricsVersion)),
  };
}

const secondsBetween = (from: number | null, to: number) =>
  from === null ? 0 : Math.max(0, Math.floor((to - from) / 1000));

const firestoreTimestamp = (value: number | null) =>
  value === null ? null : Timestamp.fromMillis(value);

export function calculateTrustedQueueMetrics(input: {
  before: DocumentData | undefined;
  after: DocumentData;
  action: QueueMetricAction;
  occurredAt: Date;
  eventId: string;
}) {
  const occurredAt = input.occurredAt.getTime();
  const metrics = normalizeQueueMetrics(input.before?.queueMetrics ?? input.after.queueMetrics);
  if (metrics.lastEventId === input.eventId) return toFirestoreMetrics(metrics);
  if (metrics.completedAt !== null) return toFirestoreMetrics(metrics);

  const previousStatus = String(input.before?.queueStatus || 'Waiting') as QueueStatus;
  const nextStatus = String(input.after.queueStatus || previousStatus) as QueueStatus;
  const next = {
    ...metrics,
    lastTransitionAt: occurredAt,
    lastEventId: input.eventId,
    metricsVersion: metrics.metricsVersion + 1,
  };
  next.firstQueuedAt ??= occurredAt;

  if (previousStatus === 'Waiting' && nextStatus === 'Assigned') {
    next.firstAssignedAt ??= occurredAt;
    next.waitingSeconds += secondsBetween(metrics.lastTransitionAt ?? metrics.firstQueuedAt, occurredAt);
  }
  if (nextStatus === 'In Progress' && previousStatus !== 'In Progress') {
    next.workStartedAt ??= occurredAt;
  }
  if (previousStatus === 'In Progress' && nextStatus !== 'In Progress') {
    next.workingSeconds += secondsBetween(metrics.lastTransitionAt ?? metrics.workStartedAt, occurredAt);
  }
  if (nextStatus === 'Ready') next.readyAt ??= occurredAt;
  if (nextStatus === 'Completed') {
    next.completedAt ??= occurredAt;
    next.totalCycleSeconds = secondsBetween(next.firstQueuedAt, occurredAt);
  }
  if (input.action === 'TransferJob') next.transferCount += 1;
  if (input.action === 'AdministrativeOverride') next.reassignCount += 1;
  if (input.action === 'ReleaseJob') next.releaseCount += 1;
  if (input.action === 'PriorityChange') next.priorityChangeCount += 1;

  return toFirestoreMetrics(next);
}

function toFirestoreMetrics(metrics: QueueMetrics) {
  return {
    firstQueuedAt: firestoreTimestamp(metrics.firstQueuedAt),
    firstAssignedAt: firestoreTimestamp(metrics.firstAssignedAt),
    workStartedAt: firestoreTimestamp(metrics.workStartedAt),
    readyAt: firestoreTimestamp(metrics.readyAt),
    completedAt: firestoreTimestamp(metrics.completedAt),
    waitingSeconds: metrics.waitingSeconds,
    workingSeconds: metrics.workingSeconds,
    totalCycleSeconds: metrics.totalCycleSeconds,
    transferCount: metrics.transferCount,
    reassignCount: metrics.reassignCount,
    releaseCount: metrics.releaseCount,
    priorityChangeCount: metrics.priorityChangeCount,
    lastTransitionAt: firestoreTimestamp(metrics.lastTransitionAt),
    lastEventId: metrics.lastEventId,
    metricsVersion: metrics.metricsVersion,
  };
}

export function inferQueueMetricAction(
  before: DocumentData | undefined,
  after: DocumentData,
): QueueMetricAction | null {
  if (!before) return 'Created';
  if (before.queueStatus !== after.queueStatus) {
    if (after.queueStatus === 'Completed') return after.status === 'Cancelled' ? 'Cancelled' : 'SessionCompletion';
    if (before.assignedTo && !after.assignedTo) return 'ReleaseJob';
    if (!before.assignedTo && after.assignedTo) return 'TakeJob';
    return 'QueueStatusChange';
  }
  if (before.assignedTo !== after.assignedTo) {
    return before.assignedTo && after.assignedTo ? 'TransferJob' :
      after.assignedTo ? 'TakeJob' : 'ReleaseJob';
  }
  if (before.priority !== after.priority) return 'PriorityChange';
  return null;
}
