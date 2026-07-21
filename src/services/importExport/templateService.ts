import * as XLSX from 'xlsx';
import type { ImportExportModule } from './validationService';

export function downloadTemplate(module: ImportExportModule) {
  const sheet = XLSX.utils.aoa_to_sheet([module.columns.map(column => column.label)]);
  sheet['!cols'] = module.columns.map(column => ({ wch: Math.min(32, Math.max(14, column.label.length + 4)) }));
  XLSX.writeFile({ SheetNames: [module.label], Sheets: { [module.label]: sheet } }, `${module.key}-template.xlsx`, { compression: true });
}
