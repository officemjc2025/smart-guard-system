export const MAX_LOCAL_KEY_RETURN_IMAGE_BYTES = 10 * 1024 * 1024;

export type KeyReturnEvidenceErrorCode =
  | 'missing-return-photo'
  | 'missing-return-signature'
  | 'unsupported-return-photo'
  | 'unsupported-return-signature'
  | 'invalid-return-reference'
  | 'duplicate-return-evidence'
  | 'return-evidence-identity-mismatch';

export class KeyReturnEvidenceError extends Error {
  constructor(
    message: string,
    readonly code: KeyReturnEvidenceErrorCode,
  ) {
    super(message);
    this.name = 'KeyReturnEvidenceError';
  }
}

export interface LocalKeyReturnEvidence {
  photoFile: Blob | null;
  signatureBlob: Blob | null;
  signatureHasStroke: boolean;
}

const normalizedImageMime = (blob: Blob): string => {
  const mime = blob.type.trim().toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  if (mime) return mime;
  const name = 'name' in blob ? String((blob as Blob & { name?: string }).name || '') : '';
  if (/[.]jpe?g$/i.test(name)) return 'image/jpeg';
  if (/[.]png$/i.test(name)) return 'image/png';
  return '';
};

const validLocalImage = (blob: Blob, allowedMimeTypes: ReadonlySet<string>) => {
  const mime = normalizedImageMime(blob);
  return blob.size > 0
    && blob.size <= MAX_LOCAL_KEY_RETURN_IMAGE_BYTES
    && allowedMimeTypes.has(mime);
};

export function validateLocalKeyReturnEvidence(
  evidence: LocalKeyReturnEvidence,
): { photoFile: Blob; signatureBlob: Blob } {
  if (!evidence.photoFile) {
    throw new KeyReturnEvidenceError(
      'กรุณาถ่ายรูปหลักฐานการคืนกุญแจ',
      'missing-return-photo',
    );
  }
  if (!validLocalImage(evidence.photoFile, new Set(['image/jpeg', 'image/png']))) {
    throw new KeyReturnEvidenceError(
      'ไฟล์รูปหลักฐานไม่รองรับ กรุณาถ่ายหรือเลือกรูปใหม่',
      'unsupported-return-photo',
    );
  }
  if (!evidence.signatureBlob || !evidence.signatureHasStroke) {
    throw new KeyReturnEvidenceError(
      'กรุณาลงลายเซ็นผู้คืนกุญแจ',
      'missing-return-signature',
    );
  }
  if (!validLocalImage(evidence.signatureBlob, new Set(['image/jpeg']))) {
    throw new KeyReturnEvidenceError(
      'ไฟล์ลายเซ็นผู้คืนกุญแจไม่รองรับ กรุณาล้างและลงลายเซ็นใหม่',
      'unsupported-return-signature',
    );
  }
  if (evidence.photoFile === evidence.signatureBlob) {
    throw new KeyReturnEvidenceError(
      'รูปหลักฐานและลายเซ็นการคืนกุญแจต้องเป็นคนละไฟล์',
      'duplicate-return-evidence',
    );
  }
  return {
    photoFile: evidence.photoFile,
    signatureBlob: evidence.signatureBlob,
  };
}

export interface UploadedKeyReturnMedia {
  reference: string;
  module: 'Key';
  moduleName: 'KeyLogs';
  mediaType: 'key_return' | 'sig_key_return';
  recordId: string;
  siteId: string;
}

export interface UploadedKeyReturnEvidence {
  photo: UploadedKeyReturnMedia;
  signature: UploadedKeyReturnMedia;
}

const privateDriveReference =
  /^https:\/\/drive[.]google[.]com\/(?:file\/d\/|open[?]id=)[A-Za-z0-9_-]{10,128}/;

