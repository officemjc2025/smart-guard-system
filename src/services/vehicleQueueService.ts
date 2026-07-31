import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { VehicleQueuePriority, VehicleSessionRecord } from '../types';

const priorityRank: Record<VehicleQueuePriority, number> = {
  Emergency: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

function textTime(value: unknown): string {
  return value instanceof Timestamp ? value.toDate().toISOString() :
    typeof value === 'string' ? value : '';
}

function queueRecord(snapshot: QueryDocumentSnapshot<DocumentData>): VehicleSessionRecord {
  const data = snapshot.data();
  return {
    session_id: String(data.session_id ?? snapshot.id),
    site_id: String(data.site_id ?? ''),
    parking_card_id: String(data.parking_card_id ?? ''),
    card_number: String(data.card_number ?? ''),
    stage: data.stage ?? 'Created',
    status: data.status ?? 'Pending',
    opened_by: String(data.opened_by ?? ''),
    opened_by_name: String(data.opened_by_name ?? ''),
    current_owner: String(data.current_owner ?? ''),
    last_updated_by: String(data.last_updated_by ?? ''),
    assigned_to: String(data.assigned_to ?? ''),
    queueStatus: data.queueStatus ?? 'Waiting',
    priority: data.priority ?? 'Normal',
    assignedTo: data.assignedTo == null ? null : String(data.assignedTo),
    assignedBy: data.assignedBy == null ? null : String(data.assignedBy),
    assignedAt: textTime(data.assignedAt) || undefined,
    queuePosition: data.queuePosition == null ? null : Number(data.queuePosition),
    sessionVersion: typeof data.sessionVersion === 'number' ? data.sessionVersion : 0,
    assignmentVersion: typeof data.assignmentVersion === 'number' ? data.assignmentVersion : 0,
    queueMetrics: data.queueMetrics as VehicleSessionRecord['queueMetrics'],
    last_activity_at: textTime(data.last_activity_at),
    vehicle_plate: data.vehicle_plate ? String(data.vehicle_plate) : undefined,
    visitor_name: data.visitor_name ? String(data.visitor_name) : undefined,
    target_room: data.target_room ? String(data.target_room) : undefined,
    activity: [],
    created_at: textTime(data.created_at),
    updated_at: textTime(data.updated_at),
  };
}

export function sortOperationalQueue(sessions: VehicleSessionRecord[]): VehicleSessionRecord[] {
  return [...sessions].sort((left, right) =>
    priorityRank[left.priority] - priorityRank[right.priority]
    || (left.queuePosition ?? new Date(left.created_at).getTime()) - (right.queuePosition ?? new Date(right.created_at).getTime())
    || new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
}

export function subscribeOperationalQueue(
  siteId: string,
  callback: (sessions: VehicleSessionRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, 'vehicleSessions'),
      where('site_id', '==', siteId),
      where('queueStatus', 'in', ['Waiting', 'Assigned', 'In Progress', 'Waiting Information', 'Ready']),
      orderBy('queuePosition', 'asc'),
      limit(100),
    ),
    snapshot => callback(sortOperationalQueue(
      snapshot.docs.map(queueRecord).filter(session => session.status !== 'InProgress'),
    )),
    reason => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      console.error('[OperationalAnalytics][vehicleSessions.operationalQueue]', {
        code: 'code' in error ? String(error.code) : undefined,
        message: error.message,
      });
      onError?.(error);
    },
  );
}

export function subscribeCompletedToday(
  siteId: string,
  callback: (sessions: VehicleSessionRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return onSnapshot(
    query(
      collection(db, 'vehicleSessions'),
      where('site_id', '==', siteId),
      where('queueStatus', '==', 'Completed'),
      where('updated_at', '>=', Timestamp.fromDate(start)),
      orderBy('updated_at', 'desc'),
      limit(100),
    ),
    snapshot => callback(snapshot.docs.map(queueRecord)),
    reason => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      console.error('[OperationalAnalytics][vehicleSessions.completedToday]', {
        code: 'code' in error ? String(error.code) : undefined,
        message: error.message,
      });
      onError?.(error);
    },
  );
}
