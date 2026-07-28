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
import type { KeyLogRecord } from '../types';
import { sanitizeAndValidateFirestoreData } from './firestoreData';

export interface KeyRecord {
  key_id: string;
  site_id: string;
  room_number: string;
  key_type: string;
  key_label: string;
  status: string;
  current_borrower_name?: string;
  current_checkout_log_id?: string;
  note?: string;
  created_at: string;
  updated_at: string;
}
export type SiteKeyLogRecord = KeyLogRecord & { site_id: string };
export type CreateKeyInput = Omit<KeyRecord, 'site_id' | 'created_at' | 'updated_at'>;
export type CheckoutKeyInput = Omit<SiteKeyLogRecord, 'site_id' | 'created_at' | 'updated_at'>;
export type KeyLogUpdate = Partial<Omit<SiteKeyLogRecord, 'key_log_id' | 'site_id' | 'created_at'>>;

const site = (value: string) => {
  const result = value.trim();
  if (!result) throw new Error('siteId is required.');
  return result;
};
const time = (value: unknown) => value && typeof value === 'object' && 'toDate' in value
  ? (value as { toDate: () => Date }).toDate().toISOString() : String(value || '');
const keyLog = (id: string, data: Record<string, unknown>): SiteKeyLogRecord => ({
  ...data,
  key_log_id: String(data.key_log_id || id),
  site_id: String(data.site_id || ''),
  created_at: time(data.created_at),
  updated_at: time(data.updated_at),
} as SiteKeyLogRecord);
const keyRecord = (id: string, data: Record<string, unknown>): KeyRecord => ({
  ...data,
  key_id: String(data.key_id || id),
  site_id: String(data.site_id || ''),
  created_at: time(data.created_at),
  updated_at: time(data.updated_at),
} as KeyRecord);

export async function listKeyLogs(siteId: string): Promise<SiteKeyLogRecord[]> {
  const snapshot = await getDocs(query(collection(db, 'keyLogs'), where('site_id', '==', site(siteId))));
  return snapshot.docs.map(item => keyLog(item.id, item.data()))
    .sort((left, right) => right.checkout_time.localeCompare(left.checkout_time));
}

export async function listCheckedOutKeys(siteId: string): Promise<SiteKeyLogRecord[]> {
  const snapshot = await getDocs(query(
    collection(db, 'keyLogs'),
    where('site_id', '==', site(siteId)),
    where('status', '==', 'ถูกเบิก'),
  ));
  return snapshot.docs.map(item => keyLog(item.id, item.data()));
}

export async function checkoutKey(siteId: string, input: CheckoutKeyInput): Promise<void> {
  if (!input.key_log_id.trim()) throw new Error('key_log_id is required.');
  await setDoc(doc(db, 'keyLogs', input.key_log_id), sanitizeAndValidateFirestoreData({
    ...input,
    site_id: site(siteId),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }));
}

export async function updateKeyLog(siteId: string, keyLogId: string, updates: KeyLogUpdate): Promise<void> {
  const scopedSite = site(siteId);
  const reference = doc(db, 'keyLogs', keyLogId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Key log not found.');
    if (snapshot.get('site_id') !== scopedSite) throw new Error('Key log belongs to another site.');
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...updates,
      updated_at: serverTimestamp(),
    }));
  });
}

export function returnKey(
  siteId: string,
  keyLogId: string,
  returnedBy: string,
  returnTime: string,
): Promise<void> {
  return updateKeyLog(siteId, keyLogId, {
    return_time: returnTime,
    returned_by: returnedBy,
    status: 'คืนแล้ว',
  });
}

export async function listKeys(siteId: string): Promise<KeyRecord[]> {
  const snapshot = await getDocs(query(collection(db, 'keys'), where('site_id', '==', site(siteId))));
  return snapshot.docs.map(item => keyRecord(item.id, item.data()));
}

export async function createKey(siteId: string, input: CreateKeyInput): Promise<void> {
  if (!input.key_id.trim()) throw new Error('key_id is required.');
  await setDoc(doc(db, 'keys', input.key_id), sanitizeAndValidateFirestoreData({
    ...input,
    site_id: site(siteId),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }));
}

export async function updateKey(
  siteId: string,
  keyId: string,
  updates: Partial<Omit<KeyRecord, 'key_id' | 'site_id' | 'created_at'>>,
): Promise<void> {
  const scopedSite = site(siteId);
  const reference = doc(db, 'keys', keyId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Key not found.');
    if (snapshot.get('site_id') !== scopedSite) throw new Error('Key belongs to another site.');
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...updates,
      updated_at: serverTimestamp(),
    }));
  });
}

export function setKeyStatus(siteId: string, keyId: string, status: string): Promise<void> {
  return updateKey(siteId, keyId, { status });
}
