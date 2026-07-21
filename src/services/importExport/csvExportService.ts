import * as XLSX from 'xlsx';
import { displayCell, filterExportRows, type ExportFilters, type ImportExportModule, type ImportExportRecord } from './validationService';

export function exportCsv(rows: readonly ImportExportRecord[], module: ImportExportModule, filters: ExportFilters = {}) {
  const filtered = filterExportRows(rows, filters);
  const grid = [module.columns.map(column => column.label), ...filtered.map(row => module.columns.map(column => displayCell(row[column.key])))];
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(grid));
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${module.key}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
