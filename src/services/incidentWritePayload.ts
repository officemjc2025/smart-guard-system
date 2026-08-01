import { sanitizeAndValidateFirestoreData, type FirestoreWriteData } from './firestoreData';

export interface IncidentWritePayloadInput {
  incident: FirestoreWriteData;
  incidentDateTime: unknown;
  incidentId: string;
  siteId: string;
  uid: string;
  auditId: string;
  serverTimestampValue: unknown;
}

export function buildIncidentWritePayload(input: IncidentWritePayloadInput) {
  const incident = sanitizeAndValidateFirestoreData({
    ...input.incident,
    incident_datetime: input.incidentDateTime,
    site_id: input.siteId,
    recorded_by_uid: input.uid,
    incident_status: 'reported',
    alert_status: 'active',
    reported_at: input.serverTimestampValue,
    created_at: input.serverTimestampValue,
    updated_at: input.serverTimestampValue,
  });
  const reportedBy = String(input.incident.reported_by || '');
  const audit = {
    audit_id: input.auditId,
    operator_id: input.uid,
    account_uid: input.uid,
    user_name: reportedBy,
    operator_name: reportedBy,
    site_id: input.siteId,
    action: 'IncidentReported',
    module_name: 'IncidentReports',
    record_id: input.incidentId,
    old_value: '',
    new_value: String(input.incident.status || ''),
    action_result: 'Success',
    created_at: input.serverTimestampValue,
  };
  return { incident, audit };
}

const valueType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object' && '_methodName' in value) return 'server-timestamp';
  if (value && typeof value === 'object' && 'toDate' in value) return 'timestamp';
  return typeof value;
};

export function safeIncidentWriteDiagnostics(payload: ReturnType<typeof buildIncidentWritePayload>) {
  const describe = (data: FirestoreWriteData) => Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, valueType(value)]),
  );
  return {
    stage: 'incident-audit-transaction',
    incidentFields: describe(payload.incident),
    auditFields: describe(payload.audit),
  };
}
