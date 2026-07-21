import * as XLSX from 'xlsx';
import { displayCell, filterExportRows, type ExportFilters, type ImportExportModule, type ImportExportRecord } from './validationService';

export function exportExcel(rows: readonly ImportExportRecord[], module: ImportExportModule, filters: ExportFilters = {}) {
  const filtered = filterExportRows(rows, filters);
  const exportRows = filtered.map(row => Object.fromEntries(module.columns.map(column => [column.label, displayCell(row[column.key])])));
  const sheet = XLSX.utils.json_to_sheet(exportRows, { header: module.columns.map(column => column.label) });
  sheet['!cols'] = module.columns.map(column => ({ wch: Math.min(32, Math.max(14, column.label.length + 4)) }));
  XLSX.writeFile({ SheetNames: [module.label], Sheets: { [module.label]: sheet } }, `${module.key}-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
}
