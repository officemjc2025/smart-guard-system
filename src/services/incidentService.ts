import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { IncidentReportRecord } from '../types';
import { sanitizeAndValidateFirestoreData } from './firestoreData';
import { buildIncidentWritePayload, safeIncidentWriteDiagnostics } from './incidentWritePayload';

export type SiteIncidentRecord = IncidentReportRecord & {
  site_id: string;
  resolved_at?: string;
  assigned_to?: string;
  severity?: string;
};
export type CreateIncidentInput = Omit<SiteIncidentRecord, 'site_id' | 'created_at' | 'updated_at'>;
export type IncidentUpdate = Partial<Omit<SiteIncidentRecord, 'incident_id' | 'site_id' | 'created_at'>>;

const site = (value: string) => {
  const result = value.trim();
  if (!result) throw new Error('siteId is required.');
  return result;
};
const time = (value: unknown) => value && typeof value === 'object' && 'toDate' in value
  ? (value as { toDate: () => Date }).toDate().toISOString() : String(value || '');
const incident = (id: string, data: Record<string, unknown>): SiteIncidentRecord => ({
  ...data,
  incident_id: String(data.incident_id || id),
  site_id: String(data.site_id || ''),
  created_at: time(data.created_at),
  updated_at: time(data.updated_at),
  resolved_at: data.resolved_at ? time(data.resolved_at) : undefined,
  acknowledged_at: data.acknowledged_at ? time(data.acknowledged_at) : undefined,
  action_started_at: data.action_started_at ? time(data.action_started_at) : undefined,
  closed_at: data.closed_at ? time(data.closed_at) : undefined,
} as SiteIncidentRecord);

export async function listIncidents(siteId: string): Promise<SiteIncidentRecord[]> {
  const snapshot = await getDocs(query(collection(db, 'incidentReports'), where('site_id', '==', site(siteId))));
  return snapshot.docs.map(item => incident(item.id, item.data()))
    .sort((left, right) => right.incident_datetime.localeCompare(left.incident_datetime));
}

export async function listOpenIncidents(siteId: string): Promise<SiteIncidentRecord[]> {
  return (await listIncidents(siteId)).filter(item => item.status !== 'ปิดงานแล้ว');
}

export async function createIncident(siteId: string, input: CreateIncidentInput): Promise<void> {
  if (!input.incident_id.trim()) throw new Error('incident_id is required.');
  await setDoc(doc(db, 'incidentReports', input.incident_id), sanitizeAndValidateFirestoreData({
    ...input,
    site_id: site(siteId),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }));
}

export async function createIncidentReport(
  siteId: string,
  input: CreateIncidentInput,
): Promise<SiteIncidentRecord> {
  const scopedSite = site(siteId);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated account is required for Incident reporting.');
  if (!input.incident_id.trim()) throw new Error('incident_id is required.');
  if (!input.incident_datetime) throw new Error('กรุณาระบุวันและเวลาที่เกิดเหตุ');
  if (!input.incident_type) throw new Error('กรุณาระบุประเภทเหตุการณ์');
  if (!input.location.trim()) throw new Error('กรุณาระบุสถานที่เกิดเหตุ');
  if (!input.description.trim()) throw new Error('กรุณาระบุรายละเอียดเหตุการณ์');
  if (!input.reported_by.trim()) throw new Error('กรุณาระบุผู้บันทึก');
  if (!input.photo_url) throw new Error('กรุณาแนบรูปหลักฐานเหตุการณ์');
  const reference = doc(db, 'incidentReports', input.incident_id);
  const auditReference = doc(db, 'auditLogs', `INCIDENT_REPORTED_${input.incident_id}`);
  const payload = buildIncidentWritePayload({
    incident: input,
    incidentDateTime: Timestamp.fromDate(new Date(input.incident_datetime)),
    incidentId: input.incident_id,
    siteId: scopedSite,
    uid,
    auditId: auditReference.id,
    serverTimestampValue: serverTimestamp(),
  });
  try {
    await runTransaction(db, async transaction => {
      if ((await transaction.get(reference)).exists()) throw new Error('Incident report already exists.');
      transaction.set(reference, payload.incident);
      transaction.set(auditReference, payload.audit);
    });
  } catch (error) {
    console.error('[Incident Firestore Write Failed]', {
      ...safeIncidentWriteDiagnostics(payload),
      code: typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code) : 'unknown',
    });
    throw error;
  }
  const completed = await getDoc(reference);
  if (!completed.exists()) throw new Error('Completed Incident report could not be reloaded.');
  return incident(completed.id, completed.data());
}

