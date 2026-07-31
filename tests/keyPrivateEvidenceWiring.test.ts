import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Key result and active list render both evidence references through the authenticated proxy', async () => {
  const keyLogs = await source('src/components/KeyLogs.tsx');
  assert.match(keyLogs, /completedKeyLog\.borrower_photo_url[\s\S]*AuthenticatedEvidenceImage/);
  assert.match(keyLogs, /completedKeyLog\.signature_image_url[\s\S]*AuthenticatedEvidenceImage/);
  assert.match(keyLogs, /k\.borrower_photo_url[\s\S]*AuthenticatedEvidenceImage/);
  assert.match(keyLogs, /k\.signature_image_url[\s\S]*AuthenticatedEvidenceImage/);
  assert.doesNotMatch(keyLogs, /<img[^>]+(?:borrower_photo_url|signature_image_url)/);
});

test('Search History renders Key evidence fields through the authenticated proxy', async () => {
  const history = await source('src/components/SearchHistory.tsx');
  assert.match(history, /'signature_image_url', 'borrower_photo_url'/);
  assert.match(history, /<AuthenticatedEvidenceImage mediaReference=\{String\(selectedRecord\[field\]\)\}/);
  assert.doesNotMatch(history, /<img[^>]+selectedRecord\[field\]/);
});

test('Key upload preserves separate canonical borrower and signature media identities', async () => {
  const keyLogs = await source('src/components/KeyLogs.tsx');
  assert.match(keyLogs, /mediaType: 'key_borrower'/);
  assert.match(keyLogs, /mediaType: 'sig_key'/);
  assert.match(keyLogs, /borrower_photo_url: bPhotoUrl/);
  assert.match(keyLogs, /signature_image_url: sigUrl/);
});

test('Key Return uses mandatory separate uploads and authenticated result/history rendering', async () => {
  const keyLogs = await source('src/components/KeyLogs.tsx');
  const history = await source('src/components/SearchHistory.tsx');
  assert.match(keyLogs, /mediaType: 'key_return'/);
  assert.match(keyLogs, /mediaType: 'sig_key_return'/);
  assert.match(keyLogs, /recordId: keyLog\.key_log_id/);
  assert.match(keyLogs, /submitKeyReturnEvidence\(/);
  assert.match(keyLogs, /complete: evidence => completeKeyReturn\(/);
  assert.match(keyLogs, /completedKeyLog\.return_photo_url/);
  assert.match(keyLogs, /completedKeyLog\.return_signature_url/);
  assert.match(history, /'return_photo_url', 'return_signature_url'/);
  assert.doesNotMatch(keyLogs, /<img[^>]+completedKeyLog\.(?:return_photo_url|return_signature_url)/);
});
