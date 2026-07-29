import type { VehicleQueuePriority, VehicleQueueStatus, VehicleSessionStage, VehicleSessionStatus } from '../types';

export interface QueueDerivationInput {
  stage?: VehicleSessionStage | string;
  status?: VehicleSessionStatus | string;
  assignedTo?: string | null;
  visitor_name?: string | null;
  target_room?: string | null;
  vehicle_plate?: string | null;
}

export function deriveQueueStatus(session: QueueDerivationInput): VehicleQueueStatus {
  if (session.status === 'Completed' || session.status === 'Cancelled' ||
      session.stage === 'Completed' || session.stage === 'Cancelled' || session.stage === 'VehicleExited') {
    return 'Completed';
  }
  if (session.stage === 'Ready' || session.stage === 'Active' || session.status === 'Ready') return 'Ready';
  if (session.assignedTo?.trim()) return 'Assigned';
  if (!session.visitor_name?.trim() || !session.target_room?.trim()) return 'Waiting Information';
  if (session.vehicle_plate?.trim() || (session.stage && session.stage !== 'Created')) return 'In Progress';
  return 'Waiting';
}

export const queuePriorityOrder: Readonly<Record<VehicleQueuePriority, number>> = {
  Emergency: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

export interface QueueMigrationDefaults {
  queueStatus: VehicleQueueStatus;
  priority: VehicleQueuePriority;
  assignedTo: string | null;
  assignedBy: string | null;
  assignedAt: unknown | null;
  queuePosition: number | null;
  queueSchemaVersion: 1;
}

export function queueDefaultsForLegacy(session: QueueDerivationInput & Record<string, unknown>): QueueMigrationDefaults {
  const assignedTo = typeof session.assignedTo === 'string' && session.assignedTo.trim() ? session.assignedTo : null;
  return {
    queueStatus: deriveQueueStatus({ ...session, assignedTo }),
    priority: 'Normal',
    assignedTo,
    assignedBy: typeof session.assignedBy === 'string' && session.assignedBy.trim() ? session.assignedBy : null,
    assignedAt: session.assignedAt ?? null,
    queuePosition: null,
    queueSchemaVersion: 1,
  };
}

export interface AssignmentSnapshot {
  assignedTo: string | null;
  version: number;
  editingBy?: string | null;
  expiresAtMs?: number | null;
  siteId: string;
}

export function canTakeAssignment(snapshot: AssignmentSnapshot, actorUid: string): boolean {
  return !snapshot.assignedTo || snapshot.assignedTo === actorUid;
}

export function isStaleAssignment(expectedVersion: number, currentVersion: number): boolean {
  return expectedVersion !== currentVersion;
}

export function canOverrideLock(snapshot: AssignmentSnapshot, actorUid: string, administrativeOverride: boolean, now = Date.now()): boolean {
  return administrativeOverride || !snapshot.editingBy || snapshot.editingBy === actorUid || (snapshot.expiresAtMs ?? 0) <= now;
}

export function isSameSite(resourceSiteId: string, actorSiteId: string): boolean {
  return Boolean(resourceSiteId) && resourceSiteId === actorSiteId;
}

export function uniqueClientEventIds(eventIds: string[]): string[] {
  return [...new Set(eventIds)];
}
