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
import type { BlacklistRecord } from '../types';
import { sanitizeAndValidateFirestoreData } from './firestoreData';

export type SiteBlacklistRecord = BlacklistRecord & { site_id: string };
export type CreateBlacklistInput = Omit<SiteBlacklistRecord, 'site_id' | 'created_at' | 'updated_at'>;

const site = (value: string) => {
  const result = value.trim();
  if (!result) throw new Error('siteId is required.');
  return result;
};
const time = (value: unknown) => value && typeof value === 'object' && 'toDate' in value
  ? (value as { toDate: () => Date }).toDate().toISOString() : String(value || '');
const record = (id: string, data: Record<string, unknown>): SiteBlacklistRecord => ({
  ...data,
  blacklist_id: String(data.blacklist_id || id),
  site_id: String(data.site_id || ''),
  created_at: time(data.created_at),
  updated_at: time(data.updated_at),
} as SiteBlacklistRecord);

export async function listBlacklist(siteId: string): Promise<SiteBlacklistRecord[]> {
  const snapshot = await getDocs(query(collection(db, 'blacklist'), where('site_id', '==', site(siteId))));
  return snapshot.docs.map(item => record(item.id, item.data()));
}

export async function listActiveBlacklist(siteId: string): Promise<SiteBlacklistRecord[]> {
  const snapshot = await getDocs(query(
    collection(db, 'blacklist'),
    where('site_id', '==', site(siteId)),
    where('status', '==', 'Active'),
  ));
  return snapshot.docs.map(item => record(item.id, item.data()));
}

export async function createBlacklistEntry(siteId: string, input: CreateBlacklistInput): Promise<void> {
  if (!input.blacklist_id.trim()) throw new Error('blacklist_id is required.');
  await setDoc(doc(db, 'blacklist', input.blacklist_id), sanitizeAndValidateFirestoreData({
    ...input,
    site_id: site(siteId),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }));
}

export async function updateBlacklistEntry(
  siteId: string,
  blacklistId: string,
  updates: Partial<Omit<SiteBlacklistRecord, 'blacklist_id' | 'site_id' | 'created_at'>>,
): Promise<void> {
  const scopedSite = site(siteId);
  const reference = doc(db, 'blacklist', blacklistId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Blacklist entry not found.');
    if (snapshot.get('site_id') !== scopedSite) throw new Error('Blacklist entry belongs to another site.');
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...updates,
      updated_at: serverTimestamp(),
    }));
  });
}

export function setBlacklistStatus(
  siteId: string,
  blacklistId: string,
  status: BlacklistRecord['status'],
): Promise<void> {
  return updateBlacklistEntry(siteId, blacklistId, { status });
}

export async function deleteBlacklistEntry(siteId: string, blacklistId: string): Promise<void> {
  const scopedSite = site(siteId);
  const reference = doc(db, 'blacklist', blacklistId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) return;
    if (snapshot.get('site_id') !== scopedSite) throw new Error('Blacklist entry belongs to another site.');
    transaction.delete(reference);
  });
}
