import { filterExportRows, type ExportFilters, type ImportExportModule, type ImportExportRecord } from './validationService';
import { csvContent, downloadCsv } from './csvSafe';
import { bangkokExportDate, buildExportGrid, exportFileBase, type ExportFormatOptions } from './exportData';

export function buildCsvExport(rows: readonly ImportExportRecord[], module: ImportExportModule, filters: ExportFilters = {}, options: ExportFormatOptions = {}) {
  const filtered = filterExportRows(rows, filters);
  const { columns, grid } = buildExportGrid(filtered, module, options);
  return {
    columns,
    rowCount: filtered.length,
    content: csvContent(grid),
    fileName: `${exportFileBase(module)}_${bangkokExportDate()}.csv`,
  };
}

export function exportCsv(rows: readonly ImportExportRecord[], module: ImportExportModule, filters: ExportFilters = {}, options: ExportFormatOptions = {}) {
  const filtered = filterExportRows(rows, filters);
  const { grid } = buildExportGrid(filtered, module, options);
  downloadCsv(grid, `${exportFileBase(module)}_${bangkokExportDate()}.csv`);
}
