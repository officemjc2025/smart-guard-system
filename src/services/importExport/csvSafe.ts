export const CSV_LIMITS = { maxBytes: 5242880, maxRows: 5000, maxColumns: 100, maxCellCharacters: 10000 } as const;

export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvText = (grid: readonly (readonly unknown[])[]) =>
  grid.map(row => row.map(csvCell).join(',')).join('\r\n');

export async function parseCsvFile(file: File): Promise<string[][]> {
  if (!/\.csv$/i.test(file.name) || !['text/csv', 'application/vnd.ms-excel', ''].includes(file.type)) throw new Error('CSV-only mode: รองรับเฉพาะไฟล์ .csv');
  if (file.size > CSV_LIMITS.maxBytes) throw new Error('ไฟล์ CSV มีขนาดเกิน 5 MB');
  const input = await file.text();
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted && character === '"' && input[index + 1] === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === ',') { row.push(cell); cell = ''; continue; }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length > CSV_LIMITS.maxRows + 1) throw new Error('CSV มีข้อมูลเกิน 5,000 แถว');
      continue;
    }
    cell += character;
    if (cell.length > CSV_LIMITS.maxCellCharacters) throw new Error('CSV cell มีข้อมูลยาวเกินกำหนด');
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (rows.some(item => item.length > CSV_LIMITS.maxColumns)) throw new Error('CSV มีคอลัมน์เกิน 100 คอลัมน์');
  return rows;
}

export function downloadCsv(grid: readonly (readonly unknown[])[], fileName: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csvText(grid)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
  URL.revokeObjectURL(url);
}
