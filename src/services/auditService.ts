import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { AuditLogRecord } from '../types';
import { sanitizeAndValidateFirestoreData } from './firestoreData';

export interface SiteAuditLogRecord extends AuditLogRecord {
  site_id: string;
  operator_id: string;
  account_uid: string;
  card_number?: string;
  vehicle_log_id?: string;
  previous_state?: string;
  new_state?: string;
  reason?: string;
  timestamp?: string;
}

export type CreateAuditLogInput = Omit<SiteAuditLogRecord, 'site_id' | 'operator_id' | 'account_uid' | 'created_at'>;

const site = (value: string) => {
  const result = value.trim();
  if (!result) throw new Error('siteId is required.');
  return result;
};
const time = (value: unknown) => value && typeof value === 'object' && 'toDate' in value
  ? (value as { toDate: () => Date }).toDate().toISOString() : String(value || '');
const audit = (id: string, data: Record<string, unknown>): SiteAuditLogRecord => ({
  ...data,
  audit_id: String(data.audit_id || id),
  site_id: String(data.site_id || ''),
  operator_id: String(data.operator_id || ''),
  account_uid: String(data.account_uid || ''),
  created_at: time(data.created_at),
  timestamp: data.timestamp ? time(data.timestamp) : undefined,
} as SiteAuditLogRecord);

export async function listAuditLogs(siteId: string): Promise<SiteAuditLogRecord[]> {
  const snapshot = await getDocs(query(collection(db, 'auditLogs'), where('site_id', '==', site(siteId))));
  return snapshot.docs.map(item => audit(item.id, item.data()))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function listAuditLogsForRecord(
  siteId: string,
  moduleName: string,
  recordId: string,
): Promise<SiteAuditLogRecord[]> {
  const snapshot = await getDocs(query(
    collection(db, 'auditLogs'),
    where('site_id', '==', site(siteId)),
    where('module_name', '==', moduleName),
    where('record_id', '==', recordId),
  ));
  return snapshot.docs.map(item => audit(item.id, item.data()));
}

export async function createAuditLog(siteId: string, input: CreateAuditLogInput): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated account is required for audit logging.');
  if (!input.audit_id.trim()) throw new Error('audit_id is required.');
  await setDoc(doc(db, 'auditLogs', input.audit_id), sanitizeAndValidateFirestoreData({
    ...input,
    site_id: site(siteId),
    operator_id: uid,
    account_uid: uid,
    created_at: serverTimestamp(),
  }));
}

export async function writeAuditLog(
  userName: string,
  action: string,
  moduleName: string,
  recordId: string,
  oldValue = '',
  newValue = '',
  loginEmail = '',
  operatorName = '',
  actionResult = 'Success',
  ipOrSessionId = '',
): Promise<void> {
  const finalOperator = operatorName || sessionStorage.getItem('selected_operator_name') || userName || '';
  await createAuditLog(sessionStorage.getItem('selected_site_id') || 'site-01', {
    audit_id: `AUD_${crypto.randomUUID()}`,
    user_name: userName || finalOperator || 'Unknown',
    action,
    module_name: moduleName,
    record_id: recordId,
    old_value: String(oldValue),
    new_value: String(newValue),
    login_email: loginEmail || sessionStorage.getItem('selected_login_email') || auth.currentUser?.email || '',
    operator_name: finalOperator,
    action_result: actionResult,
    ip_or_session_id: ipOrSessionId || sessionStorage.getItem('selected_session_id') || 'local-session',
  });
}
