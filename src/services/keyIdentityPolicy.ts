export function normalizeOptionalIdentityNumber(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.length > 64) throw new Error('เลขเอกสารประจำตัวยาวเกิน 64 ตัวอักษร');
  const compact = normalized.replace(/[\s-]/g, '');
  if (/^\d+$/.test(compact) && compact.length !== 13) {
    throw new Error('เลขบัตรประชาชนต้องมี 13 หลัก');
  }
  return /^\d+$/.test(compact) ? compact : normalized;
}
