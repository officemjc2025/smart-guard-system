import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildAllReportsWorkbook, buildModuleWorkbook } from '../src/services/excelExportService';
import { buildCsvExport } from '../src/services/importExport/csvExportService';
import { buildExportGrid, normalizeExportValue, resolveExportColumns } from '../src/services/importExport/exportData';
import { IMPORT_EXPORT_MODULES } from '../src/services/importExport/modules';
import type { ImportExportRecord } from '../src/services/importExport/validationService';

const vehicle = IMPORT_EXPORT_MODULES.VehicleLogs;

test('CSV contains BOM and every filtered row rather than the 100-row preview', () => {
  const records = Array.from({ length: 125 }, (_, index) => ({
    log_id: `LOG-${index}`,
    vehicle_plate: `กข-${index}`,
    entry_time: '2026-07-31T08:00:00.000Z',
    status: index === 124 ? 'ออกแล้ว' : 'กำลังจอด',
  }));
  const result = buildCsvExport(records, vehicle, { status: 'กำลังจอด' });
  assert.equal(result.content.charCodeAt(0), 0xfeff);
  assert.equal(result.rowCount, 124);
  assert.equal(result.content.split('\r\n').length, 125);
  assert.match(result.fileName, /^vehicle_logs_\d{4}-\d{2}-\d{2}[.]csv$/);
});

test('CSV escapes Thai text, comma, quote and newline correctly', () => {
  const result = buildCsvExport([{
    log_id: 'LOG-1', vehicle_plate: 'กข 1234', visitor_name: 'สมชาย, "ทดสอบ"\nบรรทัดสอง',
    entry_time: '2026-07-31T08:00:00.000Z', status: 'กำลังจอด',
  }], vehicle);
  assert.match(result.content, /กข 1234/);
  assert.match(result.content, /"สมชาย, ""ทดสอบ""\nบรรทัดสอง"/);
});

test('nullish values are empty while nested values and timestamps are normalized without mutation', () => {
  const nested = { tags: ['ไทย', 'security'], detail: { count: 2 } };
  const timestamp = { toDate: () => new Date('2026-07-31T01:00:00.000Z') };
  const source = { nested, timestamp, missing: null, absent: undefined };
  const before = JSON.stringify(nested);
  assert.equal(normalizeExportValue(null), '');
  assert.equal(normalizeExportValue(undefined), '');
  assert.equal(normalizeExportValue(timestamp), '2026-07-31T01:00:00.000Z');
  assert.equal(normalizeExportValue(nested), '{"tags":["ไทย","security"],"detail":{"count":2}}');
  buildExportGrid([source], vehicle);
  assert.equal(JSON.stringify(nested), before);
});

test('column order is metadata-first, deterministic, and retains additional fields', () => {
  const rows: ImportExportRecord[] = [
    { log_id: '1', z_extra: 'z', alpha_extra: 'a' },
    { log_id: '2', middle_extra: 'm' },
  ];
  const columns = resolveExportColumns(rows, vehicle);
  assert.deepEqual(columns.slice(0, vehicle.columns.length), vehicle.columns.map(column => column.key));
  assert.deepEqual(columns.slice(vehicle.columns.length), ['alpha_extra', 'middle_extra', 'z_extra']);
  const grid = buildExportGrid(rows, vehicle);
  assert.equal(grid.grid[1][columns.indexOf('z_extra')], 'z');
});

test('current module workbook uses the canonical worksheet and includes empty-sheet headers', () => {
  const populated = buildModuleWorkbook({ module: vehicle, records: [{ log_id: '1', extra: 'kept' }] });
  assert.equal(populated.sheets[0].name, 'Vehicle');
  assert.ok(populated.sheets[0].columns.includes('extra'));
  assert.match(populated.fileName, /^vehicle_logs_\d{4}-\d{2}-\d{2}[.]xlsx$/);
  const empty = buildModuleWorkbook({ module: vehicle, records: [] });
  assert.equal(empty.sheets[0].rows.length, 0);
  assert.deepEqual(empty.sheets[0].columns, vehicle.columns.map(column => column.key));
});

test('all-reports workbook has five consistently named filtered worksheets', () => {
  const modules = [
    IMPORT_EXPORT_MODULES.VehicleLogs,
    IMPORT_EXPORT_MODULES.ContractorLogs,
    IMPORT_EXPORT_MODULES.PatrolLogs,
    IMPORT_EXPORT_MODULES.KeyLogs,
    IMPORT_EXPORT_MODULES.IncidentReports,
  ];
  const workbook = buildAllReportsWorkbook(modules.map(module => ({
    module,
    records: [{ [module.idField]: '1', status: 'Active' }],
  })), { status: 'Active' });
  assert.deepEqual(workbook.sheets.map(sheet => sheet.name), ['Vehicle', 'Contractor', 'Patrol', 'Key', 'Incident']);
  assert.ok(workbook.sheets.every(sheet => sheet.rows.length === 1));
  assert.match(workbook.fileName, /^smart_guard_reports_\d{4}-\d{2}-\d{2}[.]xlsx$/);
});

test('Reports export is props-only, exposes three buttons, and disables empty exports', async () => {
  const source = await readFile(new URL('../src/components/ReportsCenter.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /firebase|listVehicleHistory|listContractors|listPatrolLogs|listKeyLogs|listIncidents/);
  assert.match(source, /Export CSV/);
  assert.match(source, /Export Excel/);
  assert.match(source, /Export All Excel/);
  assert.match(source, /filteredRecords\.length === 0/);
  assert.match(source, /allFilteredCount === 0/);
  assert.match(source, /filteredRecords\.slice\(0, 100\)/);
});
