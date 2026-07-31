type TimestampLike = { toDate(): Date };

export type OperationalShiftType = 'day' | 'night';

export interface OperationalShift {
  shiftId: string;
  shiftType: OperationalShiftType;
  shiftStart: Date;
  shiftEnd: Date;
  operationalDate: string;
  isCurrentShift: boolean;
  isShiftClosed: boolean;
}

const asDate = (value: unknown): Date | null => {
  const result = value && typeof value === 'object' && 'toDate' in value
    && typeof (value as TimestampLike).toDate === 'function'
    ? (value as TimestampLike).toDate()
    : value instanceof Date ? value
      : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return result && !Number.isNaN(result.getTime()) ? result : null;
};

const bangkokParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value || '';
  return {
    dateKey: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
  };
};

export function operationalShift(value: unknown, now = new Date()): OperationalShift | null {
  const eventDate = asDate(value);
  if (!eventDate) return null;
  const local = bangkokParts(eventDate);
  const shiftType: OperationalShiftType = local.hour >= 7 && local.hour < 19 ? 'day' : 'night';
  let operationalDate = local.dateKey;
  if (shiftType === 'night' && local.hour < 7) {
    const localMidnight = new Date(`${local.dateKey}T00:00:00+07:00`);
    operationalDate = bangkokParts(new Date(localMidnight.getTime() - 24 * 60 * 60 * 1000)).dateKey;
  }
  const startHour = shiftType === 'day' ? '07' : '19';
  const shiftStart = new Date(`${operationalDate}T${startHour}:00:00+07:00`);
  const shiftEnd = new Date(shiftStart.getTime() + 12 * 60 * 60 * 1000);
  const current = now >= shiftStart && now < shiftEnd;
  return {
    shiftId: `${operationalDate}_${shiftType === 'day' ? 'DAY' : 'NIGHT'}`,
    shiftType,
    shiftStart,
    shiftEnd,
    operationalDate,
    isCurrentShift: current,
    isShiftClosed: now >= shiftEnd,
  };
}

export const currentOperationalShift = (now = new Date()) => operationalShift(now, now)!;