export function validateUploadedKeyReturnEvidence(
  evidence: UploadedKeyReturnEvidence,
  expected: { recordId: string; siteId: string },
): { returnPhotoReference: string; returnSignatureReference: string } {
  const returnPhotoReference = evidence.photo.reference.trim();
  const returnSignatureReference = evidence.signature.reference.trim();
  if (
    !privateDriveReference.test(returnPhotoReference)
    || !privateDriveReference.test(returnSignatureReference)
  ) {
    throw new KeyReturnEvidenceError(
      'หลักฐานการคืนกุญแจไม่ได้ลงทะเบียนผ่านระบบ Private Media อย่างถูกต้อง',
      'invalid-return-reference',
    );
  }
  if (
    evidence.photo.module !== 'Key'
    || evidence.signature.module !== 'Key'
    || evidence.photo.moduleName !== 'KeyLogs'
    || evidence.signature.moduleName !== 'KeyLogs'
    || evidence.photo.mediaType !== 'key_return'
    || evidence.signature.mediaType !== 'sig_key_return'
    || evidence.photo.recordId !== expected.recordId
    || evidence.signature.recordId !== expected.recordId
    || evidence.photo.siteId !== expected.siteId
    || evidence.signature.siteId !== expected.siteId
  ) {
    throw new KeyReturnEvidenceError(
      'ข้อมูลอ้างอิงหลักฐานการคืนกุญแจไม่ตรงกับรายการที่กำลังปิด',
      'return-evidence-identity-mismatch',
    );
  }
  if (returnPhotoReference === returnSignatureReference) {
    throw new KeyReturnEvidenceError(
      'รูปหลักฐานและลายเซ็นการคืนกุญแจต้องเป็นคนละไฟล์',
      'duplicate-return-evidence',
    );
  }
  return { returnPhotoReference, returnSignatureReference };
}

export function dataUrlToImageBlob(dataUrl: string): Blob {
  const match = /^data:(image\/(?:jpeg|jpg|png));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) {
    throw new KeyReturnEvidenceError(
      'ไฟล์ลายเซ็นผู้คืนกุญแจไม่รองรับ กรุณาล้างและลงลายเซ็นใหม่',
      'unsupported-return-signature',
    );
  }
  const binary = atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase() });
}

export async function imageBlobToDataUrl(blob: Blob): Promise<string> {
  const mime = normalizedImageMime(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export interface SubmitKeyReturnEvidenceInput {
  recordId: string;
  siteId: string;
  localEvidence: LocalKeyReturnEvidence;
  existingPhotoReference?: string;
  existingSignatureReference?: string;
}

export interface SubmitKeyReturnEvidenceDependencies<TResult> {
  prepare: () => Promise<void>;
  uploadPhoto: (photo: Blob) => Promise<string>;
  uploadSignature: (signature: Blob) => Promise<string>;
  onPhotoUploaded?: (reference: string) => void;
  onSignatureUploaded?: (reference: string) => void;
  complete: (evidence: UploadedKeyReturnEvidence) => Promise<TResult>;
}

export async function submitKeyReturnEvidence<TResult>(
  input: SubmitKeyReturnEvidenceInput,
  dependencies: SubmitKeyReturnEvidenceDependencies<TResult>,
): Promise<{ result: TResult; evidence: UploadedKeyReturnEvidence }> {
  await dependencies.prepare();
  const local = validateLocalKeyReturnEvidence(input.localEvidence);

  let photoReference = input.existingPhotoReference?.trim() || '';
  if (!photoReference) {
    try {
      photoReference = await dependencies.uploadPhoto(local.photoFile);
    } catch {
      throw new Error('อัปโหลดรูปหลักฐานการคืนกุญแจไม่สำเร็จ');
    }
    dependencies.onPhotoUploaded?.(photoReference);
  }

  let signatureReference = input.existingSignatureReference?.trim() || '';
  if (!signatureReference) {
    try {
      signatureReference = await dependencies.uploadSignature(local.signatureBlob);
    } catch {
      throw new Error('อัปโหลดลายเซ็นผู้คืนกุญแจไม่สำเร็จ');
    }
    dependencies.onSignatureUploaded?.(signatureReference);
  }

  const evidence: UploadedKeyReturnEvidence = {
    photo: {
      reference: photoReference,
      module: 'Key',
      moduleName: 'KeyLogs',
      mediaType: 'key_return',
      recordId: input.recordId,
      siteId: input.siteId,
    },
    signature: {
      reference: signatureReference,
      module: 'Key',
      moduleName: 'KeyLogs',
      mediaType: 'sig_key_return',
      recordId: input.recordId,
      siteId: input.siteId,
    },
  };
  validateUploadedKeyReturnEvidence(evidence, {
    recordId: input.recordId,
    siteId: input.siteId,
  });
  const result = await dependencies.complete(evidence);
  return { result, evidence };
}
