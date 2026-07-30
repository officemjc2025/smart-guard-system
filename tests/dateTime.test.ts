import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatThaiDate,
  formatThaiDateTime,
  formatThaiTime,
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
