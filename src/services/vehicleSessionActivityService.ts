import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { VehicleSessionActivity, VehicleSessionStage, VehicleSessionStatus } from '../types';
import { sanitizeAndValidateFirestoreData, type FirestoreWriteData } from './firestoreData';
import { toEpochMillis } from '../utils/dateTime';

export interface SessionActivityInput {
  sessionId: string;
  siteId: string;
  action: string;
  fromStage?: VehicleSessionStage;
  toStage?: VehicleSessionStage;
  fromStatus?: VehicleSessionStatus;
  toStatus?: VehicleSessionStatus;
  actorName: string;
  actorRole: string;
  details?: Record<string, string>;
  clientEventId: string;
  vehicleLogId?: string;
  activityType?: VehicleActivityType;
  title?: string;
  description?: string;
  location?: string;
  severity?: VehicleActivitySeverity;
  activityStatus?: VehicleActivityStatus;
  photoUrls?: string[];
}

export type VehicleActivityType =
  | 'ParkingIssue' | 'WrongParking' | 'Obstruction' | 'Accident' | 'Damage'
  | 'Evidence' | 'Remark' | 'Warning' | 'Violation' | 'ContactResident'
  | 'ContactVehicleOwner' | 'VehicleMoved' | 'FollowUp' | 'Custom';
export type VehicleActivitySeverity = 'Low' | 'Normal' | 'High' | 'Critical';
export type VehicleActivityStatus = 'Open' | 'Monitoring' | 'Resolved' | 'Recorded';

export interface SessionActivityRecord {
  activity_id: string;
  session_id: string;
  action: string;
  from_stage: string;
  to_stage: string;
  from_status: string;
  to_status: string;
  actor_uid: string;
  actor_operator_id: string;
  actor_name: string;
  actor_role: string;
  site_id: string;
  details: Record<string, string>;
  created_at: unknown;
  client_event_id: string;
  schema_version: 1;
  vehicle_session_id?: string;
  vehicle_log_id?: string;
  activity_type?: VehicleActivityType;
  title?: string;
  description?: string;
  location?: string;
  severity?: VehicleActivitySeverity;
  status?: VehicleActivityStatus;
  photo_urls?: string[];
  updated_at?: unknown;
}

const safeEventId = (value: string) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error('client_event_id ไม่ถูกต้อง');
  }
  return normalized;
};

export function buildSessionActivityWrite(
  firestore: Firestore,
  input: SessionActivityInput,
  actorUid = auth.currentUser?.uid || '',
) {
  if (!actorUid) throw new Error('ต้องเข้าสู่ระบบก่อนบันทึก Activity');
  const eventId = safeEventId(input.clientEventId);
  const reference = doc(firestore, 'vehicleSessions', input.sessionId, 'activities', eventId);
  const data = sanitizeAndValidateFirestoreData({
    activity_id: eventId,
    session_id: input.sessionId,
    action: input.action.trim(),
    from_stage: input.fromStage || '',
    to_stage: input.toStage || '',
    from_status: input.fromStatus || '',
    to_status: input.toStatus || '',
    actor_uid: actorUid,
    actor_operator_id: actorUid,
    // Firestore Rules compare this canonical profile value with exact equality.
    // Validate whitespace separately, but never normalize the value written.
    actor_name: input.actorName,
    actor_role: input.actorRole,
    site_id: input.siteId,
    details: input.details || {},
    created_at: serverTimestamp(),
    client_event_id: eventId,
    schema_version: 1,
    ...(input.activityType ? {
      vehicle_session_id: input.sessionId,
      vehicle_log_id: input.vehicleLogId || '',
      activity_type: input.activityType,
      title: input.title?.trim() || input.activityType,
      description: input.description?.trim() || '',
      location: input.location?.trim() || '',
      severity: input.severity || 'Normal',
      status: input.activityStatus || 'Recorded',
      photo_urls: input.photoUrls || [],
      updated_at: serverTimestamp(),
    } : {}),
  });
  return { reference, data };
}

export async function appendSessionActivity(input: SessionActivityInput): Promise<void> {
  const write = buildSessionActivityWrite(db, input);
  try {
    await setDoc(write.reference, write.data, { merge: false });
  } catch (reason) {
    const existing = await getDoc(write.reference);
    if (existing.exists() &&
        existing.get('client_event_id') === input.clientEventId &&
        existing.get('actor_uid') === auth.currentUser?.uid) {
      return;
    }
    throw reason;
  }
}

export function appendSessionActivityInTransaction(
  transaction: Transaction,
  input: SessionActivityInput,
  actorUid?: string,
): void {
  const write = buildSessionActivityWrite(db, input, actorUid);
  transaction.set(write.reference, write.data);
}

function activityFromDocument(snapshot: QueryDocumentSnapshot<DocumentData>): SessionActivityRecord {
  return snapshot.data() as SessionActivityRecord;
}

export interface ActivityPage {
  activities: SessionActivityRecord[];
  cursor: DocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export async function listSessionActivities(
  sessionId: string,
  pageSize = 25,
  cursor?: DocumentSnapshot<DocumentData> | null,
): Promise<ActivityPage> {
  const constraints = [orderBy('created_at', 'desc'), limit(pageSize + 1)];
  const activityQuery = cursor
    ? query(collection(db, 'vehicleSessions', sessionId, 'activities'), orderBy('created_at', 'desc'), startAfter(cursor), limit(pageSize + 1))
    : query(collection(db, 'vehicleSessions', sessionId, 'activities'), ...constraints);
  const snapshot = await getDocs(activityQuery);
  const visible = snapshot.docs.slice(0, pageSize);
  return {
    activities: visible.map(activityFromDocument),
    cursor: visible.at(-1) ?? null,
    hasMore: snapshot.docs.length > pageSize,
  };
}

export function subscribeRecentSessionActivities(
  sessionId: string,
  callback: (activities: SessionActivityRecord[]) => void,
  recentLimit = 20,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'vehicleSessions', sessionId, 'activities'), orderBy('created_at', 'desc'), limit(recentLimit)),
    snapshot => callback(snapshot.docs.map(activityFromDocument)),
  );
}

export function mergeLegacyAndSubcollectionActivities(
  legacy: VehicleSessionActivity[],
  current: SessionActivityRecord[],
): Array<VehicleSessionActivity & { clientEventId?: string }> {
  const merged = new Map<string, VehicleSessionActivity & { clientEventId?: string }>();
  legacy.forEach((item, index) => merged.set(`legacy:${item.at}:${item.action}:${index}`, item));
  current.forEach(item => merged.set(item.client_event_id, {
    action: item.action,
    stage: (item.to_stage || item.from_stage || 'Created') as VehicleSessionStage,
    by: item.actor_uid,
    byName: item.actor_name,
    at: item.created_at instanceof Object && 'toDate' in item.created_at
      ? (item.created_at as { toDate(): Date }).toDate().toISOString()
      : String(item.created_at || ''),
    clientEventId: item.client_event_id,
  }));
  return [...merged.values()].sort((left, right) => toEpochMillis(left.at) - toEpochMillis(right.at));
}