export async function updateIncident(siteId: string, incidentId: string, updates: IncidentUpdate): Promise<void> {
  const scopedSite = site(siteId);
  const reference = doc(db, 'incidentReports', incidentId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Incident report not found.');
    if (snapshot.get('site_id') !== scopedSite) throw new Error('Incident report belongs to another site.');
    const closing = updates.status === 'ปิดงานแล้ว' && snapshot.get('status') !== 'ปิดงานแล้ว';
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...updates,
      ...(closing ? { resolved_at: serverTimestamp() } : {}),
      updated_at: serverTimestamp(),
    }));
  });
}

export type IncidentAction = 'acknowledge' | 'start' | 'resolve' | 'close';

export async function transitionIncident(
  siteId: string,
  incidentId: string,
  action: IncidentAction,
  operatorName: string,
  resolutionSummary = '',
): Promise<void> {
  const scopedSite = site(siteId);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated account is required.');
  const reference = doc(db, 'incidentReports', incidentId);
  const auditReference = doc(db, 'auditLogs', `INCIDENT_${action.toUpperCase()}_${incidentId}`);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Incident report not found.');
    if (snapshot.get('site_id') !== scopedSite) throw new Error('Incident belongs to another site.');
    const current = String(snapshot.get('incident_status') || (
      snapshot.get('status') === 'ปิดงานแล้ว' ? 'resolved'
        : snapshot.get('status') === 'กำลังดำเนินการ' ? 'in_progress' : 'reported'
    ));
    const allowed: Record<IncidentAction, string[]> = {
      acknowledge: ['reported'],
      start: ['acknowledged'],
      resolve: ['in_progress'],
      close: ['resolved'],
    };
    if (!allowed[action].includes(current)) throw new Error(`Invalid Incident transition: ${current} -> ${action}`);
    if ((action === 'resolve' || action === 'close') && !resolutionSummary.trim()) {
      throw new Error('กรุณาระบุสรุปการแก้ไขเหตุการณ์');
    }
    const next = action === 'acknowledge' ? 'acknowledged'
      : action === 'start' ? 'in_progress'
        : action === 'resolve' ? 'resolved' : 'closed';
    const updates = action === 'acknowledge' ? {
      incident_status: next, alert_status: 'acknowledged',
      acknowledged_at: serverTimestamp(), acknowledged_by: uid,
    } : action === 'start' ? {
      incident_status: next, status: 'กำลังดำเนินการ', alert_status: 'acknowledged',
      action_started_at: serverTimestamp(), action_started_by: uid,
    } : action === 'resolve' ? {
      incident_status: next, status: 'ปิดงานแล้ว', alert_status: 'cleared',
      resolved_at: serverTimestamp(), resolved_by: uid, resolution_summary: resolutionSummary.trim(),
    } : {
      incident_status: next, status: 'ปิดงานแล้ว', alert_status: 'cleared',
      closed_at: serverTimestamp(), closed_by: uid, resolution_summary: resolutionSummary.trim(),
    };
    transaction.update(reference, { ...updates, updated_at: serverTimestamp() });
    transaction.set(auditReference, {
      audit_id: auditReference.id, operator_id: uid, account_uid: uid,
      user_name: operatorName, operator_name: operatorName, site_id: scopedSite,
      action: `Incident:${action}`, module_name: 'IncidentReports', record_id: incidentId,
      old_value: current, new_value: next, action_result: 'Success',
      created_at: serverTimestamp(),
    });
  });
}

export function closeIncident(
  siteId: string,
  incidentId: string,
  managementNote: string,
  resolvedAt: string,
): Promise<void> {
  return updateIncident(siteId, incidentId, {
    status: 'ปิดงานแล้ว',
    management_note: managementNote,
    resolved_at: resolvedAt,
  });
}
