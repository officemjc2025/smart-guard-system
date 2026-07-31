import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dataUrlToImageBlob,
  imageBlobToDataUrl,
  KeyReturnEvidenceError,
  submitKeyReturnEvidence,
  validateLocalKeyReturnEvidence,
  validateUploadedKeyReturnEvidence,
  type UploadedKeyReturnEvidence,
} from '../src/services/keyReturnPolicy';

const photo = (type = 'image/jpeg') => new Blob(['photo'], { type });
const signature = () => new Blob(['signature'], { type: 'image/jpeg' });

const uploadedEvidence = (
  photoReference = 'https://drive.google.com/file/d/AAAAAAAAAAAA/view',
  signatureReference = 'https://drive.google.com/file/d/BBBBBBBBBBBB/view',
): UploadedKeyReturnEvidence => ({
  photo: {
    reference: photoReference,
    module: 'Key',
    moduleName: 'KeyLogs',
    mediaType: 'key_return',
    recordId: 'KEY_1',
    siteId: 'site-01',
  },
  signature: {
    reference: signatureReference,
    module: 'Key',
    moduleName: 'KeyLogs',
    mediaType: 'sig_key_return',
    recordId: 'KEY_1',
    siteId: 'site-01',
  },
});

test('local Key Return accepts mobile JPEG/PNG photos and an opaque JPEG signature Blob', () => {
  for (const type of ['image/jpeg', 'image/jpg', 'image/png']) {
    const photoFile = photo(type);
    const signatureBlob = signature();
    assert.deepEqual(validateLocalKeyReturnEvidence({
      photoFile,
      signatureBlob,
      signatureHasStroke: true,
    }), { photoFile, signatureBlob });
  }
});

test('local Key Return accepts an empty MIME camera file when its extension is JPEG', () => {
  const photoFile = Object.assign(new Blob(['photo']), { name: 'camera-capture.JPG' });
  assert.doesNotThrow(() => validateLocalKeyReturnEvidence({
    photoFile,
    signatureBlob: signature(),
    signatureHasStroke: true,
  }));
});

test('local Key Return reports missing photo and signature independently', () => {
  assert.throws(
    () => validateLocalKeyReturnEvidence({
      photoFile: null,
      signatureBlob: signature(),
      signatureHasStroke: true,
    }),
    error => error instanceof KeyReturnEvidenceError && error.code === 'missing-return-photo',
  );
  assert.throws(
    () => validateLocalKeyReturnEvidence({
      photoFile: photo(),
      signatureBlob: null,
      signatureHasStroke: false,
    }),
    error => error instanceof KeyReturnEvidenceError && error.code === 'missing-return-signature',
  );
});

test('local Key Return rejects unsupported HEIC/HEIF and non-JPEG signatures before upload', () => {
  for (const type of ['image/heic', 'image/heif']) {
    assert.throws(
      () => validateLocalKeyReturnEvidence({
        photoFile: photo(type),
        signatureBlob: signature(),
        signatureHasStroke: true,
      }),
      error => error instanceof KeyReturnEvidenceError && error.code === 'unsupported-return-photo',
    );
  }
  assert.throws(
    () => validateLocalKeyReturnEvidence({
      photoFile: photo(),
      signatureBlob: new Blob(['signature'], { type: 'image/png' }),
      signatureHasStroke: true,
    }),
    error => error instanceof KeyReturnEvidenceError && error.code === 'unsupported-return-signature',
  );
});

test('signature data URL conversion produces an uploadable JPEG Blob', async () => {
  const blob = dataUrlToImageBlob('data:image/jpeg;base64,c2lnbmF0dXJl');
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(blob.size, 9);
  assert.equal(await imageBlobToDataUrl(blob), 'data:image/jpeg;base64,c2lnbmF0dXJl');
});

test('uploaded Key Return validates distinct Private Media references and full identity', () => {
  assert.deepEqual(
    validateUploadedKeyReturnEvidence(uploadedEvidence(), {
      recordId: 'KEY_1',
      siteId: 'site-01',
    }),
    {
      returnPhotoReference: 'https://drive.google.com/file/d/AAAAAAAAAAAA/view',
      returnSignatureReference: 'https://drive.google.com/file/d/BBBBBBBBBBBB/view',
    },
  );
  assert.throws(
    () => validateUploadedKeyReturnEvidence(
      uploadedEvidence(
        'https://drive.google.com/file/d/AAAAAAAAAAAA/view',
        'https://drive.google.com/file/d/AAAAAAAAAAAA/view',
      ),
      { recordId: 'KEY_1', siteId: 'site-01' },
    ),
    error => error instanceof KeyReturnEvidenceError && error.code === 'duplicate-return-evidence',
  );
});

