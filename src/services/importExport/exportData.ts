import type { ImportExportModule, ImportExportRecord } from './validationService';

type TimestampLike = { toDate(): Date };

export interface ExportFormatOptions {
  googleSheetsMode?: boolean;
}

export const GOOGLE_DRIVE_EXPORT_COLUMNS = [
  'drive_file_id',
  'drive_web_view_link',
  'drive_download_link',
  'drive_thumbnail_link',
  'photo_urls',
] as const;

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

const normalizedKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const values = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(values);
  const normalized = normalizeExportValue(value);
  return typeof normalized === 'string' && normalized.trim() ? [normalized.trim()] : [];
};
const unique = (items: readonly string[]) => [...new Set(items)];
const oneOrJson = (items: readonly string[]) => {
  const resolved = unique(items);
  return resolved.length > 1 ? JSON.stringify(resolved) : resolved[0] || '';
};
const driveIdFromUrl = (url: string) => {
  const path = url.match(/drive[.]google[.]com[/](?:file[/]d[/]|open[?]id=)([A-Za-z0-9_-]+)/)?.[1];
  const query = url.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1];
  return path || query || '';
};
const safeDriveId = (value: string) => /^[A-Za-z0-9_-]{10,}$/.test(value);

export function normalizeGoogleDriveFields(row: ImportExportRecord): ImportExportRecord {
  const fileIds: string[] = [];
  const webLinks: string[] = [];
  const downloadLinks: string[] = [];
  const thumbnailLinks: string[] = [];
  const photoUrls: string[] = [];

  Object.entries(row).forEach(([key, value]) => {
    const alias = normalizedKey(key);
    const entries = values(value);
    const fileIdentity = alias === 'drivefileid' || alias === 'fileid' || alias === 'photofileid'
      || (alias.endsWith('fileid') && /(drive|photo|image|evidence|thumbnail)/.test(alias));
    const thumbnail = alias === 'thumbnail' || alias === 'thumbnaillink' || alias === 'thumbnailurl'
      || alias === 'drivethumbnaillink';
    const download = alias === 'downloadurl' || alias === 'downloadlink' || alias === 'drivedownloadlink';
    const webView = alias === 'webviewlink' || alias === 'drivewebviewlink' || alias === 'driveurl';
    const photo = /(photo|image|evidence)/.test(alias) && /(url|link|urls|links)$/.test(alias);

    if (fileIdentity) fileIds.push(...entries);
    if (thumbnail) thumbnailLinks.push(...entries);
    if (download) downloadLinks.push(...entries);
    if (webView) webLinks.push(...entries);
    if (photo) {
      photoUrls.push(...entries);
      webLinks.push(...entries);
    }
  });

  const discoveredUrls = unique([...webLinks, ...downloadLinks, ...thumbnailLinks, ...photoUrls]);
  discoveredUrls.forEach(url => {
    const id = driveIdFromUrl(url);
    if (id) fileIds.push(id);
  });
  const hasExplicitWebLinks = webLinks.length > 0;
  const hasExplicitDownloadLinks = downloadLinks.length > 0;
  const hasExplicitThumbnailLinks = thumbnailLinks.length > 0;
  unique(fileIds).filter(safeDriveId).forEach(id => {
    if (!hasExplicitWebLinks) webLinks.push(`https://drive.google.com/file/d/${id}/view`);
    if (!hasExplicitDownloadLinks) downloadLinks.push(`https://drive.google.com/uc?export=download&id=${id}`);
    if (!hasExplicitThumbnailLinks) thumbnailLinks.push(`https://drive.google.com/thumbnail?id=${id}`);
  });
  if (photoUrls.length === 0 && webLinks.length > 0) photoUrls.push(...webLinks);

  const canonical: ImportExportRecord = {
    drive_file_id: oneOrJson(fileIds),
    drive_web_view_link: oneOrJson(webLinks),
    drive_download_link: oneOrJson(downloadLinks),
    drive_thumbnail_link: oneOrJson(thumbnailLinks),
    photo_urls: oneOrJson(photoUrls),
  };
  return Object.values(canonical).some(Boolean) ? canonical : {};
}

export function prepareExportRows(rows: readonly ImportExportRecord[]): ImportExportRecord[] {
  return rows.map(row => ({ ...row, ...normalizeGoogleDriveFields(row) }));
}

export function resolveExportColumns(rows: readonly ImportExportRecord[], module: ImportExportModule): string[] {
  const metadata = module.columns.map(column => column.key);
  const driveColumns = GOOGLE_DRIVE_EXPORT_COLUMNS.filter(column => rows.some(row => Boolean(row[column])));
  const known = new Set([...metadata, ...GOOGLE_DRIVE_EXPORT_COLUMNS]);
  const additional = new Set<string>();
  rows.forEach(row => Object.keys(row).forEach(key => { if (!known.has(key)) additional.add(key); }));
  return [...metadata, ...driveColumns, ...[...additional].sort((left, right) => left.localeCompare(right, 'en'))];
}

export function buildExportGrid(rows: readonly ImportExportRecord[], module: ImportExportModule, _options: ExportFormatOptions = {}) {
  const prepared = prepareExportRows(rows);
  const columns = resolveExportColumns(prepared, module);
  return {
    columns,
    grid: [columns, ...prepared.map(row => columns.map(column => normalizeExportValue(row[column])))],
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
