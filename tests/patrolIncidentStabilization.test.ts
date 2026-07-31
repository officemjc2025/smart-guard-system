import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validatePatrolCheckinDraft } from '../src/services/patrolPolicy';

const photo = (name: string) => new File(['image'], name, { type: 'image/jpeg' });
const validDraft = () => ({
  patrolPointId: 'PP_1',
  patrolPointName: 'ห้องเครื่อง',
  customLocation: '',
  areaStatus: 'normal' as const,
  abnormalReason: '',
  photo1: photo('one.jpg'),
  photo2: photo('two.jpg'),
});

test('Patrol requires a master point or custom location', () => {
  assert.throws(() => validatePatrolCheckinDraft({
    ...validDraft(), patrolPointId: '', patrolPointName: '', customLocation: '',
  }), /เลือกจุดตรวจ/);
  assert.doesNotThrow(() => validatePatrolCheckinDraft({
    ...validDraft(), patrolPointId: '', patrolPointName: '', customLocation: 'สวนด้านหลัง',
  }));
});

test('Patrol abnormal status requires a reason while normal may omit it', () => {
  assert.doesNotThrow(() => validatePatrolCheckinDraft(validDraft()));
  assert.throws(() => validatePatrolCheckinDraft({
    ...validDraft(), areaStatus: 'abnormal', abnormalReason: '',
  }), /เหตุผล/);
  assert.doesNotThrow(() => validatePatrolCheckinDraft({
    ...validDraft(), areaStatus: 'abnormal', abnormalReason: 'พบประตูชำรุด',
  }));
});

test('Patrol requires photo 1 while photo 2 is optional and distinct when present', () => {
  assert.throws(() => validatePatrolCheckinDraft({ ...validDraft(), photo1: null }), /อย่างน้อย 1 รูป/);
  assert.doesNotThrow(() => validatePatrolCheckinDraft({ ...validDraft(), photo2: null }));
  const same = photo('same.jpg');
  assert.throws(() => validatePatrolCheckinDraft({
    ...validDraft(), photo1: same, photo2: same,
  }), /คนละไฟล์/);
});

test('Patrol upload order, retry references, server transaction, and authenticated history are wired', async () => {
  const component = await readFile(new URL('../src/components/PatrolLogs.tsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/services/patrolService.ts', import.meta.url), 'utf8');
  assert.ok(component.indexOf("mediaType: 'patrol_photo_1'") < component.indexOf("mediaType: 'patrol_photo_2'"));
  assert.ok(component.indexOf("mediaType: 'patrol_photo_2'") < component.indexOf('completePatrolCheckin('));
  assert.match(component, /if \(!photo1Reference\)/);
  assert.match(component, /if \(draft\.photo2 && !photo2Reference\)/);
  assert.match(component, /const photo2Fields = photo2Reference/);
  assert.match(component, /submitFlight\.current/);
  assert.match(component, /setReferences\(current => \(\{ \.\.\.current, \[slot\]: '' \}\)\)/);
  assert.match(component, /AuthenticatedEvidenceImage/);
  assert.doesNotMatch(component, /QRScanner|showQRScanner/);
  assert.match(service, /checkin_time: serverTimestamp\(\)/);
  assert.match(service, /transaction\.set\(auditReference/);
});

test('Patrol and Incident history tolerate optional evidence and Firestore timestamps', async () => {
  const patrol = await readFile(new URL('../src/components/PatrolLogs.tsx', import.meta.url), 'utf8');
  const history = await readFile(new URL('../src/components/SearchHistory.tsx', import.meta.url), 'utf8');
  const dateTime = await readFile(new URL('../src/utils/dateTime.ts', import.meta.url), 'utf8');
  assert.match(patrol, /ไม่มีหลักฐาน/);
  assert.match(history, /formatBangkokDateKey\(dateVal\)/);
  assert.doesNotMatch(history, /dateVal\\.split/);
  assert.match(history, /setLoadError/);
  assert.match(history, /โหลดข้อมูลรายงานไม่สำเร็จ/);
  assert.match(dateTime, /formatBangkokDateKey/);
});

test('report area has a retryable route-level error boundary', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const boundary = await readFile(new URL('../src/components/ReportErrorBoundary.tsx', import.meta.url), 'utf8');
  assert.match(app, /<ReportErrorBoundary>/);
  assert.match(boundary, /ไม่สามารถเปิดหน้ารายงานได้ กรุณาลองใหม่/);
  assert.match(boundary, /this\.setState\(\{ error: null \}\)/);
  assert.match(boundary, /import\.meta\.env\.DEV/);
});

test('visible Patrol stamp declares device time while canonical time remains server-owned', async () => {
  const stamp = await readFile(new URL('../src/utils/evidenceStamp.ts', import.meta.url), 'utf8');
  assert.match(stamp, /จุดตรวจ:/);
  assert.match(stamp, /เวลาถ่ายจากอุปกรณ์:/);
  assert.match(stamp, /toDataURL\('image\/jpeg'/);
});

test('Incident uses active site, exact media identity, structured event time, atomic create, and private viewer', async () => {
  const component = await readFile(new URL('../src/components/IncidentReports.tsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/services/incidentService.ts', import.meta.url), 'utf8');
  assert.match(component, /mediaType: 'incident_photo'/);
  assert.match(component, /recordId, siteId/);
  assert.doesNotMatch(component, /siteId: 'smart-guard'/);
  assert.match(component, /type="datetime-local"/);
  assert.match(component, /location_type/);
  assert.match(component, /AuthenticatedEvidenceImage/);
  assert.match(component, /submitFlight\.current/);
  assert.ok(component.indexOf('uploadImageToDrive(') < component.indexOf('createIncidentReport('));
  assert.match(service, /incident_datetime: Timestamp\.fromDate/);
  assert.match(service, /reported_at: serverTimestamp\(\)/);
  assert.match(service, /transaction\.set\(auditReference/);
  assert.match(service, /resolved_at: serverTimestamp\(\)/);
});
