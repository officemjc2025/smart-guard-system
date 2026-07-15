import { HttpsError } from 'firebase-functions/v2/https';
import { MediaModule, UserRole } from './types';

/**
 * Normalizes email by trimming and converting to lowercase.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validates that an ID or string key has safe characters to prevent path traversal and injection.
 */
export function sanitizeAndValidateId(id: string, name: string): string {
  if (!id || typeof id !== 'string') {
    throw new HttpsError('invalid-argument', `${name} ต้องเป็นข้อความตัวอักษรและไม่เป็นค่าว่าง`);
  }
  // Allow alphanumeric, dashes, and underscores
  const safeRegex = /^[a-zA-Z0-9_\-]+$/;
  if (!safeRegex.test(id)) {
    throw new HttpsError('invalid-argument', `${name} มีอักขระที่ไม่ปลอดภัย (อนุญาตเฉพาะ A-Z, a-z, 0-9, - และ _)`);
  }
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new HttpsError('invalid-argument', `${name} ต้องไม่มีอักขระสำหรับเข้าถึงที่อยู่ระบบย่อย (Path Traversal)`);
  }
  return id;
}

/**
 * Validates standard text inputs to prevent script/HTML injection and control characters.
 */
export function sanitizeTextInput(input: string, maxLength: number, name: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  if (input.length > maxLength) {
    throw new HttpsError('invalid-argument', `${name} มีความยาวเกิน ${maxLength} ตัวอักษร`);
  }
  
  // Strip control characters, HTML tags, and trailing/leading space
  let cleaned = input.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  return cleaned.trim();
}

/**
 * Decodes base64 string and validates the image size and file type.
 */
export interface ValidatedFile {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  sizeBytes: number;
}

export function validateAndDecodeBase64(
  base64Data: string,
  declaredMime: 'image/jpeg' | 'image/png' | 'image/webp',
  maxSizeBytes: number = 2097152 // 2 MB default
): ValidatedFile {
  if (!base64Data || typeof base64Data !== 'string') {
    throw new HttpsError('invalid-argument', 'ข้อมูลภาพ Base64 ต้องไม่เป็นค่าว่าง');
  }

  // Strip data prefix if exists
  let cleanBase64 = base64Data;
  if (base64Data.startsWith('data:')) {
    const parts = base64Data.split(';base64,');
    if (parts.length === 2) {
      cleanBase64 = parts[1];
    } else {
      throw new HttpsError('invalid-argument', 'รูปแบบข้อมูลภาพ Base64 ไม่ถูกต้อง (Prefix ผิดรูปแบบ)');
    }
  }

  // Basic Base64 character check
  const base64Regex = /^[a-zA-Z0-9+/]*={0,2}$/;
  const cleanStripped = cleanBase64.replace(/\s/g, ''); // ignore whitespaces if any
  if (!base64Regex.test(cleanStripped)) {
    throw new HttpsError('invalid-argument', 'ข้อมูล Base64 มีตัวอักษรที่ไม่ได้รับอนุญาต');
  }

  // Decode Base64 to buffer
  let buffer: Buffer;
  try {
    buffer = Buffer.from(cleanStripped, 'base64');
  } catch (err) {
    throw new HttpsError('invalid-argument', 'ไม่สามารถถอดรหัสข้อมูลภาพ Base64 ได้');
  }

  const sizeBytes = buffer.length;
  if (sizeBytes === 0) {
    throw new HttpsError('invalid-argument', 'ไฟล์ภาพที่อัปโหลดมีขนาดเป็น 0 ไบต์ (ไฟล์ว่าง)');
  }

  if (sizeBytes > maxSizeBytes) {
    const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);
    const limitMb = (maxSizeBytes / (1024 * 1024)).toFixed(2);
    throw new HttpsError(
      'failed-precondition',
      `ไฟล์ภาพมีขนาดใหญ่เกินกว่าที่กำหนดไว้ (${sizeMb} MB จากสูงสุด ${limitMb} MB) กรุณาใช้ไฟล์ภาพอื่น`
    );
  }

  // Verify file signatures (magic bytes) to prevent SVG, HTML, PDF, exe, etc.
  // JPEG: FF D8 FF
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  // WEBP: RIFF .... WEBP
  const signatureHex = buffer.subarray(0, 8).toString('hex').toUpperCase();
  
  let detectedMime: 'image/jpeg' | 'image/png' | 'image/webp' | null = null;
  let ext: 'jpg' | 'png' | 'webp' = 'jpg';

  if (signatureHex.startsWith('FFD8FF')) {
    detectedMime = 'image/jpeg';
    ext = 'jpg';
  } else if (signatureHex.startsWith('89504E470D0A1A0A')) {
    detectedMime = 'image/png';
    ext = 'png';
  } else if (signatureHex.startsWith('52494646') && signatureHex.endsWith('57454250')) { // RIFF and WEBP
    // RIFF is 52494646 at byte 0-3, WEBP is 57454250 at byte 8-11.
    // Let's verify byte 8-11:
    const webpHeader = buffer.subarray(8, 12).toString('ascii');
    if (webpHeader === 'WEBP') {
      detectedMime = 'image/webp';
      ext = 'webp';
    }
  }

  if (!detectedMime) {
    throw new HttpsError(
      'invalid-argument',
      'ชนิดของไฟล์ภาพที่ส่งมาไม่ถูกต้อง สนับสนุนเฉพาะไฟล์ภาพ JPEG, PNG หรือ WebP และห้ามอัปโหลดไฟล์ชนิดอื่น เช่น SVG, GIF, PDF หรือไฟล์ระบบสคริปต์'
    );
  }

  if (detectedMime !== declaredMime) {
    throw new HttpsError(
      'invalid-argument',
      `ชนิดข้อมูลจริงของภาพ (${detectedMime}) ไม่ตรงกับประเภท MIME ที่ระบุมา (${declaredMime})`
    );
  }

  return {
    buffer,
    mimeType: detectedMime,
    extension: ext,
    sizeBytes
  };
}

/**
 * Normalizes operator roles to match standard system roles.
 */
export function normalizeRole(role: string): UserRole {
  const r = role ? role.trim() : 'Guard';
  if (r === 'Admin') return 'Admin';
  if (r === 'Manager') return 'Manager';
  if (r === 'Shift Leader' || r === 'ShiftHead' || r === 'ShiftLeader') return 'ShiftHead';
  return 'Guard';
}

/**
 * Safe generation of filename for Google Drive to prevent leaking personal information
 * and prevent duplicate conflicts.
 */
export function generateSafeFileName(
  module: MediaModule,
  mediaType: string,
  recordId: string,
  extension: string
): string {
  const timestamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .split('.')[0]; // YYYYMMDDTHHMMSS
  
  // Obfuscate or hash the recordId if it contains personal info, but simple ID is fine
  // Clean alphanumeric + underscores
  const cleanModule = module.toLowerCase();
  const cleanMediaType = mediaType.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const cleanRecordId = recordId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const randomSuffix = Math.random().toString(36).substring(2, 8); // 6 character alphanumeric random

  return `${cleanModule}_${cleanRecordId}_${cleanMediaType}_${timestamp}_${randomSuffix}.${extension}`;
}
