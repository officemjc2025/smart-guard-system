import type { ImportExportModule, ImportExportRecord } from './validationService';

type TimestampLike = { toDate(): Date };

const timestampDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof value === 'object' && 'toDate' in value
    && typeof (value as TimestampLike).toDate === 'function') {
    const date = (value as TimestampLike).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

export function normalizeExportValue(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  const date = timestampDate(value);
  if (date) return date.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(value, (_key, nested) => {
        const nestedDate = timestampDate(nested);
        if (nestedDate) return nestedDate.toISOString();
        if (typeof nested === 'bigint') return nested.toString();
        if (nested && typeof nested === 'object') {
          if (seen.has(nested)) return '[Circular]';
          seen.add(nested);
        }
        return nested;
      });
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function resolveExportColumns(rows: readonly ImportExportRecord[], module: ImportExportModule): string[] {
  const metadata = module.columns.map(column => column.key);
  const known = new Set(metadata);
  const additional = new Set<string>();
  rows.forEach(row => Object.keys(row).forEach(key => { if (!known.has(key)) additional.add(key); }));
  return [...metadata, ...[...additional].sort((left, right) => left.localeCompare(right, 'en'))];
}

export function buildExportGrid(rows: readonly ImportExportRecord[], module: ImportExportModule) {
  const columns = resolveExportColumns(rows, module);
  return {
    columns,
    grid: [columns, ...rows.map(row => columns.map(column => normalizeExportValue(row[column])))],
  };
}

export function bangkokExportDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export const exportFileBase = (module: ImportExportModule) =>
  module.exportFileBase || module.key.replace(/-/g, '_');
