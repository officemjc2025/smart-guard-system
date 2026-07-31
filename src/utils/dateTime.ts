const THAI_GREGORIAN_LOCALE = 'th-TH-u-ca-gregory';
const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

type FirestoreTimestampLike = { toDate(): Date };

function asDate(value: unknown): Date | null {
  const candidate = value
    && typeof value === 'object'
    && 'toDate' in value
    && typeof (value as FirestoreTimestampLike).toDate === 'function'
    ? (value as FirestoreTimestampLike).toDate()
    : value instanceof Date ? value
      : typeof value === 'number' ? new Date(value)
        : new Date(String(value || ''));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

export function formatThaiDate(value: unknown, fallback = '—'): string {
  const date = asDate(value);
  if (!date) return fallback;
  const parts = new Intl.DateTimeFormat('th-TH', {
    timeZone: BANGKOK_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value || '';
  return `${part('day')}/${part('month')}/${part('year')}`;
}

export function formatThaiTime(value: unknown, fallback = '—'): string {
  const date = asDate(value);
  const time = date
    ? new Intl.DateTimeFormat(THAI_GREGORIAN_LOCALE, {
      timeZone: BANGKOK_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date)
    : fallback;
  return date ? `${time} น.` : fallback;
}

export function formatThaiDateTime(value: unknown, fallback = '—'): string {
  const date = asDate(value);
  return date ? `${formatThaiDate(date, fallback)} ${formatThaiTime(date, fallback)}` : fallback;
}

export function formatBangkokDateKey(value: unknown): string {
  const date = asDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
