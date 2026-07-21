import * as XLSX from 'xlsx';
import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { UnitRecord } from '../types';
import { writeAuditLog } from '../googleApi';

export type UnitImportAction = 'create' | 'update' | 'unchanged' | 'reject';

export interface UnitImportRow {
  rowNumber: number;
  action: UnitImportAction;
  unit?: UnitRecord;
  reasons: string[];
}

export interface UnitImportPreview {
  sourceFileName: string;
  headers: string[];
  rows: UnitImportRow[];
  summary: Record<UnitImportAction, number>;
}

export interface UnitImportCommitHooks {
  beforeCommit?: (preview: UnitImportPreview) => Promise<void> | void;
  afterCommit?: (preview: UnitImportPreview) => Promise<void> | void;
}

type HeaderField = keyof Pick<UnitRecord, 'room_code' | 'room_number' | 'floor' | 'area' | 'ratio' | 'owner_name' | 'phone' | 'email' | 'occupancy_status'>;

const headerAliases: Record<HeaderField, RegExp> = {
  room_code: /^(roomid|room_code|รหัสห้อง|รหัสยูนิต)$/i,
  room_number: /^(room_no|roomno|room_number|roomnumber|เลขที่ห้อง|เลขห้อง|ห้อง)$/i,
  floor: /^(floor|ชั้น)$/i,
  owner_name: /^(owner_name|ownername|ชื่อเจ้าของห้อง|ชื่อเจ้าของ|ชื่อ-นามสกุล|ชื่อ|owner)$/i,
  phone: /^(phoneno|phonenumber|phone|เบอร์โทร|เบอร์โทรศัพท์|เบอร์|phone_number)$/i,
  email: /^(email|อีเมล|อีเมลห้อง)$/i,
  occupancy_status: /^(occupancy_status|status|สถานะการพักอาศัย|สถานะ)$/i,
  area: /^(area|พื้นที่|ขนาดพื้นที่)$/i,
  ratio: /^(ratio|อัตราส่วน)$/i,
};

const cleanText = (value: unknown) => String(value ?? '').trim();
const normalize = (value: string) => value.toLowerCase().replace(/[\s/_.-]/g, '');
const cleanId = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

export function unitIdFor(roomCode: string, roomNumber: string) {
  return `UNIT_${cleanId(roomCode || roomNumber)}`.toUpperCase();
}

function mapHeaders(headers: string[]) {
  const mapping = new Map<HeaderField, number>();
  headers.forEach((header, index) => {
    const text = cleanText(header);
    (Object.keys(headerAliases) as HeaderField[]).forEach(field => {
      if (headerAliases[field].test(text)) mapping.set(field, index);
    });
  });
  return mapping;
}

/** Parses .xlsx, .xls, and .csv locally; it never writes to Firestore. */
export async function previewUnitImport(file: File, existingUnits: UnitRecord[], siteId = 'site-01'): Promise<UnitImportPreview> {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', raw: false, cellText: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const headers = (grid[0] || []).map(cleanText);
  const mapping = mapHeaders(headers);
  const rows: UnitImportRow[] = [];
  const seenIds = new Set<string>();
  const existingById = new Map(existingUnits.map(unit => [unit.unit_id, unit]));

  for (let index = 1; index < grid.length; index += 1) {
    const row = grid[index];
    if (!row.some(value => cleanText(value))) continue;
    const value = (field: HeaderField) => cleanText(row[mapping.get(field) ?? -1]);
    const roomCode = value('room_code');
    const roomNumber = value('room_number');
    const floor = value('floor');
    const ownerName = value('owner_name');
    const reasons: string[] = [];
    if (!roomNumber) reasons.push('missing room_number');
    if (!floor) reasons.push('missing floor');
    if (!ownerName) reasons.push('missing owner_name');
    const unitId = unitIdFor(roomCode, roomNumber);
    if (seenIds.has(unitId)) reasons.push(`duplicate unit_id ${unitId} in file`);
    seenIds.add(unitId);
    if (reasons.length) { rows.push({ rowNumber: index + 1, action: 'reject', reasons }); continue; }

    const old = existingById.get(unitId);
    const now = new Date().toISOString();
    const unit: UnitRecord = {
      unit_id: unitId, site_id: old?.site_id || siteId, room_code: roomCode || undefined, room_number: roomNumber,
      floor, area: value('area') || undefined, ratio: value('ratio') || undefined, owner_name: ownerName,
      phone: value('phone') || undefined, email: value('email') || undefined,
      occupancy_status: value('occupancy_status') || old?.occupancy_status || 'ไม่ระบุ',
      searchable_text: [roomCode, roomNumber, floor, ownerName, value('phone'), value('email')].join(' ').toLowerCase().trim(),
      search_key: normalize(`${roomNumber}${roomCode}`), is_active: old?.is_active ?? true,
      created_at: old?.created_at || now, updated_at: now, source_file_name: file.name,
      import_batch_id: old?.import_batch_id,
    };
    const action: UnitImportAction = !old ? 'create' : JSON.stringify({ ...old, updated_at: undefined, source_file_name: undefined, import_batch_id: undefined }) === JSON.stringify({ ...unit, updated_at: undefined, source_file_name: undefined, import_batch_id: undefined }) ? 'unchanged' : 'update';
    rows.push({ rowNumber: index + 1, action, unit, reasons: [] });
  }
  const summary: Record<UnitImportAction, number> = { create: 0, update: 0, unchanged: 0, reject: 0 };
  rows.forEach(row => { summary[row.action] += 1; });
  return { sourceFileName: file.name, headers, rows, summary };
}

/** Applies only create/update rows. There is no replace/delete path. */
export async function commitUnitImport(preview: UnitImportPreview, operatorName: string, hooks: UnitImportCommitHooks = {}) {
  await hooks.beforeCommit?.(preview);
  const importBatchId = `UNIT_IMPORT_${Date.now().toString(36)}`;
  const changes = preview.rows.filter(row => row.action === 'create' || row.action === 'update');
  for (let start = 0; start < changes.length; start += 400) {
    const batch = writeBatch(db);
    changes.slice(start, start + 400).forEach(row => batch.set(doc(db, 'units', row.unit!.unit_id), { ...row.unit!, import_batch_id: importBatchId }));
    await batch.commit();
  }
  await writeAuditLog(operatorName, 'นำเข้าข้อมูลห้องชุดแบบไม่ทำลายข้อมูล', 'Units', importBatchId, '', JSON.stringify(preview.summary));
  await hooks.afterCommit?.(preview);
  return { importBatchId, ...preview.summary };
}
