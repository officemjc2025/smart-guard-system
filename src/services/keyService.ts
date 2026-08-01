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
import { auth, db } from '../firebase';
import type { KeyLogRecord } from '../types';
import { sanitizeAndValidateFirestoreData } from './firestoreData';
import { normalizeOptionalIdentityNumber } from './keyIdentityPolicy';
import { toEpochMillis } from '../utils/dateTime';
import {
  type UploadedKeyReturnEvidence,
  validateUploadedKeyReturnEvidence,
} from './keyReturnPolicy';

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
export type CheckoutKeyInput = Omit<SiteKeyLogRecord,
  'site_id' | 'created_at' | 'updated_at' | 'checkout_time' | 'return_time'
  | 'returned_by' | 'return_photo_url' | 'return_signature_url'>;
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
  checkout_time: time(data.checkout_time),
  return_time: data.return_time ? time(data.return_time) : undefined,
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
    .sort((left, right) => toEpochMillis(right.checkout_time) - toEpochMillis(left.checkout_time));
}

export async function listCheckedOutKeys(siteId: string): Promise<SiteKeyLogRecord[]> {
  const snapshot = await getDocs(query(
    collection(db, 'keyLogs'),
    where('site_id', '==', site(siteId)),
    where('status', '==', 'ถูกเบิก'),
  ));
  return snapshot.docs.map(item => keyLog(item.id, item.data()));
}

export class KeyWorkflowError extends Error {
  constructor(
    message: string,
    readonly code: 'duplicate-checkout' | 'already-returned' | 'not-found' | 'site-mismatch',
  ) {
    super(message);
    this.name = 'KeyWorkflowError';
  }
}

async function assertReturnAvailable(
  scopedSite: string,
  keyLogId: string,
): Promise<void> {
  const snapshot = await getDoc(doc(db, 'keyLogs', keyLogId));
  if (!snapshot.exists()) throw new KeyWorkflowError('ไม่พบรายการกุญแจ', 'not-found');
  if (snapshot.get('site_id') !== scopedSite) {
    throw new KeyWorkflowError('รายการกุญแจอยู่คนละพื้นที่', 'site-mismatch');
  }
  if (snapshot.get('status') !== 'ถูกเบิก' || snapshot.get('return_time')) {
    throw new KeyWorkflowError('กุญแจรายการนี้ถูกคืนแล้ว', 'already-returned');
  }
}

export async function prepareKeyReturn(siteId: string, keyLogId: string): Promise<void> {
  await assertReturnAvailable(site(siteId), keyLogId);
}

const currentUid = () => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated account is required for Key operations.');
  return uid;
};

const keyAudit = (
  auditId: string,
  uid: string,
  siteId: string,
  actorName: string,
  recordId: string,
  action: 'KeyCheckout' | 'KeyReturn',
  oldValue: string,
  newValue: string,
) => ({
  audit_id: auditId,
  operator_id: uid,
  account_uid: uid,
  user_name: actorName,
  operator_name: actorName,
  site_id: siteId,
  action,
  module_name: 'KeyLogs',
  record_id: recordId,
  old_value: oldValue,
  new_value: newValue,
  action_result: 'Success',
  created_at: serverTimestamp(),
});

export async function checkoutKey(siteId: string, input: CheckoutKeyInput): Promise<SiteKeyLogRecord> {
  if (!input.key_log_id.trim()) throw new Error('key_log_id is required.');
  const scopedSite = site(siteId);
  const uid = currentUid();
  const reference = doc(db, 'keyLogs', input.key_log_id);
  const auditReference = doc(db, 'auditLogs', `KEY_CHECKOUT_${input.key_log_id}`);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists()) {
      throw new KeyWorkflowError('กุญแจรายการนี้ถูกเบิกแล้ว', 'duplicate-checkout');
    }
    transaction.set(reference, sanitizeAndValidateFirestoreData({
      ...input,
      borrower_id_number: normalizeOptionalIdentityNumber(input.borrower_id_number),
      site_id: scopedSite,
      checkout_time: serverTimestamp(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    }));
    transaction.set(auditReference, keyAudit(
      auditReference.id, uid, scopedSite, input.issued_by,
      input.key_log_id, 'KeyCheckout', '', 'ถูกเบิก',
    ));
  });
  const completed = await getDoc(reference);
  if (!completed.exists()) throw new Error('Completed Key checkout could not be reloaded.');
  return keyLog(completed.id, completed.data());
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

export function completeKeyReturn(
  siteId: string,
  keyLogId: string,
  returnedBy: string,
  evidence: UploadedKeyReturnEvidence,
): Promise<SiteKeyLogRecord> {
  const scopedSite = site(siteId);
  const uid = currentUid();
  const { returnPhotoReference, returnSignatureReference } =
    validateUploadedKeyReturnEvidence(evidence, { recordId: keyLogId, siteId: scopedSite });
  const reference = doc(db, 'keyLogs', keyLogId);
  const auditReference = doc(db, 'auditLogs', `KEY_RETURN_${keyLogId}`);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new KeyWorkflowError('ไม่พบรายการกุญแจ', 'not-found');
    if (snapshot.get('site_id') !== scopedSite) {
      throw new KeyWorkflowError('รายการกุญแจอยู่คนละพื้นที่', 'site-mismatch');
    }
    if (snapshot.get('status') !== 'ถูกเบิก' || snapshot.get('return_time')) {
      throw new KeyWorkflowError('กุญแจรายการนี้ถูกคืนแล้ว', 'already-returned');
    }
    transaction.update(reference, {
      return_time: serverTimestamp(),
      returned_by: returnedBy,
      return_photo_url: returnPhotoReference,
      return_signature_url: returnSignatureReference,
      status: 'คืนแล้ว',
      updated_at: serverTimestamp(),
    });
    transaction.set(auditReference, keyAudit(
      auditReference.id, uid, scopedSite, returnedBy,
      keyLogId, 'KeyReturn', 'ถูกเบิก', 'คืนแล้ว',
    ));
    return snapshot;
  }).then(async () => {
    const completed = await getDoc(reference);
    if (!completed.exists()) throw new Error('Completed Key return could not be reloaded.');
    return keyLog(completed.id, completed.data());
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
