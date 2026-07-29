export type ImportExportRecord = Record<string, unknown>;

export interface ImportExportColumn {
  key: string;
  label: string;
  required?: boolean;
  statuses?: readonly string[];
  aliases?: readonly string[];
}

export interface ImportExportModule {
  key: string;
  label: string;
  collectionName: string;
  idField: string;
  roomField?: string;
  columns: readonly ImportExportColumn[];
}

export interface ValidationIssue {
  rowNumber: number;
  field?: string;
  message: string;
}

export interface ValidatedImportRow {
  rowNumber: number;
  id: string;
  action: 'create' | 'update';
  data: ImportExportRecord;
}

export interface ImportValidationResult {
  validRows: ValidatedImportRow[];
  issues: ValidationIssue[];
  emptyRows: number;
}

export interface ExportFilters {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  building?: string;
  keyword?: string;
}

const compact = (value: string) => value.trim().toLowerCase().replace(/[\s_.-]+/g, '');
export const cleanCell = (value: unknown) => typeof value === 'string' ? value.replace(/^\uFEFF/, '').trim() : value;
export const displayCell = (value: unknown) => value === null || value === undefined ? '' : String(value);

export function normalizedHeader(value: string) {
  return compact(value.replace(/^\uFEFF/, ''));
}

export function headerKeys(module: ImportExportModule) {
  const keys = new Map<string, string>();
  module.columns.forEach(column => {
    [column.key, column.label, ...(column.aliases || [])].forEach(alias => {
      keys.set(normalizedHeader(alias), column.key);
    });
  });
  return keys;
}

export function validateImportRows(
  rows: readonly ImportExportRecord[],
  module: ImportExportModule,
  existingRecords: readonly ImportExportRecord[] = [],
): ImportValidationResult {
  const validRows: ValidatedImportRow[] = [];
  const issues: ValidationIssue[] = [];
  let emptyRows = 0;
  const seenIds = new Set<string>();
  const seenRooms = new Set<string>();
  const seenCardNumbers = new Set<string>();
  const seenQrValues = new Set<string>();
  const existingIdValues = new Map<string, string>(existingRecords
    .map(row => [compact(displayCell(row[module.idField])), displayCell(row[module.idField]).trim()] as const)
    .filter(([key]) => Boolean(key)));
  const existingIds = new Set(existingIdValues.keys());
  const existingRooms = new Map<string, string>();
  if (module.roomField) {
    existingRecords.forEach(row => {
      const room = compact(displayCell(row[module.roomField || '']));
      const building = compact(displayCell(row.building));
      if (room) existingRooms.set(module.key === 'units' ? room : `${building}|${room}`, displayCell(row[module.idField]).trim());
    });
  }

  rows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const data: ImportExportRecord = {};
    module.columns.forEach(column => { data[column.key] = cleanCell(rawRow[column.key]); });
    if (module.key === 'parking-cards') {
      const cardNumber = displayCell(data.card_number).trim();
      if (!displayCell(data.qr_code_value).trim()) data.qr_code_value = cardNumber;
      const status = displayCell(data.status).trim();
      data.status = canonicalParkingCardStatus(status || 'Available') || status;
      if (!displayCell(data.card_type).trim()) data.card_type = 'Temporary';
    }
    if (Object.values(data).every(value => displayCell(value).trim() === '')) {
      emptyRows += 1;
      return;
    }

    const rowIssues: ValidationIssue[] = [];
    module.columns.forEach(column => {
      const value = displayCell(data[column.key]).trim();
      if (column.required && !value) rowIssues.push({ rowNumber, field: column.key, message: `Missing required field: ${column.label}` });
      if (value && column.statuses && !column.statuses.includes(value)) {
        rowIssues.push({ rowNumber, field: column.key, message: `Invalid ${column.label}: ${value}` });
      }
    });

    let id = displayCell(data[module.idField]).trim();
    let normalizedId = compact(id);
    if (normalizedId && seenIds.has(normalizedId)) rowIssues.push({ rowNumber, field: module.idField, message: `Duplicate ID in file: ${id}` });
    if (normalizedId) seenIds.add(normalizedId);

    if (module.roomField) {
      const room = displayCell(data[module.roomField]).trim().normalize('NFC');
      data[module.roomField] = room;
      const roomKey = module.key === 'units' ? compact(room) : `${compact(displayCell(data.building))}|${compact(room)}`;
      if (room && seenRooms.has(roomKey)) rowIssues.push({ rowNumber, field: module.roomField, message: `Duplicate room number in file: ${room}` });
      if (room) seenRooms.add(roomKey);
      const existingOwner = existingRooms.get(roomKey);
      if (existingOwner && compact(existingOwner) !== normalizedId && module.key === 'units') {
        id = existingOwner;
        normalizedId = compact(existingOwner);
        data[module.idField] = existingOwner;
      } else if (existingOwner && compact(existingOwner) !== normalizedId) {
        rowIssues.push({ rowNumber, field: module.roomField, message: `Room number already belongs to another ID: ${room}` });
      }
    }

    if (module.key === 'parking-cards') {
      const cardNumber = compact(displayCell(data.card_number));
      const qrValue = compact(displayCell(data.qr_code_value));
      if (cardNumber && seenCardNumbers.has(cardNumber)) rowIssues.push({ rowNumber, field: 'card_number', message: `Duplicate Card Number in file: ${displayCell(data.card_number)}` });
      if (qrValue && seenQrValues.has(qrValue)) rowIssues.push({ rowNumber, field: 'qr_code_value', message: `Duplicate QR in file: ${displayCell(data.qr_code_value)}` });
      if (cardNumber) seenCardNumbers.add(cardNumber);
      if (qrValue) seenQrValues.add(qrValue);
      const existingCard = existingRecords.find(record => compact(displayCell(record.card_number)) === cardNumber);
      const existingQr = existingRecords.find(record => compact(displayCell(record.qr_code_value)) === qrValue);
      if (existingCard && compact(displayCell(existingCard[module.idField])) !== normalizedId) rowIssues.push({ rowNumber, field: 'card_number', message: `Duplicate Card Number already exists: ${displayCell(data.card_number)}` });
      if (existingQr && compact(displayCell(existingQr[module.idField])) !== normalizedId) rowIssues.push({ rowNumber, field: 'qr_code_value', message: `Duplicate QR already exists: ${displayCell(data.qr_code_value)}` });
    }

    if (rowIssues.length) issues.push(...rowIssues);
    else if (id) validRows.push({ rowNumber, id, action: existingIds.has(normalizedId) ? 'update' : 'create', data });
  });

  return { validRows, issues, emptyRows };
}

export function filterExportRows(rows: readonly ImportExportRecord[], filters: ExportFilters) {
  const keyword = filters.keyword?.trim().toLowerCase();
  return rows.filter(row => {
    const status = displayCell(row.status || row.occupancy_status);
    const building = displayCell(row.building);
    const date = displayCell(row.created_at || row.entry_time || row.checkout_time || row.incident_datetime);
    if (filters.status && status !== filters.status) return false;
    if (filters.building && building !== filters.building) return false;
    if (filters.dateFrom && date && date < filters.dateFrom) return false;
    if (filters.dateTo && date && date > `${filters.dateTo}T23:59:59.999`) return false;
    return !keyword || Object.values(row).some(value => displayCell(value).toLowerCase().includes(keyword));
  });
}
import { canonicalParkingCardStatus } from '../parkingCardStatus';
