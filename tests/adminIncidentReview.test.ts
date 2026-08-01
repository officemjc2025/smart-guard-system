import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminPanel = readFileSync(new URL('../src/components/AdminPanel.tsx', import.meta.url), 'utf8');

test('Admin Incident review uses the canonical lifecycle service', () => {
  assert.match(adminPanel, /transitionIncident\(/);
  assert.doesNotMatch(adminPanel, /import \{ listIncidents, updateIncident \}/);
  assert.doesNotMatch(adminPanel, /await updateIncident\(/);
});

test('Admin Incident review cannot construct the pre-fix legacy payload or client lifecycle timestamp', () => {
  const handler = adminPanel.slice(
    adminPanel.indexOf('const handleUpdateIncident'),
    adminPanel.indexOf('// System Settings Update'),
  );
  assert.doesNotMatch(handler, /management_note|assigned_to|severity|resolved_at|new Date/);
  assert.match(handler, /incidentForm\.action/);
  assert.match(handler, /incidentForm\.resolution_summary/);
});

test('unsupported legacy review fields are explicitly read-only in the active form', () => {
  assert.match(adminPanel, /ข้อมูล Legacy แบบอ่านอย่างเดียว/);
  assert.doesNotMatch(adminPanel, /value=\{incidentForm\.(?:severity|assigned_to|management_note)\}/);
});
