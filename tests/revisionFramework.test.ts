import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase/firestore';
import { buildRevision, buildRevisionDiff, INCIDENT_REVISION_FIELDS, normalizeCorrectionChanges, normalizeIncidentCorrectionChanges, PATROL_REVISION_FIELDS, revisionValuesEqual, validateEvidenceCorrectionPair } from '../src/services/revisionFramework';

test('revision diff records only changed allowed fields', () => {
  assert.deepEqual(buildRevisionDiff(
    { description: 'ก่อน', priority: 'Normal' },
    { description: 'หลัง', priority: 'Normal' },
    INCIDENT_REVISION_FIELDS,
  ), { changedFields: ['description'], before: { description: 'ก่อน' }, after: { description: 'หลัง' } });
});

test('revision diff rejects immutable and unknown fields', () => {
  assert.throws(() => buildRevisionDiff({}, { site_id: 'site-b' }, INCIDENT_REVISION_FIELDS), /Forbidden/);
  assert.throws(() => buildRevisionDiff({}, { recorded_by_uid: 'other' }, PATROL_REVISION_FIELDS), /Forbidden/);
});

test('revision requires a reason and at least one actual change', () => {
  const base = {
    revision_id: 'revision-1', revision_number: 1, record_id: 'incident-1',
    module_name: 'IncidentReports' as const, site_id: 'site-a', edited_by_uid: 'guard-a',
    edited_by_name: 'Guard A', edited_by_role: 'Guard' as const, edited_at: {}, audit_id: 'audit-1',
    current: { description: 'เดิม' }, changes: { description: 'ใหม่' }, allowedFields: INCIDENT_REVISION_FIELDS,
  };
  assert.throws(() => buildRevision({ ...base, reason: ' ' }), /เหตุผล/);
  assert.throws(() => buildRevision({ ...base, reason: 'แก้ไข', changes: { description: 'เดิม' } }), /ไม่มีข้อมูล/);
  assert.equal(buildRevision({ ...base, reason: 'ข้อมูลเดิมไม่ถูกต้อง' }).before.description, 'เดิม');
});

test('photo replacement preserves old and new evidence references in revision', () => {
  const revision = buildRevision({
    revision_id: 'revision-photo', revision_number: 2, record_id: 'patrol-1',
    module_name: 'PatrolLogs', site_id: 'site-a', reason: 'ภาพเดิมไม่ชัด',
    edited_by_uid: 'manager-a', edited_by_name: 'Manager A', edited_by_role: 'Manager',
    edited_at: {}, audit_id: 'audit-photo',
    current: { evidence_photo_1_url: 'https://drive.google.com/old', evidence_photo_1_file_id: 'OLD_FILE' },
    changes: { evidence_photo_1_url: 'https://drive.google.com/new', evidence_photo_1_file_id: 'NEW_FILE' },
    allowedFields: PATROL_REVISION_FIELDS,
  });
  assert.equal(revision.before.evidence_photo_1_file_id, 'OLD_FILE');
  assert.equal(revision.after.evidence_photo_1_file_id, 'NEW_FILE');
});

test('timestamp equality compares instants rather than object identity', () => {
  const first = Timestamp.fromMillis(1_000);
  const same = Timestamp.fromMillis(1_000);
  const later = Timestamp.fromMillis(2_000);
  assert.notEqual(first, same);
  assert.equal(revisionValuesEqual(first, same), true);
  assert.equal(revisionValuesEqual(first, later), false);
  assert.equal(revisionValuesEqual(new Date(1_000), same), true);
  assert.equal(revisionValuesEqual('same', 'same'), true);
  assert.equal(revisionValuesEqual('before', 'after'), false);
});

test('timestamp no-op produces no revision while a changed instant remains Firestore-supported', () => {
  const current = Timestamp.fromMillis(1_000);
  assert.deepEqual(buildRevisionDiff(
    { incident_datetime: current }, { incident_datetime: Timestamp.fromMillis(1_000) }, INCIDENT_REVISION_FIELDS,
  ).changedFields, []);
  const changed = buildRevisionDiff(
    { incident_datetime: current }, { incident_datetime: Timestamp.fromMillis(2_000) }, INCIDENT_REVISION_FIELDS,
  );
  assert.deepEqual(changed.changedFields, ['incident_datetime']);
  assert.ok(changed.before.incident_datetime instanceof Timestamp);
  assert.ok(changed.after.incident_datetime instanceof Timestamp);
});

test('correction normalization omits undefined, preserves empty string, and rejects null by default', () => {
  assert.deepEqual(normalizeCorrectionChanges({ remarks: '', description: undefined }), { remarks: '' });
  assert.throws(() => normalizeCorrectionChanges({ remarks: null }), /does not permit null/);
  const normalized = normalizeCorrectionChanges({ description: undefined });
  assert.throws(() => buildRevision({
    revision_id: 'revision-noop', revision_number: 1, record_id: 'incident-noop',
    module_name: 'IncidentReports', site_id: 'site-a', reason: 'ทดสอบ',
    edited_by_uid: 'guard-a', edited_by_name: 'Guard A', edited_by_role: 'Guard',
    edited_at: {}, audit_id: 'audit-noop', current: {}, changes: normalized,
    allowedFields: INCIDENT_REVISION_FIELDS,
  }), /ไม่มีข้อมูล/);
});

test('evidence correction requires a canonical matching URL and file ID pair', () => {
  const extract = (reference: string) => {
    const match = /file\/d\/([A-Za-z0-9_-]+)/.exec(reference);
    if (!match) throw new Error('invalid reference');
    return match[1];
  };
  assert.throws(() => validateEvidenceCorrectionPair({ photo_url: 'https://drive.google.com/file/d/FILE123456/view' }, 'photo_url', 'photo_file_id', extract), /together/);
  assert.throws(() => validateEvidenceCorrectionPair({ photo_file_id: 'FILE123456' }, 'photo_url', 'photo_file_id', extract), /together/);
  assert.throws(() => validateEvidenceCorrectionPair({ photo_url: '', photo_file_id: '' }, 'photo_url', 'photo_file_id', extract), /non-empty/);
  assert.throws(() => validateEvidenceCorrectionPair({ photo_url: 'https://drive.google.com/file/d/FILE123456/view', photo_file_id: 'OTHER' }, 'photo_url', 'photo_file_id', extract), /does not match/);
  assert.doesNotThrow(() => validateEvidenceCorrectionPair({ photo_url: 'https://drive.google.com/file/d/FILE123456/view', photo_file_id: 'FILE123456' }, 'photo_url', 'photo_file_id', extract));
});

test('Incident normalization rejects invalid dates before use and produces one shared Timestamp value', () => {
  assert.throws(() => normalizeIncidentCorrectionChanges(
    { incident_datetime: 'not-a-date' }, Timestamp.fromDate,
  ), /ไม่ถูกต้อง/);
  const normalized = normalizeIncidentCorrectionChanges(
    { incident_datetime: '2026-08-01T10:00:00.000Z', description: undefined, remarks: '' },
    Timestamp.fromDate,
  );
  assert.ok(normalized.incident_datetime instanceof Timestamp);
  assert.equal('description' in normalized, false);
  assert.equal(normalized.remarks, '');
  const revision = buildRevisionDiff(
    { incident_datetime: Timestamp.fromMillis(0), remarks: 'เดิม' }, normalized, INCIDENT_REVISION_FIELDS,
  );
  assert.equal(revision.after.incident_datetime, normalized.incident_datetime);
  assert.equal(revision.after.remarks, normalized.remarks);
});
