import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bangkokDayRange,
  calculateDashboardSummary,
  dashboardDate,
} from '../src/services/dashboardLogic';

const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });
const empty = () => ({
  vehicles: [], contractors: [], keys: [], patrols: [],
  patrolPoints: [], incidents: [], cards: [],
});
const now = new Date('2026-07-31T12:00:00+07:00');

test('Bangkok day range and date adapter support Timestamp, Date, and ISO', () => {
  const range = bangkokDayRange(now);
  assert.equal(range.start.toISOString(), '2026-07-30T17:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-07-31T17:00:00.000Z');
  assert.equal(dashboardDate(timestamp('2026-07-31T01:00:00Z'))?.toISOString(), '2026-07-31T01:00:00.000Z');
  assert.equal(dashboardDate(new Date('2026-07-31T01:00:00Z'))?.toISOString(), '2026-07-31T01:00:00.000Z');
  assert.equal(dashboardDate('invalid'), null);
});

test('Vehicle metrics use entry/exit business timestamps and active semantics', () => {
  const input = empty();
  input.vehicles = [
    { entry_time: timestamp('2026-07-30T17:00:00Z'), status: 'กำลังจอด', workflow_status: 'active' },
    { entry_time: '2026-07-30T16:59:59Z', exit_time: '2026-07-31T03:00:00Z', status: 'ออกแล้ว' },
    { entry_time: '2026-07-31T02:00:00Z', exit_time: '2026-07-31T04:00:00Z', status: 'กำลังจอด' },
  ];
  const result = calculateDashboardSummary(input, now);
  assert.equal(result.vehiclesIn, 2);
  assert.equal(result.vehiclesOut, 2);
  assert.equal(result.vehiclesCurrent, 1);
});

test('VIP today uses explicit identity and exact legacy compatibility marker', () => {
  const input = empty();
  input.vehicles = [
    { entry_time: '2026-07-31T02:00:00Z', access_type: 'VIP' },
    { entry_time: '2026-07-31T03:00:00Z', note: 'note • VIP entry event' },
    { entry_time: '2026-07-31T04:00:00Z', note: 'VIP visitor text only' },
  ];
  assert.equal(calculateDashboardSummary(input, now).vipEntriesToday, 2);
});

test('Contractor and key active counts include cross-day work but exclude completed records', () => {
  const input = empty();
  input.contractors = [
    { entry_time: '2026-07-29T01:00:00Z', status: 'in_building' },
    { status: 'กำลังปฏิบัติงาน', exit_time: '2026-07-31T02:00:00Z' },
    { status: 'active', workflow_status: 'completed' },
  ];
  input.keys = [
    { checkout_time: '2026-07-29T01:00:00Z', status: 'checked_out' },
    { status: 'ถูกเบิก', return_time: '2026-07-31T02:00:00Z' },
  ];
  const result = calculateDashboardSummary(input, now);
  assert.equal(result.contractorsCurrent, 1);
  assert.equal(result.keysCheckedOut, 1);
});

test('Patrol completion uses unique active master points and ignores custom locations', () => {
  const input = empty();
  input.patrolPoints = [
    { patrol_point_id: 'A', status: 'Active' },
    { patrol_point_id: 'B', status: 'Active' },
    { patrol_point_id: 'C', status: 'Inactive' },
  ];
  input.patrols = [
    { patrol_point_id: 'A', checkin_time: timestamp('2026-07-31T01:00:00Z') },
    { patrol_point_id: 'A', checkin_time: '2026-07-31T02:00:00Z', evidence_photo_1_url: 'one' },
    { patrol_point_id: '', custom_location: 'Garden', checkin_time: '2026-07-31T03:00:00Z' },
    { patrol_point_id: 'C', checkin_time: '2026-07-31T04:00:00Z' },
  ];
  const result = calculateDashboardSummary(input, now);
  assert.equal(result.patrolDone, 1);
  assert.equal(result.patrolTotal, 2);
  assert.equal(result.patrolPending, 1);
});

test('Patrol Dashboard resets at 07:00 and 19:00 while carry-over operational counts remain', () => {
  const input = empty();
  input.patrolPoints = [{ patrol_point_id: 'A', status: 'Active' }];
  input.patrols = [{ patrol_point_id: 'A', checkin_time: '2026-07-31T18:59:00+07:00' }];
  input.vehicles = [{ entry_time: '2026-07-31T08:00:00+07:00', status: 'กำลังจอด' }];
  input.contractors = [{ entry_time: '2026-07-31T08:00:00+07:00', status: 'active' }];
  input.keys = [{ checkout_time: '2026-07-31T08:00:00+07:00', status: 'ถูกเบิก' }];
  const afterRollover = calculateDashboardSummary(input, new Date('2026-07-31T19:01:00+07:00'));
  assert.equal(afterRollover.patrolDone, 0);
  assert.equal(afterRollover.vehiclesCurrent, 1);
  assert.equal(afterRollover.contractorsCurrent, 1);
  assert.equal(afterRollover.keysCheckedOut, 1);
});

test('Parking card status aliases remain mutually exclusive', () => {
  const input = empty();
  input.cards = [
    { status: 'Available' }, { status: 'ว่าง' },
    { status: 'InUse' }, { status: 'Suspended' },
    { status: 'ระงับชั่วคราว' }, { status: 'Lost' },
  ];
  const result = calculateDashboardSummary(input, now);
  assert.equal(result.availableCards, 2);
  assert.equal(result.cardsInUse, 1);
  assert.equal(result.suspendedCards, 2);
  assert.equal(result.lostCards, 1);
});

test('Incident metrics use report time and canonical open/closed mapping', () => {
  const input = empty();
  input.incidents = [
    { incident_id: '1', incident_datetime: '2026-07-29T01:00:00Z', reported_at: timestamp('2026-07-31T01:00:00Z'), status: 'แจ้งแล้ว' },
    { incident_id: '2', reported_at: '2026-07-31T02:00:00Z', status: 'resolved' },
    { incident_id: '3', reported_at: '2026-07-29T02:00:00Z', status: 'กำลังดำเนินการ' },
  ];
  const result = calculateDashboardSummary(input, now);
  assert.equal(result.incidentsToday, 2);
  assert.equal(result.openIncidents, 2);
  assert.deepEqual(result.recentIncidents.map(item => item.incident_id), ['2', '1', '3']);
});

test('empty successful sources produce real zeros without crashing on legacy missing fields', () => {
  const input = empty();
  input.vehicles = [{ status: null, entry_time: null }];
  const result = calculateDashboardSummary(input, now);
  assert.equal(result.vehiclesIn, 0);
  assert.equal(result.patrolTotal, 0);
  assert.equal(result.availableCards, 0);
});

test('Dashboard service and component wire seven same-site listeners with loading and error states', async () => {
  const { readFile } = await import('node:fs/promises');
  const service = await readFile(new URL('../src/services/dashboardService.ts', import.meta.url), 'utf8');
  const component = await readFile(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(service, /where\('site_id', '==', siteId\)/);
  assert.match(service, /patrolPoints: 'patrolPoints'/);
  assert.match(service, /return \(\) => unsubscribes\.forEach/);
  assert.match(component, /subscribeDashboardSummary/);
  assert.match(component, /กำลังโหลดข้อมูล Dashboard/);
  assert.match(component, /ไม่สามารถโหลดข้อมูลได้/);
  assert.doesNotMatch(component, /patrolPending: 4/);
  assert.match(component, /data\.patrolDone}\/{data\.patrolTotal/);
});