test('uploaded Key Return rejects data URLs and cross-record/site media identity', () => {
  assert.throws(
    () => validateUploadedKeyReturnEvidence(
      uploadedEvidence('data:image/jpeg;base64,cGhvdG8='),
      { recordId: 'KEY_1', siteId: 'site-01' },
    ),
    error => error instanceof KeyReturnEvidenceError && error.code === 'invalid-return-reference',
  );
  const mismatched = uploadedEvidence();
  mismatched.photo.recordId = 'KEY_2';
  assert.throws(
    () => validateUploadedKeyReturnEvidence(mismatched, {
      recordId: 'KEY_1',
      siteId: 'site-01',
    }),
    error => error instanceof KeyReturnEvidenceError
      && error.code === 'return-evidence-identity-mismatch',
  );
});

const localEvidence = () => ({
  photoFile: photo(),
  signatureBlob: signature(),
  signatureHasStroke: true,
});

test('submission uploads both local objects before validation and completion', async () => {
  const calls: string[] = [];
  const completed = await submitKeyReturnEvidence({
    recordId: 'KEY_1',
    siteId: 'site-01',
    localEvidence: localEvidence(),
  }, {
    prepare: async () => { calls.push('prepare'); },
    uploadPhoto: async () => {
      calls.push('upload-photo');
      return 'https://drive.google.com/file/d/AAAAAAAAAAAA/view';
    },
    uploadSignature: async () => {
      calls.push('upload-signature');
      return 'https://drive.google.com/file/d/BBBBBBBBBBBB/view';
    },
    complete: async () => {
      calls.push('complete');
      return 'done';
    },
  });
  assert.equal(completed.result, 'done');
  assert.deepEqual(calls, ['prepare', 'upload-photo', 'upload-signature', 'complete']);
});

test('missing local evidence stops before upload and completion', async () => {
  let uploads = 0;
  let completes = 0;
  const dependencies = {
    prepare: async () => {},
    uploadPhoto: async () => {
      uploads += 1;
      return 'https://drive.google.com/file/d/AAAAAAAAAAAA/view';
    },
    uploadSignature: async () => {
      uploads += 1;
      return 'https://drive.google.com/file/d/BBBBBBBBBBBB/view';
    },
    complete: async () => {
      completes += 1;
      return 'done';
    },
  };
  await assert.rejects(() => submitKeyReturnEvidence({
    recordId: 'KEY_1',
    siteId: 'site-01',
    localEvidence: { ...localEvidence(), photoFile: null },
  }, dependencies));
  await assert.rejects(() => submitKeyReturnEvidence({
    recordId: 'KEY_1',
    siteId: 'site-01',
    localEvidence: { ...localEvidence(), signatureBlob: null },
  }, dependencies));
  assert.equal(uploads, 0);
  assert.equal(completes, 0);
});

test('upload failure never completes and a successful photo reference is reusable on retry', async () => {
  let photoUploads = 0;
  let signatureUploads = 0;
  let savedPhotoReference = '';
  let completes = 0;
  const attempt = () => submitKeyReturnEvidence({
    recordId: 'KEY_1',
    siteId: 'site-01',
    localEvidence: localEvidence(),
    existingPhotoReference: savedPhotoReference,
  }, {
    prepare: async () => {},
    uploadPhoto: async () => {
      photoUploads += 1;
      return 'https://drive.google.com/file/d/AAAAAAAAAAAA/view';
    },
    uploadSignature: async () => {
      signatureUploads += 1;
      if (signatureUploads === 1) throw new Error('network');
      return 'https://drive.google.com/file/d/BBBBBBBBBBBB/view';
    },
    onPhotoUploaded: reference => { savedPhotoReference = reference; },
    complete: async () => {
      completes += 1;
      return 'done';
    },
  });
  await assert.rejects(attempt, /อัปโหลดลายเซ็นผู้คืนกุญแจไม่สำเร็จ/);
  assert.equal(completes, 0);
  assert.equal(savedPhotoReference, 'https://drive.google.com/file/d/AAAAAAAAAAAA/view');
  await attempt();
  assert.equal(photoUploads, 1);
  assert.equal(signatureUploads, 2);
  assert.equal(completes, 1);
});

test('photo upload failure stops before signature upload and completion', async () => {
  let signatureUploads = 0;
  let completes = 0;
  await assert.rejects(() => submitKeyReturnEvidence({
    recordId: 'KEY_1',
    siteId: 'site-01',
    localEvidence: localEvidence(),
  }, {
    prepare: async () => {},
    uploadPhoto: async () => { throw new Error('network'); },
    uploadSignature: async () => {
      signatureUploads += 1;
      return 'https://drive.google.com/file/d/BBBBBBBBBBBB/view';
    },
    complete: async () => {
      completes += 1;
      return 'done';
    },
  }), /อัปโหลดรูปหลักฐานการคืนกุญแจไม่สำเร็จ/);
  assert.equal(signatureUploads, 0);
  assert.equal(completes, 0);
});
