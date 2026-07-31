import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildExcelCell, buildModuleWorkbook } from '../src/services/excelExportService';
import { buildCsvExport } from '../src/services/importExport/csvExportService';
import {
  GOOGLE_DRIVE_EXPORT_COLUMNS,
  buildExportGrid,
  normalizeGoogleDriveFields,
  resolveExportColumns,
} from '../src/services/importExport/exportData';
import { IMPORT_EXPORT_MODULES } from '../src/services/importExport/modules';

const module = IMPORT_EXPORT_MODULES.VehicleLogs;

test('Google Drive aliases normalize to canonical link and thumbnail columns', () => {
  const normalized = normalizeGoogleDriveFields({
    driveFileId: 'FILE_1234567890',
    webViewLink: 'https://drive.google.com/file/d/FILE_1234567890/view',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=FILE_1234567890',
    thumbnail: 'https://drive.google.com/thumbnail?id=FILE_1234567890',
  });
  assert.equal(normalized.drive_file_id, 'FILE_1234567890');
  assert.equal(normalized.drive_web_view_link, 'https://drive.google.com/file/d/FILE_1234567890/view');
  assert.equal(normalized.drive_download_link, 'https://drive.google.com/uc?export=download&id=FILE_1234567890');
  assert.equal(normalized.drive_thumbnail_link, 'https://drive.google.com/thumbnail?id=FILE_1234567890');
});

test('multiple photo aliases export as one JSON array without URL re-encoding', () => {
  const urls = ['https://drive.google.com/file/d/PHOTO_1234567890/view', 'https://example.test/รูปภาพ 2.jpg'];
  const normalized = normalizeGoogleDriveFields({ photoURLs: urls });
  assert.equal(normalized.photo_urls, JSON.stringify(urls));
  assert.deepEqual(urls, ['https://drive.google.com/file/d/PHOTO_1234567890/view', 'https://example.test/รูปภาพ 2.jpg']);
});

test('Drive columns are metadata-first, canonical-second, additional-last and deterministic', () => {
  const rows = [{ log_id: '1', z_extra: true, photoUrl: 'https://example.test/photo.jpg', alpha_extra: true }];
  const grid = buildExportGrid(rows, module, { googleSheetsMode: true });
  const metadata = module.columns.map(column => column.key);
  assert.deepEqual(grid.columns.slice(0, metadata.length), metadata);
  const canonical = grid.columns.slice(metadata.length).filter(column =>
    (GOOGLE_DRIVE_EXPORT_COLUMNS as readonly string[]).includes(column));
  assert.deepEqual(canonical, ['drive_web_view_link', 'photo_urls']);
  const additional = grid.columns.slice(metadata.length).filter(column =>
    !(GOOGLE_DRIVE_EXPORT_COLUMNS as readonly string[]).includes(column));
  assert.deepEqual(additional, ['alpha_extra', 'photoUrl', 'z_extra']);
});

test('records without Drive fields keep backward-compatible columns and null handling', () => {
  const rows = [{ log_id: '1', vehicle_plate: null, custom: undefined }];
  const columns = resolveExportColumns(rows, module);
  assert.ok(GOOGLE_DRIVE_EXPORT_COLUMNS.every(column => !columns.includes(column)));
  const grid = buildExportGrid(rows, module);
  assert.equal(grid.grid[1][grid.columns.indexOf('vehicle_plate')], '');
  assert.equal(grid.grid[1][grid.columns.indexOf('custom')], '');
});

test('Google Sheets mode retains BOM/ISO and emits clickable Excel formulas for canonical URLs', () => {
  const timestamp = { toDate: () => new Date('2026-07-31T01:02:03.000Z') };
  const csv = buildCsvExport([{ log_id: '1', entry_time: timestamp, photoUrl: 'https://example.test/photo.jpg' }], module, {}, { googleSheetsMode: true });
  assert.equal(csv.content.charCodeAt(0), 0xfeff);
  assert.match(csv.content, /2026-07-31T01:02:03[.]000Z/);
  assert.match(csv.content, /https:\/\/example[.]test\/photo[.]jpg/);
  const cell = buildExcelCell('https://example.test/photo.jpg', 'drive_web_view_link', true);
  assert.equal(cell.type, 'Formula');
  assert.match(String(cell.value), /^HYPERLINK[(]/);
  assert.equal(buildExcelCell('https://example.test/photo.jpg', 'drive_web_view_link', false).type, String);
});

test('module workbook carries Google Sheets mode without truncating Drive fields', () => {
  const workbook = buildModuleWorkbook({ module, records: [{ log_id: '1', photoFileId: 'PHOTO_1234567890' }] }, {}, { googleSheetsMode: true });
  assert.equal(workbook.googleSheetsMode, true);
  assert.ok(workbook.sheets[0].columns.includes('drive_thumbnail_link'));
  assert.equal(workbook.sheets[0].rows.length, 1);
});

test('ReportsCenter defaults Google Sheets Ready ON and remains props-only', async () => {
  const source = await readFile(new URL('../src/components/ReportsCenter.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState\(true\)/);
  assert.match(source, /Google Sheets Ready/);
  assert.match(source, /googleSheetsMode/);
  assert.doesNotMatch(source, /firebase|listVehicleHistory|listContractors|listPatrolLogs|listKeyLogs|listIncidents/);
});
