import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { UnitRecord } from '../types';
import type { ImportPreview } from './importExport/excelImportService';
import { createUnitDocumentId, normalizeRoomNumber as roomComparisonKey, normalizeUnitId } from './unitService';
import { downloadCsv, parseCsvFile } from './importExport/csvSafe';
import { createUuid } from '../utils/uuid';

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

type HeaderField = keyof Pick<UnitRecord, 'unit_id' | 'building' | 'room_code' | 'room_number' | 'floor' | 'area' | 'ratio' | 'owner_name' | 'resident_name' | 'phone' | 'email' | 'occupancy_status' | 'status'>;

const headerAliases: Record<HeaderField, RegExp> = {
  unit_id: /^(unit_id|unitid|รหัสยูนิต)$/i,
  building: /^(building|อาคาร)$/i,
  room_code: /^(roomid|room_code|รหัสห้อง|รหัสยูนิต)$/i,
  room_number: /^(room_no|roomno|room_number|roomnumber|เลขที่ห้อง|เลขห้อง|ห้อง)$/i,
  floor: /^(floor|ชั้น)$/i,
  owner_name: /^(owner_name|ownername|ชื่อเจ้าของห้อง|ชื่อเจ้าของ|ชื่อ-นามสกุล|ชื่อ|owner)$/i,
  resident_name: /^(resident_name|residentname|resident|ชื่อผู้พักอาศัย|ผู้พักอาศัย)$/i,
  phone: /^(phoneno|phonenumber|phone|เบอร์โทร|เบอร์โทรศัพท์|เบอร์|phone_number)$/i,
  email: /^(email|อีเมล|อีเมลห้อง)$/i,
  occupancy_status: /^(occupancy_status|สถานะการพักอาศัย)$/i,
  status: /^(status|unit_status|สถานะ|สถานะห้อง)$/i,
  area: /^(area|พื้นที่|ขนาดพื้นที่)$/i,
  ratio: /^(ratio|อัตราส่วน)$/i,
};

const cleanText = (value: unknown) => String(value ?? '').trim();
const normalize = (value: string) => value.toLowerCase().replace(/[\s/_.-]/g, '');
const preserveBusinessValue = (value: unknown) => cleanText(value).normalize('NFC');
const currentSiteId = () => sessionStorage.getItem('selected_site_id') || 'site-01';

const EXPORT_HEADERS = ['Building', 'Floor', 'Room Number', 'Owner Name', 'Resident Name', 'Phone', 'Status'] as const;

function exportRows(units: UnitRecord[]) {
  return units.map(unit => ({
    Building: unit.building,
    Floor: unit.floor,
    'Room Number': unit.room_number,
    'Owner Name': unit.owner_name,
    'Resident Name': unit.resident_name,
    Phone: unit.phone || '',
    Status: unit.status,
  }));
}

export function exportUnitsExcel(units: UnitRecord[], fileName = 'units.xlsx') {
  void units; void fileName;
  throw new Error('XLSX ถูกปิดใช้งานชั่วคราวเพื่อความปลอดภัย กรุณาใช้ CSV');
}

export function exportUnitsCsv(units: UnitRecord[], fileName = 'units.csv') {
  downloadCsv([[...EXPORT_HEADERS], ...exportRows(units).map(row => EXPORT_HEADERS.map(header => row[header]))], fileName);
}

export function downloadUnitTemplate(fileName = 'unit-import-template.csv') {
  downloadCsv([[...EXPORT_HEADERS]], fileName.replace(/\.xlsx$/i, '.csv'));
}

export function unitIdFor(roomCode: string, roomNumber: string) {
  return preserveBusinessValue(roomCode || roomNumber);
}

function mapHeaders(headers: string[]) {
  const mapping = new Map<HeaderField, number>();
  headers.forEach((header, index) => {
    const text = cleanText(header).replace(/[\s-]+/g, '_');
    (Object.keys(headerAliases) as HeaderField[]).forEach(field => {
      if (headerAliases[field].test(text)) mapping.set(field, index);
    });
  });
  return mapping;
}

