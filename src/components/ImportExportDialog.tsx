import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, FileDown, FileSpreadsheet, Upload, X } from 'lucide-react';
import { commitImportPreview, previewImportFile, type ImportPreview } from '../services/importExport/excelImportService';
import { exportExcel } from '../services/importExport/excelExportService';
import { exportCsv } from '../services/importExport/csvExportService';
import { downloadTemplate } from '../services/importExport/templateService';
import type { ExportFilters, ImportExportModule, ImportExportRecord } from '../services/importExport/validationService';

interface ImportExportDialogProps {
  module: ImportExportModule;
  records: readonly object[];
  canImport?: boolean;
  onImported?: () => Promise<void> | void;
}

const recordsForFramework = (records: readonly object[]): ImportExportRecord[] =>
  records.map(record => Object.fromEntries(Object.entries(record)));

export default function ImportExportDialog({ module, records, canImport = true, onImported }: ImportExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState<ExportFilters>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const frameworkRecords = useMemo(() => recordsForFramework(records), [records]);
  const statuses = useMemo(() => [...new Set(frameworkRecords.map(row => String(row.status || row.occupancy_status || '')).filter(Boolean))], [frameworkRecords]);
  const buildings = useMemo(() => [...new Set(frameworkRecords.map(row => String(row.building || '')).filter(Boolean))], [frameworkRecords]);
  const previewCreates = preview?.validRows.filter(row => row.action === 'create').length || 0;
  const previewUpdates = preview?.validRows.filter(row => row.action === 'update').length || 0;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      setPreview(await previewImportFile(file, module, frameworkRecords));
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview || !canImport) return;
    setBusy(true);
    setMessage('');
    try {
      const count = await commitImportPreview(preview, module);
      await onImported?.();
      setPreview(null);
      setMessage(`บันทึกสำเร็จ ${count.toLocaleString()} รายการ`);
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} className="flex min-h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">
      <FileSpreadsheet className="h-4 w-4" /> Import / Export
    </button>
    {open && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3" onMouseDown={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label={`Import Export ${module.label}`} onMouseDown={event => event.stopPropagation()} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="font-black text-white">Import / Export — {module.label}</h3><p className="text-xs text-slate-400">ข้อมูลปัจจุบัน {records.length.toLocaleString()} รายการ</p></div>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button type="button" disabled={!canImport || busy} onClick={() => fileRef.current?.click()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-bold text-white disabled:opacity-40"><Upload className="h-4 w-4" /> Import</button>
          <button type="button" onClick={() => exportExcel(frameworkRecords, module, filters)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 text-xs font-bold text-white"><FileSpreadsheet className="h-4 w-4" /> Export XLSX</button>
          <button type="button" onClick={() => exportCsv(frameworkRecords, module, filters)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-700 px-3 text-xs font-bold text-white"><FileDown className="h-4 w-4" /> Export CSV</button>
          <button type="button" onClick={() => downloadTemplate(module)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-700 px-3 text-xs font-bold text-white"><Download className="h-4 w-4" /> Template</button>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />

        <div className="mt-4 grid grid-cols-1 gap-2 rounded-xl bg-slate-900 p-3 sm:grid-cols-2">
          <input type="date" aria-label="Date from" value={filters.dateFrom || ''} onChange={event => setFilters(current => ({ ...current, dateFrom: event.target.value }))} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white" />
          <input type="date" aria-label="Date to" value={filters.dateTo || ''} onChange={event => setFilters(current => ({ ...current, dateTo: event.target.value }))} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white" />
          <select aria-label="Status" value={filters.status || ''} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white"><option value="">ทุกสถานะ</option>{statuses.map(status => <option key={status}>{status}</option>)}</select>
          <select aria-label="Building" value={filters.building || ''} onChange={event => setFilters(current => ({ ...current, building: event.target.value }))} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white"><option value="">ทุกอาคาร</option>{buildings.map(building => <option key={building}>{building}</option>)}</select>
          <input type="search" value={filters.keyword || ''} onChange={event => setFilters(current => ({ ...current, keyword: event.target.value }))} placeholder="Keyword" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white sm:col-span-2" />
        </div>

        {message && <p className="mt-3 rounded-lg bg-slate-900 p-3 text-xs text-slate-200">{message}</p>}
        {preview && <div className="mt-4 rounded-xl border border-slate-800 p-4">
          <h4 className="text-sm font-bold text-white">Preview: {preview.fileName}</h4>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><span className="rounded-lg bg-emerald-950 p-2 text-emerald-300">เพิ่ม {previewCreates}</span><span className="rounded-lg bg-blue-950 p-2 text-blue-300">อัปเดต {previewUpdates}</span><span className="rounded-lg bg-red-950 p-2 text-red-300">ข้อผิดพลาด {preview.issues.length}</span><span className="rounded-lg bg-slate-900 p-2 text-slate-300">แถวว่าง {preview.emptyRows}</span></div>
          {preview.issues.length > 0 && <div className="mt-3 max-h-48 overflow-auto rounded-lg bg-red-950/40 p-3 text-xs text-red-300">{preview.issues.slice(0, 100).map((issue, index) => <p key={`${issue.rowNumber}-${issue.field}-${index}`}>แถว {issue.rowNumber}: {issue.message}</p>)}</div>}
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setPreview(null)} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white">ยกเลิก</button><button type="button" disabled={busy || preview.validRows.length === 0} onClick={() => void commit()} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">บันทึกเฉพาะแถวที่ผ่าน</button></div>
        </div>}
      </div>
    </div>}
  </>;
}
