import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('development server binds the LAN wildcard without hardcoding a device address', async () => {
  const packageJson = JSON.parse(await source('package.json')) as {
    scripts: Record<string, string>;
  };
  assert.match(packageJson.scripts.dev, /vite/);
  assert.match(packageJson.scripts.dev, /--host=0[.]0[.]0[.]0/);
  assert.match(packageJson.scripts.dev, /--port=3000/);
  assert.match(packageJson.scripts.dev, /--strictPort/);
  assert.doesNotMatch(packageJson.scripts.build, /--host|0[.]0[.]0[.]0/);
});

test('SignaturePad exports opaque white JPEG and preserves pixels across responsive resize', async () => {
  const signature = await source('src/components/SignaturePad.tsx');
  assert.match(signature, /fillStyle = WHITE/);
  assert.match(signature, /fillRect\(0, 0, exported\.width, exported\.height\)/);
  assert.match(signature, /toDataURL\('image\/jpeg', 0[.]92\)/);
  assert.match(signature, /previous\.getContext\('2d'\)\?\.drawImage/);
  assert.match(signature, /context\?\.drawImage\(previous/);
  assert.match(signature, /window\.devicePixelRatio/);
  assert.match(signature, /onPointerDown/);
  assert.match(signature, /onPointerMove/);
  assert.match(signature, /onPointerCancel/);
  assert.match(signature, /touch-none/);
  assert.match(signature, /if \(hasStrokeRef\.current\) exportSignature/);
});

test('Key signature filenames match the canonical JPEG payload', async () => {
  const keyLogs = await source('src/components/KeyLogs.tsx');
  assert.match(keyLogs, /`sig_key_\$\{checkoutForm\.room_number\}_\$\{Date\.now\(\)\}[.]jpg`/);
  assert.match(keyLogs, /`sig_key_return_\$\{keyLog\.room_number\}_\$\{Date\.now\(\)\}[.]jpg`/);
  assert.doesNotMatch(keyLogs, /sig_key[^`]*[.]png`/);
});

test('authenticated evidence uses one loaded object URL for thumbnail and accessible viewer', async () => {
  const viewer = await source('src/components/AuthenticatedEvidenceImage.tsx');
  assert.equal((viewer.match(/loadPrivateMediaPreview\(/g) || []).length, 1);
  assert.match(viewer, /role="dialog"/);
  assert.match(viewer, /aria-modal="true"/);
  assert.match(viewer, /event\.key === 'Escape'/);
  assert.match(viewer, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(viewer, /openerRef\.current\?\.focus\(\)/);
  assert.match(viewer, /event\.target === event\.currentTarget/);
  assert.match(viewer, /aria-label=\{`เปิดดู/);
  assert.match(viewer, /loading="lazy"/);
  assert.ok((viewer.match(/src=\{previewUrl\}/g) || []).length >= 2);
  assert.doesNotMatch(viewer, /drive[.]google[.]com/);
});

test('Search History does not substitute public placeholder media for private evidence', async () => {
  const history = await source('src/components/SearchHistory.tsx');
  assert.doesNotMatch(history, /images[.]unsplash[.]com|resolveHistoryImageUrl/);
  assert.match(history, /AuthenticatedEvidenceImage mediaReference=\{String\(selectedRecord\[field\]\)\}/);
});
