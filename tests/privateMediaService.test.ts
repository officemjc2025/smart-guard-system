import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPrivateMediaPreview } from '../src/services/privateMediaService';

test('private preview sends Firebase authorization and creates a revocable object URL', async () => {
  let request: RequestInit | undefined;
  let revoked = '';
  const preview = await loadPrivateMediaPreview('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrSt/view', {
    endpointUrl: 'https://example.test/getVehicleEvidenceImage',
    getIdToken: async () => 'firebase-token',
    fetch: async (_input, init) => {
      request = init;
      return new Response(new Blob(['image'], { type: 'image/jpeg' }), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    },
    createObjectURL: () => 'blob:private-preview',
    revokeObjectURL: url => { revoked = url; },
  });
  assert.equal((request?.headers as Record<string, string>).Authorization, 'Bearer firebase-token');
  assert.equal(preview.objectUrl, 'blob:private-preview');
  preview.revoke();
  assert.equal(revoked, 'blob:private-preview');
});

test('failed preview does not mutate or erase the stored reference', async () => {
  const reference = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrSt/view';
  await assert.rejects(loadPrivateMediaPreview(reference, {
    endpointUrl: 'https://example.test/getVehicleEvidenceImage',
    getIdToken: async () => 'firebase-token',
    fetch: async () => new Response('forbidden', { status: 403 }),
    createObjectURL: () => 'blob:unused',
    revokeObjectURL: () => undefined,
  }));
  assert.equal(reference, 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrSt/view');
});
