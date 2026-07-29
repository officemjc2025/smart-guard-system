import { displayCell, filterExportRows, type ExportFilters, type ImportExportModule, type ImportExportRecord } from './validationService';
import { downloadCsv } from './csvSafe';

export function exportCsv(rows: readonly ImportExportRecord[], module: ImportExportModule, filters: ExportFilters = {}) {
  const filtered = filterExportRows(rows, filters);
  const grid = [module.columns.map(column => column.label), ...filtered.map(row => module.columns.map(column => displayCell(row[column.key])))];
  downloadCsv(grid, `${module.key}-${new Date().toISOString().slice(0, 10)}.csv`);
}
