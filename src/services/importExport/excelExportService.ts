import type { ExportFilters, ImportExportModule, ImportExportRecord } from './validationService';

export function exportExcel(rows: readonly ImportExportRecord[], module: ImportExportModule, filters: ExportFilters = {}) {
  void rows; void module; void filters;
  throw new Error('XLSX ถูกปิดใช้งานชั่วคราวเพื่อความปลอดภัย กรุณาใช้ CSV');
}
