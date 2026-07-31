import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contractorLifecycle,
  incidentLifecycle,
  keyLifecycle,
  patrolLifecycle,
  vehicleLifecycle,
} from '../src/services/operationalLifecycle';
import { operationalShift } from '../src/services/operationalShift';

const at = (value: string) => new Date(value);

test('Bangkok shift boundaries map 06:59, 07:00, 18:59, 19:00 and after midnight correctly', () => {
  assert.equal(operationalShift(at('2026-07-31T06:59:00+07:00'))?.shiftId, '2026-07-30_NIGHT');
  assert.equal(operationalShift(at('2026-07-31T07:00:00+07:00'))?.shiftId, '2026-07-31_DAY');
  assert.equal(operationalShift(at('2026-07-31T18:59:00+07:00'))?.shiftId, '2026-07-31_DAY');
  assert.equal(operationalShift(at('2026-07-31T19:00:00+07:00'))?.shiftId, '2026-07-31_NIGHT');
  assert.equal(operationalShift(at('2026-08-01T00:30:00+07:00'))?.shiftId, '2026-07-31_NIGHT');
});

test('Patrol current/archive rolls over by shift without changing evidence', () => {
  const current = { checkin_time: '2026-07-31T08:00:00+07:00', workflow_status: 'completed', evidence_photo_1_url: 'private' };
  const previous = { checkin_time: '2026-07-30T20:00:00+07:00', workflow_status: 'completed', area_status: 'abnormal' };
  assert.equal(patrolLifecycle(current, at('2026-07-31T10:00:00+07:00')).current, true);
  assert.equal(patrolLifecycle(previous, at('2026-07-31T10:00:00+07:00')).archived, true);
  assert.equal(current.evidence_photo_1_url, 'private');
});

test('Contractor and Vehicle remain carry-over until an exit timestamp exists', () => {
  const now = at('2026-07-31T08:00:00+07:00');
  assert.equal(contractorLifecycle({ entry_time: '2026-07-30T20:00:00+07:00', status: 'active' }, now).carryOver, true);
  assert.equal(contractorLifecycle({ entry_time: '2026-07-30T20:00:00+07:00', status: 'ออกแล้ว' }, now).archived, false);
  assert.equal(contractorLifecycle({ entry_time: '2026-07-30T20:00:00+07:00', status: 'ออกแล้ว', exit_time: '2026-07-31T07:30:00+07:00', workflow_status: 'completed' }, now).archived, true);
  assert.equal(vehicleLifecycle({ entry_time: '2026-07-30T20:00:00+07:00', status: 'กำลังจอด' }, now).carryOver, true);
  assert.equal(vehicleLifecycle({ status: 'ออกแล้ว' }, now).archived, false);
});

test('Key requires return timestamp and both return evidence references before archive', () => {
  const incomplete = { checkout_time: '2026-07-30T20:00:00+07:00', status: 'คืนแล้ว', return_time: '2026-07-31T08:00:00+07:00' };
  assert.equal(keyLifecycle(incomplete).archived, false);
  assert.equal(keyLifecycle({ ...incomplete, return_photo_url: 'photo', return_signature_url: 'signature' }).archived, true);
});

test('Incident acknowledgement is distinct from resolution and survives shift rollover', () => {
  const now = at('2026-07-31T08:00:00+07:00');
  const reported = { reported_at: '2026-07-30T20:00:00+07:00', incident_status: 'reported' };
  const acknowledged = { ...reported, incident_status: 'acknowledged', acknowledged_at: '2026-07-31T08:01:00+07:00' };
  const active = incidentLifecycle(reported, now);
  assert.equal(active.current, true);
  assert.equal(active.carryOver, true);
  assert.equal(active.unacknowledged, true);
  assert.equal(incidentLifecycle(acknowledged, now).unacknowledged, false);
  assert.equal(incidentLifecycle(acknowledged, now).archived, false);
  assert.equal(incidentLifecycle({ ...acknowledged, incident_status: 'resolved' }, now).archived, true);
});

test('Archive/Search and Incident UI wire lifecycle filters, private viewer, and role-gated actions', async () => {
  const { readFile } = await import('node:fs/promises');
  const search = await readFile(new URL('../src/components/SearchHistory.tsx', import.meta.url), 'utf8');
  const incidents = await readFile(new URL('../src/components/IncidentReports.tsx', import.meta.url), 'utf8');
  assert.match(search, /lifecycleFilter/);
  assert.match(search, /shiftFilter/);
  assert.match(search, /AuthenticatedEvidenceImage/);
  assert.match(incidents, /\['Manager', 'Admin'\]\.includes\(userRole\)/);
  assert.match(incidents, /transitionIncident/);
});
