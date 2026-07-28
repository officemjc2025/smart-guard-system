export type AuthStage =
  | 'AUTH-01'
  | 'AUTH-02'
  | 'AUTH-03'
  | 'AUTH-04'
  | 'AUTH-05'
  | 'AUTH-06'
  | 'AUTH-07'
  | 'AUTH-08'
  | 'AUTH-09'
  | 'AUTH-10'
  | 'AUTH-11'
  | 'AUTH-12'
  | 'AUTH-13';

export type AuthStageStatus = 'PASS' | 'FAIL' | 'NOT REACHED';

export interface AuthStageDiagnostic {
  stage: AuthStage;
  status: AuthStageStatus;
  code: string;
  message: string;
  source: string;
  path?: string;
}

const sanitize = (value: string) =>
  value.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted-id]');

export function firebaseErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return sanitize(String(error.code || 'unknown'));
  }
  return 'unknown';
}

export function firebaseErrorMessage(error: unknown): string {
  if (error instanceof Error) return sanitize(error.message);
  return sanitize(String(error || 'Unknown authentication error.'));
}

export function recordAuthStage(diagnostic: AuthStageDiagnostic): void {
  if (String(import.meta.env.VITE_APP_ENV || '').toUpperCase() !== 'STAGING') return;
  const method = diagnostic.status === 'FAIL' ? console.error : console.info;
  method('[Smart Guard Auth Stage]', diagnostic);
}

export function stagingAuthMessage(stage: AuthStage, error: unknown): string {
  const code = firebaseErrorCode(error);
  const descriptions: Partial<Record<AuthStage, string>> = {
    'AUTH-01': 'เริ่มต้น Firebase ไม่สำเร็จ',
    'AUTH-02': 'สร้าง Anonymous Session ไม่สำเร็จ',
    'AUTH-03': 'ไม่ได้รับ Firebase UID',
    'AUTH-04': 'เรียกบริการตรวจสอบ PIN ไม่สำเร็จ',
    'AUTH-05': 'บริการตรวจสอบ PIN ปฏิเสธคำขอ',
    'AUTH-06': 'บริการยังไม่ได้สร้าง Session Profile',
    'AUTH-07': 'อ่าน Session Profile ไม่สำเร็จ',
    'AUTH-08': 'เชื่อมโยงบัญชีผู้ปฏิบัติงานไม่สำเร็จ',
    'AUTH-09': 'ไม่พบสิทธิ์ผู้ใช้งาน',
    'AUTH-10': 'ไม่พบ Site ของผู้ใช้งาน',
    'AUTH-11': 'บันทึก Session ในแอปไม่สำเร็จ',
    'AUTH-12': 'Route Guard ไม่ยอมรับ Session',
    'AUTH-13': 'โหลดข้อมูล Dashboard ไม่สำเร็จ',
  };
  return `${stage}: ${descriptions[stage] || 'เข้าสู่ระบบไม่สำเร็จ'} (${code})`;
}
