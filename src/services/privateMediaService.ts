import { PRIVATE_MEDIA_URL } from '../config/firebaseFunctions';

export interface PrivatePreviewDependencies {
  endpointUrl: string;
  getIdToken: () => Promise<string>;
  fetch: typeof globalThis.fetch;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

const defaultDependencies = (): PrivatePreviewDependencies => ({
  endpointUrl: PRIVATE_MEDIA_URL,
  getIdToken: async () => {
    const { auth } = await import('../firebase');
    if (!auth.currentUser) throw new Error('กรุณาเข้าสู่ระบบใหม่เพื่อดูรูปหลักฐาน');
    return auth.currentUser.getIdToken();
  },
  fetch: globalThis.fetch.bind(globalThis),
  createObjectURL: URL.createObjectURL.bind(URL),
  revokeObjectURL: URL.revokeObjectURL.bind(URL),
});

export interface PrivateMediaPreview {
  objectUrl: string;
  revoke(): void;
}

export async function loadPrivateMediaPreview(
  mediaReference: string,
  dependencies: PrivatePreviewDependencies = defaultDependencies(),
): Promise<PrivateMediaPreview> {
  if (!mediaReference.trim()) throw new Error('ไม่พบข้อมูลอ้างอิงรูปหลักฐาน');
  if (!dependencies.endpointUrl) throw new Error('ยังไม่ได้ตั้งค่าบริการแสดงรูปหลักฐาน');
  const response = await dependencies.fetch(dependencies.endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await dependencies.getIdToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mediaReference }),
  });
  if (!response.ok) throw new Error(`ไม่สามารถโหลดรูปหลักฐานได้ (${response.status})`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error('บริการรูปหลักฐานส่งข้อมูลที่ไม่ใช่รูปภาพ');
  const objectUrl = dependencies.createObjectURL(await response.blob());
  let revoked = false;
  return {
    objectUrl,
    revoke() {
      if (revoked) return;
      revoked = true;
      dependencies.revokeObjectURL(objectUrl);
    },
  };
}
