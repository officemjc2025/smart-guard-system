import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = () => readFile(
  new URL('../src/components/KeyLogs.tsx', import.meta.url),
  'utf8',
);
const policySource = () => readFile(
  new URL('../src/services/keyReturnPolicy.ts', import.meta.url),
  'utf8',
);

test('Key Return keeps local binary, preview, and uploaded references in separate state', async () => {
  const keyLogs = await source();
  assert.match(keyLogs, /returnPhotoFile/);
  assert.match(keyLogs, /returnPhotoPreviewUrl/);
  assert.match(keyLogs, /returnPhotoMediaReference/);
  assert.match(keyLogs, /returnSignatureBlob/);
  assert.match(keyLogs, /returnSignatureMediaReference/);
  assert.match(keyLogs, /URL\.revokeObjectURL\(returnPhotoPreviewUrl\)/);
});

test('Key Return executes preflight, local validation, uploads, uploaded validation, then transaction', async () => {
  const policy = await policySource();
  const confirmFlow = policy.slice(
    policy.indexOf('export async function submitKeyReturnEvidence'),
  );
  const orderedTokens = [
    'dependencies.prepare()',
    'validateLocalKeyReturnEvidence(',
    'dependencies.uploadPhoto(',
    'dependencies.uploadSignature(',
    'validateUploadedKeyReturnEvidence(',
    'dependencies.complete(',
  ];
  let previous = -1;
  for (const token of orderedTokens) {
    const position = confirmFlow.indexOf(token);
    assert.ok(position > previous, `${token} must occur after the preceding phase`);
    previous = position;
  }
});

test('Key Return retries uploaded references and never sends preview/local data to Firestore service', async () => {
  const keyLogs = await source();
  assert.match(keyLogs, /existingPhotoReference: returnPhotoMediaReference/);
  assert.match(keyLogs, /existingSignatureReference: returnSignatureMediaReference/);
  assert.match(keyLogs, /setReturnPhotoMediaReference\(reference\)/);
  assert.match(keyLogs, /setReturnSignatureMediaReference\(reference\)/);
  assert.doesNotMatch(
    keyLogs,
    /completeKeyReturn\([^;]*(?:returnPhotoPreviewUrl|returnPhotoFile|returnSignatureBlob)/,
  );
});

test('changing local evidence invalidates only its corresponding uploaded reference', async () => {
  const keyLogs = await source();
  assert.match(
    keyLogs,
    /setReturnPhotoFile\(file\);[\s\S]*setReturnPhotoPreviewUrl\(URL\.createObjectURL\(file\)\);[\s\S]*setReturnPhotoMediaReference\(''\)/,
  );
  assert.match(
    keyLogs,
    /setReturnSignatureBlob\(dataUrlToImageBlob\(value\)\);[\s\S]*setReturnSignatureMediaReference\(''\)/,
  );
});
