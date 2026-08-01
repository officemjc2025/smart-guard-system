import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('every discovered operational media module uses the canonical Drive upload service', async () => {
  for (const component of [
    'src/components/VehicleEntryExit.tsx',
    'src/components/ContractorLogs.tsx',
    'src/components/KeyLogs.tsx',
    'src/components/PatrolLogs.tsx',
    'src/components/IncidentReports.tsx',
    'src/components/VehicleSessionTimeline.tsx',
  ]) {
    const contents = await source(component);
    assert.match(contents, /from ['"]\.\.\/services\/mediaUploadService['"]/);
    assert.match(contents, /uploadImageToDrive\(/);
  }
});

test('every discovered evidence viewer uses the canonical authenticated reader', async () => {
  for (const component of [
    'src/components/VehicleEntryExit.tsx',
    'src/components/ContractorLogs.tsx',
    'src/components/KeyLogs.tsx',
    'src/components/PatrolLogs.tsx',
    'src/components/IncidentReports.tsx',
    'src/components/VehicleSessionTimeline.tsx',
    'src/components/SearchHistory.tsx',
  ]) {
    assert.match(await source(component), /AuthenticatedEvidenceImage/);
  }
});

test('frontend media code has no legacy Firebase Storage writes or stale production endpoint', async () => {
  const files = [
    'src/services/mediaUploadService.ts',
    'src/services/privateMediaService.ts',
    'src/config/firebaseFunctions.ts',
    'src/components/VehicleEntryExit.tsx',
    'src/components/ContractorLogs.tsx',
    'src/components/KeyLogs.tsx',
    'src/components/PatrolLogs.tsx',
    'src/components/IncidentReports.tsx',
    'src/components/VehicleSessionTimeline.tsx',
  ];
  const contents = (await Promise.all(files.map(source))).join('\n');
  assert.doesNotMatch(contents, /us-central1-securityprojectv1/);
  assert.doesNotMatch(contents, /firebase\/storage|uploadBytes|uploadString|getDownloadURL/);
});
