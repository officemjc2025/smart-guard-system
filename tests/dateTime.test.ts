import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatThaiDate,
  formatThaiDateTime,
  formatThaiTime,
  toEpochMillis,
} from '../src/utils/dateTime';

test('shared date/time formatting uses Bangkok time and Thai Buddhist display', () => {
  const value = '2026-07-30T16:57:00.000Z';
  assert.equal(formatThaiDate(value), '30/ก.ค./2569');
  assert.equal(formatThaiTime(value), '23:57 น.');
  assert.equal(formatThaiDateTime(value), '30/ก.ค./2569 23:57 น.');
});

test('shared date/time formatting supports Firestore Timestamp, Date, ISO, number and invalid input', () => {
  const date = new Date('2026-07-30T16:57:00.000Z');
  assert.equal(formatThaiTime({ toDate: () => date }), '23:57 น.');
  assert.equal(formatThaiTime(date), '23:57 น.');
  assert.equal(formatThaiTime(date.toISOString()), '23:57 น.');
  assert.equal(formatThaiTime(date.getTime()), '23:57 น.');
  assert.equal(formatThaiDate(null), '—');
  assert.equal(formatThaiDateTime('invalid'), '—');
});

test('toEpochMillis normalizes Firestore Timestamp, Date, ISO, finite number and invalid values', () => {
  const date = new Date('2026-07-30T16:57:00.000Z');
  const epoch = date.getTime();
  assert.equal(toEpochMillis({ toDate: () => date }), epoch);
  assert.equal(toEpochMillis(date), epoch);
  assert.equal(toEpochMillis(date.toISOString()), epoch);
  assert.equal(toEpochMillis(epoch), epoch);
  assert.equal(toEpochMillis(Number.POSITIVE_INFINITY), 0);
  assert.equal(toEpochMillis('invalid'), 0);
  assert.equal(toEpochMillis(null), 0);
});

test('Incident timestamps sort newest-first across mixed Firestore and legacy values', () => {
  const rows = [
    { id: 'invalid', incident_datetime: null },
    { id: 'iso', incident_datetime: '2026-07-30T16:57:00.000Z' },
    { id: 'timestamp', incident_datetime: { toDate: () => new Date('2026-08-01T00:00:00.000Z') } },
    { id: 'date', incident_datetime: new Date('2026-07-31T00:00:00.000Z') },
    { id: 'number', incident_datetime: new Date('2026-07-29T00:00:00.000Z').getTime() },
  ];
  rows.sort((left, right) =>
    toEpochMillis(right.incident_datetime) - toEpochMillis(left.incident_datetime));
  assert.deepEqual(rows.map(row => row.id), ['timestamp', 'date', 'iso', 'number', 'invalid']);
});
