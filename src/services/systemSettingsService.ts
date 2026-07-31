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
import { sanitizeAndValidateFirestoreData } from './firestoreData';

export interface SystemSettingRecord {
  setting_key: string;
  site_id: string;
  setting_value: string;
  setting_type: string;
  description: string;
  updated_by: string;
  created_at?: string;
  updated_at: string;
}

export type CreateSystemSettingInput = Omit<SystemSettingRecord, 'site_id' | 'created_at' | 'updated_at'>;
export type SystemSettingUpdate = Pick<SystemSettingRecord, 'setting_value' | 'updated_by'> &
  Partial<Pick<SystemSettingRecord, 'setting_type' | 'description'>>;

const site = (value: string) => {
  const result = value.trim();
  if (!result) throw new Error('siteId is required.');
  return result;
};
const time = (value: unknown) => value && typeof value === 'object' && 'toDate' in value
  ? (value as { toDate: () => Date }).toDate().toISOString() : String(value || '');
const setting = (id: string, data: Record<string, unknown>): SystemSettingRecord => ({
  ...data,
  setting_key: String(data.setting_key || id),
  site_id: String(data.site_id || ''),
  created_at: data.created_at ? time(data.created_at) : undefined,
  updated_at: time(data.updated_at),
} as SystemSettingRecord);

export async function listSystemSettings(siteId: string): Promise<SystemSettingRecord[]> {
  const snapshot = await getDocs(query(collection(db, 'systemSettings'), where('site_id', '==', site(siteId))));
  return snapshot.docs
    .filter(item => item.id !== 'authBootstrap')
    .map(item => setting(item.id, item.data()));
}

export async function createSystemSetting(siteId: string, input: CreateSystemSettingInput): Promise<void> {
  if (!input.setting_key.trim()) throw new Error('setting_key is required.');
  await setDoc(doc(db, 'systemSettings', input.setting_key), sanitizeAndValidateFirestoreData({
    ...input,
    site_id: site(siteId),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }));
}

export async function updateSystemSetting(
  siteId: string,
  settingKey: string,
  updates: SystemSettingUpdate,
): Promise<void> {
  const scopedSite = site(siteId);
  const reference = doc(db, 'systemSettings', settingKey);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('System setting not found.');
    if (snapshot.get('site_id') !== scopedSite) throw new Error('System setting belongs to another site.');
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...updates,
      updated_at: serverTimestamp(),
    }));
  });
}
