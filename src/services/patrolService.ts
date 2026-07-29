import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { PatrolLogRecord, PatrolPointRecord } from '../types';
import { sanitizeAndValidateFirestoreData } from './firestoreData';

export type SitePatrolPointRecord = PatrolPointRecord & { site_id: string };
export type SitePatrolLogRecord = PatrolLogRecord & { site_id: string };
export type CreatePatrolPointInput = Omit<SitePatrolPointRecord, 'site_id' | 'created_at' | 'updated_at'>;
export type CreatePatrolLogInput = Omit<SitePatrolLogRecord, 'site_id' | 'created_at'>;

const site = (value: string) => {
  const result = value.trim();
  if (!result) throw new Error('siteId is required.');
  return result;
};
const time = (value: unknown) => value && typeof value === 'object' && 'toDate' in value
  ? (value as { toDate: () => Date }).toDate().toISOString() : String(value || '');
const point = (id: string, data: Record<string, unknown>): SitePatrolPointRecord => ({
  ...data,
  patrol_point_id: String(data.patrol_point_id || id),
  site_id: String(data.site_id || ''),
  created_at: time(data.created_at),
  updated_at: time(data.updated_at),
} as SitePatrolPointRecord);
const log = (id: string, data: Record<string, unknown>): SitePatrolLogRecord => ({
  ...data,
  patrol_log_id: String(data.patrol_log_id || id),
  site_id: String(data.site_id || ''),
  created_at: time(data.created_at),
} as SitePatrolLogRecord);

export async function listPatrolPoints(siteId: string): Promise<SitePatrolPointRecord[]> {
  const snapshot = await getDocs(query(collection(db, 'patrolPoints'), where('site_id', '==', site(siteId))));
  return snapshot.docs.map(item => point(item.id, item.data()));
}

export async function listActivePatrolPoints(siteId: string): Promise<SitePatrolPointRecord[]> {
  return (await listPatrolPoints(siteId)).filter(item => item.status === 'Active');
}

export async function createPatrolPoint(siteId: string, input: CreatePatrolPointInput): Promise<void> {
  if (!input.patrol_point_id.trim()) throw new Error('patrol_point_id is required.');
  await setDoc(doc(db, 'patrolPoints', input.patrol_point_id), sanitizeAndValidateFirestoreData({
    ...input,
    site_id: site(siteId),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }));
}

export async function updatePatrolPoint(
  siteId: string,
  patrolPointId: string,
  updates: Partial<Omit<SitePatrolPointRecord, 'patrol_point_id' | 'site_id' | 'created_at'>>,
): Promise<void> {
  const scopedSite = site(siteId);
  const reference = doc(db, 'patrolPoints', patrolPointId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Patrol point not found.');
    if (snapshot.get('site_id') !== scopedSite) throw new Error('Patrol point belongs to another site.');
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...updates,
      updated_at: serverTimestamp(),
    }));
  });
}

export function setPatrolPointStatus(
  siteId: string,
  patrolPointId: string,
  status: PatrolPointRecord['status'],
): Promise<void> {
  return updatePatrolPoint(siteId, patrolPointId, { status });
}

export async function listPatrolLogs(siteId: string): Promise<SitePatrolLogRecord[]> {
  const snapshot = await getDocs(query(collection(db, 'patrolLogs'), where('site_id', '==', site(siteId))));
  return snapshot.docs.map(item => log(item.id, item.data()))
    .sort((left, right) => right.checkin_time.localeCompare(left.checkin_time));
}

export async function createPatrolLog(siteId: string, input: CreatePatrolLogInput): Promise<void> {
  if (!input.patrol_log_id.trim()) throw new Error('patrol_log_id is required.');
  await setDoc(doc(db, 'patrolLogs', input.patrol_log_id), sanitizeAndValidateFirestoreData({
    ...input,
    site_id: site(siteId),
    created_at: serverTimestamp(),
  }));
}
