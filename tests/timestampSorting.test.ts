import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Firestore-backed timestamp fields are not sorted with localeCompare', () => {
  const serviceFiles = [
    'src/services/auditService.ts',
    'src/services/contractorService.ts',
    'src/services/incidentService.ts',
    'src/services/keyService.ts',
    'src/services/parkingCardService.ts',
    'src/services/patrolService.ts',
    'src/services/vehicleSessionActivityService.ts',
    'src/services/vehicleSessionService.ts',
  ];
  const unsafeTimestampSort = /\.(?:at|date|created_at|updated_at|incident_datetime|checkin_time|checkout_time|entry_time|exit_time)\.localeCompare\(/;
  for (const file of serviceFiles) {
    assert.doesNotMatch(source(file), unsafeTimestampSort, file);
  }
});

test('Incident mapper and list sorting normalize Firestore timestamps for SearchHistory', () => {
  const incidentService = source('src/services/incidentService.ts');
  assert.match(incidentService, /incident_datetime:\s*time\(data\.incident_datetime\)/);
  assert.match(incidentService, /toEpochMillis\(right\.incident_datetime\)/);
  assert.match(source('src/components/SearchHistory.tsx'), /listIncidents\(siteId\)/);
});
