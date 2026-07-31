import { auth } from '../firebase';
import { MEDIA_UPLOAD_URL } from '../config/firebaseFunctions';

export interface MediaUploadContext {
  moduleName: string;
  recordId: string;
  siteId: string;
  uploadedBy: string;
  mediaType?: string;
}

const MEDIA_UPLOAD_NOT_CONFIGURED = 'Media upload service is not configured.';

export type MediaUploadErrorCode =
  | 'UPLOAD_CORS'
  | 'UPLOAD_UNAUTHENTICATED'
  | 'UPLOAD_FORBIDDEN'
  | 'UPLOAD_INVALID_FILE'
  | 'UPLOAD_DRIVE_FAILED'
  | 'UPLOAD_NETWORK'
  | 'UPLOAD_INTERNAL';

export class MediaUploadError extends Error {
  constructor(public readonly code: MediaUploadErrorCode, message: string) {
    super(message);
  }
}

export function extractPrivateMediaFileId(reference: string): string {
  const match = /drive[.]google[.]com\/(?:file\/d\/|open[?]id=)([A-Za-z0-9_-]{10,128})/.exec(reference);
  if (!match) throw new Error('Private Media reference is invalid.');
  return match[1];
}

function validatedMediaUploadUrl(): string {
  if (!MEDIA_UPLOAD_URL) throw new Error(MEDIA_UPLOAD_NOT_CONFIGURED);
  try {
    const url = new URL(MEDIA_UPLOAD_URL);
    if (url.protocol !== 'https:' || !url.hostname) throw new Error(MEDIA_UPLOAD_NOT_CONFIGURED);
    return url.toString();
  } catch {
    throw new Error(MEDIA_UPLOAD_NOT_CONFIGURED);
  }
}

export function getMediaUploadConfigurationError(): string | null {
  try {
    validatedMediaUploadUrl();
    return null;
  } catch {
    return MEDIA_UPLOAD_NOT_CONFIGURED;
  }
}

export async function compressImageBase64(
  base64Data: string,
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.75,
): Promise<string> {
  return new Promise(resolve => {
    if (!base64Data.startsWith('data:image')) {
      resolve(base64Data);
      return;
    }
    const image = new Image();
    image.src = base64Data;
    image.onload = () => {
      let width = image.width;
      let height = image.height;
      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(base64Data);
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    image.onerror = () => resolve(base64Data);
  });
}

export async function uploadImageToDrive(
  base64Data: string,
  filename: string,
  mediaContext: MediaUploadContext,
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to upload evidence.');
  const compressed = await compressImageBase64(base64Data);
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(compressed);
  if (!match) throw new Error('Evidence image data is invalid.');
  const mimeType = match[1];
  const fileBase64 = match[2];
  const sizeInBytes = (fileBase64.length * 3) / 4;
  if (sizeInBytes > 2 * 1024 * 1024) {
    throw new Error(`ไฟล์ภาพมีขนาดใหญ่เกินกว่าขีดจำกัดสูงสุดหลังบีบอัด (${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB จากสูงสุด 2.00 MB) กรุณาใช้ไฟล์ที่มีขนาดเล็กลง`);
  }
  const uploadUrl = validatedMediaUploadUrl();
  const mediaType = mediaContext.mediaType || filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  console.info('[Media Upload Start]', {
    functionName: 'uploadVehicleEvidence',
    moduleName: mediaContext.moduleName,
    urlHost: new URL(uploadUrl).host,
    recordId: mediaContext.recordId,
    mediaType,
    sizeInBytes: Math.round(sizeInBytes),
    origin: window.location.origin,
  });
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: filename.replace(/[^a-zA-Z0-9_.-]/g, '_'),
        base64Data: fileBase64,
        mimeType,
        moduleName: mediaContext.moduleName,
        recordId: mediaContext.recordId,
        siteId: mediaContext.siteId,
        mediaType,
      }),
    });
  } catch (reason: unknown) {
    console.error('[Media Upload Failure]', {
      code: 'UPLOAD_NETWORK',
      recordId: mediaContext.recordId,
      mediaType,
      origin: window.location.origin,
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    throw new MediaUploadError(
      'UPLOAD_NETWORK',
      'ไม่สามารถเชื่อมต่อบริการอัปโหลดหลักฐานได้ กรุณาตรวจสอบเครือข่ายหรือการตั้งค่า CORS แล้วลองใหม่',
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  const result = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (!response.ok) {
    const detail = typeof result.message === 'string'
      ? result.message
      : typeof result.error === 'string' ? result.error : `Media upload failed with HTTP ${response.status}.`;
    const stage = typeof result.stage === 'string' ? ` (${result.stage})` : '';
    const backendCode = typeof result.code === 'string' ? result.code : '';
    const code: MediaUploadErrorCode =
      response.status === 401 ? 'UPLOAD_UNAUTHENTICATED' :
        response.status === 403 ? 'UPLOAD_FORBIDDEN' :
          response.status === 400 || response.status === 404 ? 'UPLOAD_INVALID_FILE' :
            backendCode === 'UPLOAD_DRIVE_FAILED' ? 'UPLOAD_DRIVE_FAILED' : 'UPLOAD_INTERNAL';
    const thaiMessage =
      code === 'UPLOAD_UNAUTHENTICATED' ? 'กรุณาเข้าสู่ระบบใหม่ก่อนอัปโหลดหลักฐาน' :
        code === 'UPLOAD_FORBIDDEN' ? 'สิทธิ์ของผู้ใช้งานไม่เพียงพอสำหรับหลักฐานรายการนี้' :
          code === 'UPLOAD_INVALID_FILE' ? 'ไฟล์รูปภาพหรือรายการอ้างอิงไม่ถูกต้อง' :
            code === 'UPLOAD_DRIVE_FAILED' ? 'ระบบจัดเก็บรูปภาพขัดข้อง กรุณาลองใหม่' :
              `${detail}${stage}`;
    throw new MediaUploadError(code, thaiMessage);
  }
  if (typeof result.mediaUrl !== 'string' || !result.mediaUrl.startsWith('https://')) {
    throw new Error('Media upload service returned an invalid media URL.');
  }
  console.info('[Media Upload Success]', {
    moduleName: mediaContext.moduleName,
    recordId: mediaContext.recordId,
    mediaType,
    sizeInBytes: typeof result.size === 'number' ? result.size : Math.round(sizeInBytes),
  });
  return result.mediaUrl;
}
