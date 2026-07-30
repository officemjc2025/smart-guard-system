import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../firebase';
import type {
  ContractorActivityRecord,
  ContractorActivityType,
  ContractorLogRecord,
} from '../types';
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
  entry_time: String(data.entry_time || ''),
  exit_time: data.exit_time ? String(data.exit_time) : undefined,
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

export async function updateContractorWorkspaceRecord(
  siteId: string,
  contractorId: string,
  updates: ContractorUpdate,
): Promise<void> {
  const scopedSiteId = requireSiteId(siteId);
  const uid = requireCurrentUid();
  const reference = doc(db, 'contractorLogs', contractorId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Contractor log not found.');
    if (snapshot.get('site_id') !== scopedSiteId) throw new Error('Contractor log belongs to another site.');
    if (snapshot.get('status') !== 'กำลังปฏิบัติงาน') throw new Error('Contractor record is already completed.');
    if (String(snapshot.get('workspace_lock_uid') || '') !== uid) {
      throw new Error('Contractor Workspace lock is required.');
    }
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...updates,
      updated_at: serverTimestamp(),
    }));
  });
}

const requireCurrentUid = () => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated account is required.');
  return uid;
};

export async function getContractor(
  siteId: string,
  contractorId: string,
): Promise<SiteContractorRecord> {
  const snapshot = await getDoc(doc(db, 'contractorLogs', contractorId));
  if (!snapshot.exists()) throw new Error('Contractor log not found.');
  if (snapshot.get('site_id') !== requireSiteId(siteId)) {
    throw new Error('Contractor log belongs to another site.');
  }
  return contractorFromData(snapshot.id, snapshot.data());
}

export async function acquireContractorWorkspace(
  siteId: string,
  contractorId: string,
  operatorName: string,
): Promise<SiteContractorRecord> {
  const scopedSiteId = requireSiteId(siteId);
  const uid = requireCurrentUid();
  const reference = doc(db, 'contractorLogs', contractorId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Contractor log not found.');
    if (snapshot.get('site_id') !== scopedSiteId) throw new Error('Contractor log belongs to another site.');
    const lockUid = String(snapshot.get('workspace_lock_uid') || '');
    const expiresAt = Date.parse(String(snapshot.get('workspace_lock_expires_at') || ''));
    if (lockUid && lockUid !== uid && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      throw new Error(`รายการนี้กำลังถูกใช้งานโดย ${String(snapshot.get('workspace_lock_name') || 'ผู้ใช้อื่น')}`);
    }
    transaction.update(reference, {
      workspace_lock_uid: uid,
      workspace_lock_name: operatorName,
      workspace_lock_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      updated_at: serverTimestamp(),
    });
  });
  return getContractor(scopedSiteId, contractorId);
}

export async function releaseContractorWorkspace(
  siteId: string,
  contractorId: string,
): Promise<void> {
  const scopedSiteId = requireSiteId(siteId);
  const uid = requireCurrentUid();
  const reference = doc(db, 'contractorLogs', contractorId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Contractor log not found.');
    if (snapshot.get('site_id') !== scopedSiteId) throw new Error('Contractor log belongs to another site.');
    const lockUid = String(snapshot.get('workspace_lock_uid') || '');
    if (lockUid && lockUid !== uid) throw new Error('Contractor Workspace belongs to another operator.');
    transaction.update(reference, {
      workspace_lock_uid: '',
      workspace_lock_name: '',
      workspace_lock_expires_at: '',
      updated_at: serverTimestamp(),
    });
  });
}

export async function appendContractorActivity(
  siteId: string,
  contractorId: string,
  activityType: ContractorActivityType,
  note: string,
  createdBy: string,
): Promise<ContractorActivityRecord> {
  const scopedSiteId = requireSiteId(siteId);
  const uid = requireCurrentUid();
  const reference = doc(db, 'contractorLogs', contractorId);
  const activity: ContractorActivityRecord = {
    activity_id: `CA_${crypto.randomUUID()}`,
    activity_type: activityType,
    note: note.trim(),
    created_at: new Date().toISOString(),
    created_by: createdBy,
    site_id: scopedSiteId,
    contractor_id: contractorId,
  };
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Contractor log not found.');
    if (snapshot.get('site_id') !== scopedSiteId) throw new Error('Contractor log belongs to another site.');
    if (snapshot.get('status') !== 'กำลังปฏิบัติงาน') throw new Error('Contractor record is already completed.');
    if (String(snapshot.get('workspace_lock_uid') || '') !== uid) {
      throw new Error('Contractor Workspace lock is required.');
    }
    const activities = Array.isArray(snapshot.get('activities')) ? snapshot.get('activities') : [];
    transaction.update(reference, {
      activities: [...activities, activity],
      updated_at: serverTimestamp(),
    });
  });
  return activity;
}

export function completeContractor(
  siteId: string,
  contractorId: string,
  exitTime: string,
  createdBy = '',
): Promise<void> {
  const scopedSiteId = requireSiteId(siteId);
  const uid = requireCurrentUid();
  const reference = doc(db, 'contractorLogs', contractorId);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Contractor log not found.');
    if (snapshot.get('site_id') !== scopedSiteId) throw new Error('Contractor log belongs to another site.');
    const lockUid = String(snapshot.get('workspace_lock_uid') || '');
    if (lockUid && lockUid !== uid) throw new Error('Contractor Workspace belongs to another operator.');
    const activities = Array.isArray(snapshot.get('activities')) ? snapshot.get('activities') : [];
    const exitActivity: ContractorActivityRecord = {
      activity_id: `CA_${crypto.randomUUID()}`,
      activity_type: 'exit',
      note: 'ออกจากพื้นที่',
      created_at: exitTime,
      created_by: createdBy,
      site_id: scopedSiteId,
      contractor_id: contractorId,
    };
    transaction.update(reference, {
      exit_time: exitTime,
      status: 'ออกแล้ว',
      activities: [...activities, exitActivity],
      workspace_lock_uid: '',
      workspace_lock_name: '',
      workspace_lock_expires_at: '',
      updated_at: serverTimestamp(),
    });
  });
}
