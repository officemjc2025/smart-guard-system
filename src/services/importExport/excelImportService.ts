import * as XLSX from 'xlsx';
import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  headerKeys,
  normalizedHeader,
  validateImportRows,
  type ImportExportModule,
  type ImportExportRecord,
  type ImportValidationResult,
} from './validationService';

export interface ImportPreview extends ImportValidationResult {
  fileName: string;
  totalRows: number;
}

export async function previewImportFile(
  file: File,
  module: ImportExportModule,
  existingRecords: readonly ImportExportRecord[] = [],
): Promise<ImportPreview> {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('รองรับเฉพาะไฟล์ .xlsx, .xls และ .csv');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false, cellText: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error('ไม่พบ worksheet ในไฟล์');
  const grid = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '' });
  const aliases = headerKeys(module);
  const sourceHeaders = (grid[0] || []).map(value => String(value ?? '').trim());
  const mappedHeaders = sourceHeaders.map(header => aliases.get(normalizedHeader(header)) || '');
  const records = grid.slice(1).map(row => {
    const record: ImportExportRecord = {};
    mappedHeaders.forEach((key, index) => { if (key) record[key] = row[index]; });
    return record;
  });
  return { fileName: file.name, totalRows: records.length, ...validateImportRows(records, module, existingRecords) };
}

export async function commitImportPreview(preview: ImportPreview, module: ImportExportModule) {
  let committed = 0;
  for (let start = 0; start < preview.validRows.length; start += 400) {
    const batch = writeBatch(db);
    preview.validRows.slice(start, start + 400).forEach(row => {
      batch.set(doc(db, module.collectionName, row.id), row.data, { merge: true });
    });
    await batch.commit();
    committed += Math.min(400, preview.validRows.length - start);
  }
  return committed;
}
