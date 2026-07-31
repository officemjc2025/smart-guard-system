import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Key Checkout and active frontend workflows use the central UUID utility', async () => {
  const keyLogs = await read('src/components/KeyLogs.tsx');
  assert.match(keyLogs, /const keyLogId = `KEY_\$\{createUuid\(\)\}`/);
  assert.doesNotMatch(keyLogs, /crypto[.]randomUUID/);

  const requiredWorkflowFiles = [
    'src/components/VehicleEntryExit.tsx',
    'src/components/ContractorLogs.tsx',
    'src/services/vehicleSessionService.ts',
    'src/services/vehicleAssignmentService.ts',
    'src/services/contractorService.ts',
  ];
  for (const path of requiredWorkflowFiles) {
    const source = await read(path);
    assert.match(source, /createUuid\(\)/, `${path} must use createUuid`);
    assert.doesNotMatch(source, /crypto[.]randomUUID/, `${path} has a direct randomUUID call`);
  }
});

test('active frontend code has no direct crypto.randomUUID call outside the utility', async () => {
  for await (const path of glob('src/**/*.{ts,tsx}')) {
    if (path === 'src/utils/uuid.ts') continue;
    const source = await read(path);
    assert.doesNotMatch(source, /(?:globalThis[.])?crypto[.]randomUUID\(/, path);
  }
});

test('media upload path does not create a second request identity or call randomUUID directly', async () => {
  const mediaUpload = await read('src/services/mediaUploadService.ts');
  assert.doesNotMatch(mediaUpload, /randomUUID\(/);
  assert.doesNotMatch(mediaUpload, /Math[.]random/);
});