/** Parses bounded CSV locally; it never writes to Firestore. */
export async function previewUnitImport(file: File, existingUnits: UnitRecord[], _siteId = currentSiteId()): Promise<UnitImportPreview> {
  const grid = await parseCsvFile(file);
  const headers = (grid[0] || []).map(cleanText);
  const mapping = mapHeaders(headers);
  const rows: UnitImportRow[] = [];
  const seenIds = new Set<string>();
  const seenRooms = new Set<string>();
  const existingById = new Map(existingUnits.map(unit => [unit.unit_id, unit]));
  const existingByRoom = new Map(existingUnits.map(unit => [normalize(`${unit.building}|${unit.room_number}`), unit]));

  for (let index = 1; index < grid.length; index += 1) {
    const row = grid[index];
    if (!row.some(value => cleanText(value))) continue;
    const value = (field: HeaderField) => cleanText(row[mapping.get(field) ?? -1]);
    const roomCode = value('room_code');
    const roomNumber = preserveBusinessValue(value('room_number'));
    const building = value('building');
    const floor = value('floor');
    const ownerName = value('owner_name');
    const residentName = value('resident_name');
    const reasons: string[] = [];
    if (!roomNumber) reasons.push('missing room_number');
    if (!floor) reasons.push('missing floor');
    if (!ownerName) reasons.push('missing owner_name');
    const unitId = preserveBusinessValue(value('unit_id')) || unitIdFor(roomCode, roomNumber);
    const roomKey = normalize(`${building}|${roomNumber}`);
    if (seenIds.has(unitId)) reasons.push(`duplicate unit_id ${unitId} in file`);
    seenIds.add(unitId);
    if (seenRooms.has(roomKey)) reasons.push(`duplicate room ${building} ${roomNumber} in file`);
    seenRooms.add(roomKey);
    const existingRoom = existingByRoom.get(roomKey);
    if (existingRoom && existingRoom.unit_id !== unitId) reasons.push(`duplicate room already used by ${existingRoom.unit_id}`);
    if (reasons.length) { rows.push({ rowNumber: index + 1, action: 'reject', reasons }); continue; }

    const old = existingById.get(unitId);
    const now = new Date().toISOString();
    const importedStatus: UnitRecord['status'] = value('status') === 'Inactive' || value('occupancy_status') === 'Inactive' ? 'Inactive' : (old?.status || 'Active');
    const unit: UnitRecord = {
      firestore_document_id: old?.firestore_document_id || await createUnitDocumentId(currentSiteId(), unitId, roomNumber),
      unit_id: unitId, site_id: currentSiteId(), building, room_code: roomCode || undefined, room_number: roomNumber,
      floor, area: value('area') || undefined, ratio: value('ratio') || undefined, owner_name: ownerName, resident_name: residentName,
      phone: value('phone') || undefined, email: value('email') || undefined,
      occupancy_status: value('occupancy_status') || old?.occupancy_status || 'ไม่ระบุ',
      status: importedStatus,
      searchable_text: [roomCode, roomNumber, building, floor, ownerName, residentName, value('phone'), value('email')].join(' ').toLowerCase().trim(),
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
  const frameworkPreview: ImportPreview = {
    fileName: preview.sourceFileName,
    totalRows: preview.rows.length,
    detectedHeaders: preview.headers,
    headerMappings: preview.headers.map(header => ({ source: header, canonical: header })),
    emptyRows: 0,
    issues: preview.rows.filter(row => row.action === 'reject').flatMap(row => row.reasons.map(message => ({ rowNumber: row.rowNumber, message }))),
    validRows: preview.rows.filter((row): row is UnitImportRow & { unit: UnitRecord } => (row.action === 'create' || row.action === 'update') && Boolean(row.unit)).map(row => ({ rowNumber: row.rowNumber, id: row.unit.unit_id, action: row.action === 'create' ? 'create' : 'update', data: { ...row.unit } })),
  };
  await commitUnitFrameworkImport(frameworkPreview, operatorName);
  await hooks.afterCommit?.(preview);
  return { importBatchId, ...preview.summary };
}

/** Commits the shared framework preview while generating protected site/audit fields. */
export async function commitUnitFrameworkImport(preview: ImportPreview, operatorName: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated account is required for Unit import.');
  const siteId = currentSiteId();
  const now = new Date().toISOString();
  const existingSnapshot = await getDocs(query(collection(db, 'units'), where('site_id', '==', siteId)));
  const existingUnits = existingSnapshot.docs.map(snapshot => ({
    documentId: snapshot.id,
    unitId: cleanText(snapshot.data().unit_id),
    roomNumber: cleanText(snapshot.data().room_number),
  }));
  const existingByUnitId = new Map(existingUnits.map(unit => [normalizeUnitId(unit.unitId), unit]));
  const existingByRoom = new Map(existingUnits.map(unit => [roomComparisonKey(unit.roomNumber), unit]));
  const prepared = await Promise.all(preview.validRows.map(async row => {
    const importedUnitId = preserveBusinessValue(row.data.unit_id ?? row.id);
    const importedRoomNumber = preserveBusinessValue(row.data.room_number);
    const existing = existingByUnitId.get(normalizeUnitId(importedUnitId))
      || existingByRoom.get(roomComparisonKey(importedRoomNumber));
    const documentId = existing?.documentId || await createUnitDocumentId(siteId, importedUnitId, importedRoomNumber);
    const unitId = existing?.unitId || importedUnitId;
    const status = row.data.status === 'Inactive' ? 'Inactive' : 'Active';
    const unit = {
      firestore_document_id: documentId,
      unit_id: unitId,
      site_id: siteId,
      room_number: importedRoomNumber,
      building: preserveBusinessValue(row.data.building),
      floor: preserveBusinessValue(row.data.floor),
      owner_name: preserveBusinessValue(row.data.owner_name),
      resident_name: preserveBusinessValue(row.data.resident_name),
      phone: preserveBusinessValue(row.data.phone),
      status,
      occupancy_status: status,
      searchable_text: [importedRoomNumber, row.data.building, row.data.floor, row.data.owner_name, row.data.resident_name, row.data.phone].map(cleanText).join(' ').toLowerCase(),
      search_key: roomComparisonKey(importedRoomNumber),
      is_active: status === 'Active',
      ...(!existing ? { created_at: now } : {}),
      updated_at: now,
      import_batch_id: `UNIT_IMPORT_${preview.fileName}_${now}`,
    };
    return { row, existing, documentId, unit };
  }));
  let committed = 0;
  const failures: string[] = [];

  const commitRows = async (items: typeof prepared) => {
    const batch = writeBatch(db);
    items.forEach(({ row, existing, documentId, unit }) => {
      const auditId = `AUD_${createUuid()}`;
      batch.set(doc(db, 'units', documentId), unit, { merge: Boolean(existing) });
      batch.set(doc(db, 'auditLogs', auditId), {
        audit_id: auditId, operator_id: uid, account_uid: uid, operator_name: operatorName,
        user_name: operatorName, site_id: siteId, action: existing ? 'UnitImportedUpdated' : 'UnitImportedCreated',
        module_name: 'units', record_id: unit.unit_id, old_value: existing ? 'update' : 'create', new_value: JSON.stringify(unit),
        created_at: serverTimestamp(), action_result: 'Success',
      });
    });
    await batch.commit();
  };

  for (let start = 0; start < prepared.length; start += 190) {
    const chunk = prepared.slice(start, start + 190);
    try {
      await commitRows(chunk);
      committed += chunk.length;
    } catch (chunkError) {
      console.error('Unit import batch failed; retrying rows individually.', chunkError);
      for (const item of chunk) {
        try { await commitRows([item]); committed += 1; }
        catch (reason) {
          console.error('Unit import row failed.', { rowNumber: item.row.rowNumber, unitId: item.unit.unit_id, roomNumber: item.unit.room_number, reason });
          failures.push(`แถว ${item.row.rowNumber} ห้อง ${item.unit.room_number || '-'} (Unit ID ${item.unit.unit_id || '-'}): ไม่สามารถบันทึกข้อมูลได้`);
        }
      }
    }
  }
  const summaryId = `AUD_${createUuid()}`;
  const summaryBatch = writeBatch(db);
  summaryBatch.set(doc(db, 'auditLogs', summaryId), {
    audit_id: summaryId, operator_id: uid, account_uid: uid, operator_name: operatorName,
    user_name: operatorName, site_id: siteId, action: 'UnitBulkImportCompleted', module_name: 'units',
    record_id: preview.fileName, old_value: '', new_value: JSON.stringify({ committed, invalid: preview.issues.length, empty: preview.emptyRows }),
    created_at: serverTimestamp(), action_result: 'Success',
  });
  await summaryBatch.commit();
  if (failures.length) throw new Error(`บันทึกสำเร็จ ${committed} รายการ แต่พบข้อผิดพลาด ${failures.length} รายการ\n${failures.slice(0, 20).join('\n')}`);
  return committed;
}
