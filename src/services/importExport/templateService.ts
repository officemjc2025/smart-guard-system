import type { ImportExportModule } from './validationService';
import { downloadCsv } from './csvSafe';

export function downloadTemplate(module: ImportExportModule) {
  downloadCsv([module.columns.map(column => column.label)], `${module.key}-template.csv`);
}
