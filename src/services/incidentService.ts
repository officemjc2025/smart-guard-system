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
import type { IncidentReportRecord } from '../types';
import { sanitizeAndValidateFirestoreData } from './firestoreData';

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

export async function updateIncident(siteId: string, incidentId: string, updates: IncidentUpdate): Promise<void> {
  const scopedSite = site(siteId);
  const reference = doc(db, 'incidentReports', incidentId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Incident report not found.');
    if (snapshot.get('site_id') !== scopedSite) throw new Error('Incident report belongs to another site.');
    transaction.update(reference, sanitizeAndValidateFirestoreData({
      ...updates,
      updated_at: serverTimestamp(),
    }));
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
