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
import type { ContractorLogRecord } from '../types';
import { sanitizeAndValidateFirestoreData } from './firestoreData';

export type SiteContractorRecord = ContractorLogRecord & { site_id: string };
export type CreateContractorInput = Omit<SiteContractorRecord, 'site_id' | 'created_at' | 'updated_at'>;
export type ContractorUpdate = Partial<Omit<SiteContractorRecord, 'contractor_log_id' | 'site_id' | 'created_at'>>;

const requireSiteId = (siteId: string) => {
  const value = siteId.trim();
  if (!value) throw new Error('siteId is required.');
  return value;
};

const timestampText = (value: unknown) =>
  value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : String(value || '');

const contractorFromData = (id: string, data: Record<string, unknown>): SiteContractorRecord => ({
  ...data,
  contractor_log_id: String(data.contractor_log_id || id),
  site_id: String(data.site_id || ''),
  created_at: timestampText(data.created_at),
  updated_at: timestampText(data.updated_at),
} as SiteContractorRecord);

export async function listContractors(siteId: string): Promise<SiteContractorRecord[]> {
  const snapshot = await getDocs(query(
    collection(db, 'contractorLogs'),
    where('site_id', '==', requireSiteId(siteId)),
  ));
  return snapshot.docs
    .map(item => contractorFromData(item.id, item.data()))
    .sort((left, right) => right.entry_time.localeCompare(left.entry_time));
}

export async function listActiveContractors(siteId: string): Promise<SiteContractorRecord[]> {
  const snapshot = await getDocs(query(
    collection(db, 'contractorLogs'),
    where('site_id', '==', requireSiteId(siteId)),
    where('status', '==', 'กำลังปฏิบัติงาน'),
  ));
  return snapshot.docs.map(item => contractorFromData(item.id, item.data()));
}

export async function createContractor(siteId: string, input: CreateContractorInput): Promise<void> {
  const scopedSiteId = requireSiteId(siteId);
  if (!input.contractor_log_id.trim()) throw new Error('contractor_log_id is required.');
  await setDoc(doc(db, 'contractorLogs', input.contractor_log_id), sanitizeAndValidateFirestoreData({
    ...input,
    site_id: scopedSiteId,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }));
}

export async function updateContractor(
  siteId: string,
  contractorId: string,
  updates: ContractorUpdate,
): Promise<void> {
  const scopedSiteId = requireSiteId(siteId);
  const reference = doc(db, 'contractorLogs', contractorId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Contractor log not found.');
    if (snapshot.get('site_id') !== scopedSiteId) throw new Error('Contractor log belongs to another site.');
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...updates,
      updated_at: serverTimestamp(),
    }));
  });
}

export function completeContractor(
  siteId: string,
  contractorId: string,
  exitTime: string,
): Promise<void> {
  return updateContractor(siteId, contractorId, {
    exit_time: exitTime,
    status: 'ออกแล้ว',
  });
}
