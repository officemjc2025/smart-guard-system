import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const vehicleSessionService = readFileSync(
  new URL('../src/services/vehicleSessionService.ts', import.meta.url),
  'utf8',
);

const parkingCardService = readFileSync(
  new URL('../src/services/parkingCardService.ts', import.meta.url),
  'utf8',
);

function analyticsHelper(source: string): string {
  const start = source.indexOf(
    'async function applyVehicleSessionAnalytics',
  );
  assert.notEqual(start, -1, 'analytics helper must exist');

  const nextExport = source.indexOf('\nexport ', start);
  assert.notEqual(nextExport, -1, 'analytics helper boundary must exist');

  return source.slice(start, nextExport);
}

test('Vehicle Session analytics is best-effort and cannot reject a committed operational write', () => {
  const helper = analyticsHelper(vehicleSessionService);

  assert.match(helper, /try\s*\{/);
  assert.match(helper, /await callable\(/);
  assert.match(helper, /catch\s*\(error\)/);
  assert.match(helper, /\[Vehicle Analytics Best-Effort Failure\]/);
});

test('Vehicle Exit analytics is best-effort and cannot reject a committed exit', () => {
  const helper = analyticsHelper(parkingCardService);

  assert.match(helper, /try\s*\{/);
  assert.match(helper, /await callable\(/);
  assert.match(helper, /catch\s*\(error\)/);
  assert.match(helper, /\[Vehicle Analytics Best-Effort Failure\]/);
});

test('all active Vehicle analytics workflows remain routed through the isolated helper', () => {
  assert.match(
    vehicleSessionService,
    /applyVehicleSessionAnalytics\(sessionId, siteId, 'Vehicle Entry'\)/,
  );

  assert.match(
    vehicleSessionService,
    /applyVehicleSessionAnalytics\(sessionId, result\.siteId, 'Vehicle Update'\)/,
  );

  assert.match(
    vehicleSessionService,
    /applyVehicleSessionAnalytics\(sessionId, result\.siteId, 'Vehicle Entry Completion'\)/,
  );

  assert.match(
    parkingCardService,
    /applyVehicleSessionAnalytics\(completedSessionId, siteId, 'Vehicle Exit'\)/,
  );
});
