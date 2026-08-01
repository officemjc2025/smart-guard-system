import assert from 'node:assert/strict';
import test from 'node:test';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { buildIncidentWritePayload, safeIncidentWriteDiagnostics } from '../src/services/incidentWritePayload';

const serverTimestampValue = serverTimestamp();

test('Incident payload builder matches runtime sanitizer behavior without transforming sentinels', () => {
  const payload = buildIncidentWritePayload({
    incident: {
      incident_id: 'INC_test', incident_datetime: 'client ISO replaced below',
      location: 'Lobby', location_type: 'common_area', location_name_snapshot: 'Lobby',
      target_unit_id: undefined, reporter_name: undefined, shift_leader: '',
      incident_type: 'อุปกรณ์ชำรุด', description: 'Description',
      photo_url: 'https://drive.google.com/file/d/FILE123456789/view',
      photo_file_id: 'FILE123456789', reported_by: 'Operator', priority: 'Normal',
      status: 'แจ้งแล้ว', outcome: 'อยู่ระหว่างดำเนินการ',
    },
    incidentDateTime: Timestamp.fromDate(new Date(0)),
    incidentId: 'INC_test', siteId: 'site-01', uid: 'uid-test',
    auditId: 'INCIDENT_REPORTED_INC_test', serverTimestampValue,
  });
  assert.equal('target_unit_id' in payload.incident, false);
  assert.equal('reporter_name' in payload.incident, false);
  assert.equal(payload.incident.shift_leader, '');
  assert.equal(payload.incident.reported_at, serverTimestampValue);
  assert.equal(payload.incident.created_at, serverTimestampValue);
  assert.equal(payload.incident.updated_at, serverTimestampValue);
  assert.equal(payload.audit.created_at, serverTimestampValue);
  assert.equal(payload.audit.new_value, 'แจ้งแล้ว');
});

test('Incident diagnostics expose only field names and value types', () => {
  const payload = buildIncidentWritePayload({
    incident: {
      incident_id: 'INC_test', reported_by: 'Private Name', status: 'แจ้งแล้ว',
      photo_url: 'https://drive.google.com/file/d/PRIVATEFILE123/view',
    },
    incidentDateTime: Timestamp.fromDate(new Date(0)),
    incidentId: 'INC_test', siteId: 'site-01', uid: 'private-uid',
    auditId: 'INCIDENT_REPORTED_INC_test', serverTimestampValue,
  });
  const serialized = JSON.stringify(safeIncidentWriteDiagnostics(payload));
  assert.doesNotMatch(serialized, /Private Name|PRIVATEFILE123|private-uid/);
  assert.match(serialized, /incidentFields/);
  assert.match(serialized, /server-timestamp/);
});

test('sanitizer deliberately preserves unexpected defined fields for rules to reject', () => {
  const payload = buildIncidentWritePayload({
    incident: { incident_id: 'INC_test', reported_by: 'Operator', status: 'แจ้งแล้ว', role: 'Admin' },
    incidentDateTime: Timestamp.fromDate(new Date(0)),
    incidentId: 'INC_test', siteId: 'site-01', uid: 'uid-test',
    auditId: 'INCIDENT_REPORTED_INC_test', serverTimestampValue,
  });
  assert.equal(payload.incident.role, 'Admin');
});
