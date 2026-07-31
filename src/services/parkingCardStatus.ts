import type { ParkingCardStatus } from '../types';

const normalized = (value: unknown) => typeof value === 'string'
  ? value.trim().normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '')
  : '';

const STATUS_MAP: Readonly<Record<string, ParkingCardStatus>> = {
  available: 'Available', ว่าง: 'Available',
  reserved: 'Reserved', จอง: 'Reserved',
  returned: 'Returned', คืนแล้ว: 'Returned',
  inuse: 'InUse', vehicleinside: 'InUse', ใช้งานอยู่: 'InUse', กำลังใช้งาน: 'InUse', กำลังจอด: 'InUse', active: 'InUse', parked: 'InUse',
  disabled: 'Disabled',
  suspended: 'Suspended', ระงับ: 'Suspended', ระงับชั่วคราว: 'Suspended',
  lost: 'Lost', สูญหาย: 'Lost', บัตรหาย: 'Lost',
  cancelled: 'Cancelled', canceled: 'Cancelled', ยกเลิก: 'Cancelled',
  retired: 'Retired',
  replaced: 'Replaced',
  replacementapproved: 'ReplacementApproved',
  vip: 'VIP',
};

export function canonicalParkingCardStatus(value: unknown): ParkingCardStatus | null {
  return STATUS_MAP[normalized(value)] || null;
}

export function normalizeParkingCardStatus(value: unknown): ParkingCardStatus {
  return canonicalParkingCardStatus(value) || 'Disabled';
}
