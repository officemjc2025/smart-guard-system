import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../firebase';
import type { PatrolLogRecord, PatrolPointRecord } from '../types';
import { sanitizeAndValidateFirestoreData } from './firestoreData';
import { currentOperationalShift } from './operationalShift';

export type SitePatrolPointRecord = PatrolPointRecord & { site_id: string };
export type SitePatrolLogRecord = PatrolLogRecord & { site_id: string };
export type CreatePatrolPointInput = Omit<SitePatrolPointRecord, 'site_id' | 'created_at' | 'updated_at'>;
export type CreatePatrolLogInput = Omit<SitePatrolLogRecord, 'site_id' | 'created_at' | 'updated_at' | 'checkin_time'>;

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

export async function completePatrolCheckin(
  siteId: string,
  input: CreatePatrolLogInput,
): Promise<SitePatrolLogRecord> {
  const scopedSite = site(siteId);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated account is required for Patrol check-in.');
  if (!input.patrol_log_id.trim()) throw new Error('patrol_log_id is required.');
  if (!input.patrol_point_name?.trim() && !input.custom_location?.trim()) {
    throw new Error('กรุณาเลือกจุดตรวจหรือระบุสถานที่');
  }
  if (!['normal', 'abnormal'].includes(input.area_status || '')) {
    throw new Error('กรุณาระบุสถานะพื้นที่');
  }
  if (input.area_status === 'abnormal' && !input.abnormal_reason?.trim()) {
    throw new Error('กรุณาระบุรายละเอียดหรือเหตุผลของความผิดปกติ');
  }
  if (!input.evidence_photo_1_url || !input.evidence_photo_1_file_id) {
    throw new Error('กรุณาถ่ายรูปหลักฐานจุดตรวจอย่างน้อย 1 รูป');
  }
  const hasPhoto2 = Boolean(input.evidence_photo_2_url || input.evidence_photo_2_file_id);
  if (hasPhoto2 && (!input.evidence_photo_2_url || !input.evidence_photo_2_file_id)) {
    throw new Error('ข้อมูลรูปหลักฐานที่ 2 ไม่สมบูรณ์');
  }
  if (input.evidence_photo_2_url && input.evidence_photo_1_url === input.evidence_photo_2_url) {
    throw new Error('รูปหลักฐานทั้งสองต้องเป็นคนละไฟล์');
  }
  const reference = doc(db, 'patrolLogs', input.patrol_log_id);
  const auditReference = doc(db, 'auditLogs', `PATROL_CHECKIN_${input.patrol_log_id}`);
  const shift = currentOperationalShift();
  await runTransaction(db, async transaction => {
    if ((await transaction.get(reference)).exists()) throw new Error('Patrol check-in already exists.');
    transaction.set(reference, sanitizeAndValidateFirestoreData({
      ...input,
      shift_id: shift.shiftId,
      operational_date: shift.operationalDate,
      site_id: scopedSite,
      recorded_by_uid: uid,
      checkin_time: serverTimestamp(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    }));
    transaction.set(auditReference, {
      audit_id: auditReference.id,
      operator_id: uid,
      account_uid: uid,
      user_name: input.guard_name,
      operator_name: input.guard_name,
      site_id: scopedSite,
      action: 'PatrolCheckin',
      module_name: 'PatrolLogs',
      record_id: input.patrol_log_id,
      old_value: '',
      new_value: input.area_status,
      action_result: 'Success',
      created_at: serverTimestamp(),
    });
  });
  const completed = await getDoc(reference);
  if (!completed.exists()) throw new Error('Completed Patrol check-in could not be reloaded.');
  return log(completed.id, completed.data());
}
