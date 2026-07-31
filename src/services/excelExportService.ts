import { buildExportGrid, bangkokExportDate, exportFileBase } from './importExport/exportData';
import { filterExportRows, type ExportFilters, type ImportExportModule, type ImportExportRecord } from './importExport/validationService';

export interface ExcelExportSource {
  module: ImportExportModule;
  records: readonly ImportExportRecord[];
}

export interface WorkbookSheetData {
  name: string;
  columns: string[];
  rows: Array<Array<string | number | boolean>>;
}

export interface WorkbookData {
  fileName: string;
  sheets: WorkbookSheetData[];
}

const sheetData = (source: ExcelExportSource, filters: ExportFilters): WorkbookSheetData => {
  const filtered = filterExportRows(source.records, filters);
  const { columns, grid } = buildExportGrid(filtered, source.module);
  return {
    name: source.module.worksheetName || source.module.label.slice(0, 31),
    columns,
    rows: grid.slice(1) as Array<Array<string | number | boolean>>,
  };
};

export function buildModuleWorkbook(source: ExcelExportSource, filters: ExportFilters = {}): WorkbookData {
  return {
    fileName: `${exportFileBase(source.module)}_${bangkokExportDate()}.xlsx`,
    sheets: [sheetData(source, filters)],
  };
}

export function buildAllReportsWorkbook(sources: readonly ExcelExportSource[], filters: ExportFilters = {}): WorkbookData {
  return {
    fileName: `smart_guard_reports_${bangkokExportDate()}.xlsx`,
    sheets: sources.map(source => sheetData(source, filters)),
  };
}

export async function downloadExcelWorkbook(workbook: WorkbookData): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheets = workbook.sheets.map(sheet => ({
    sheet: sheet.name,
    data: [
      sheet.columns.map(column => ({ value: column, type: String, fontWeight: 'bold' as const })),
      ...sheet.rows.map(row => row.map(value => ({ value, type: typeof value === 'number' ? Number : typeof value === 'boolean' ? Boolean : String }))),
    ],
    columns: sheet.columns.map(() => ({ width: 20 })),
  }));
  const file = writeXlsxFile(sheets, { fontFamily: 'Arial', fontSize: 11 });
  await file.toFile(workbook.fileName);
}
