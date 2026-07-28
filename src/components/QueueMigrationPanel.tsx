import { useState } from 'react';
import { Download, Play, Search } from 'lucide-react';
import {
  previewVehicleQueueBackfill,
  resumeVehicleQueueBackfill,
  runVehicleQueueBackfill,
  type QueueBackfillResult,
} from '../services/vehicleQueueBackfillService';

export default function QueueMigrationPanel({ isAdmin }: { isAdmin: boolean }) {
  const [result, setResult] = useState<QueueBackfillResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!isAdmin) return null;
  const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';

  const execute = async (mode: 'preview' | 'run' | 'resume') => {
    setBusy(true);
    setMessage('');
    try {
      if (mode !== 'preview' && !confirmed) throw new Error('กรุณายืนยันก่อนเขียนข้อมูลจริง');
      const options = { siteId, batchSize: 200, onProgress: setResult };
      const next = mode === 'preview'
        ? await previewVehicleQueueBackfill(options)
        : mode === 'resume' && result?.lastDocumentId
          ? await resumeVehicleQueueBackfill(options, result.lastDocumentId)
          : await runVehicleQueueBackfill(options);
      setResult(next);
      setMessage(mode === 'preview' ? 'Dry Run สำเร็จ — ยังไม่มีการแก้ไขข้อมูล' : 'ดำเนินการ Queue Backfill สำเร็จ');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `queue-backfill-${siteId}-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="mb-6 rounded-2xl border border-amber-700/40 bg-amber-950/20 p-5">
    <h3 className="font-black text-amber-300">Queue Backfill Migration</h3>
    <p className="mt-1 text-xs text-slate-400">Admin เท่านั้น · เริ่มด้วย Preview และไม่เขียนทับ Queue fields ที่ Migration แล้ว</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <button disabled={busy} onClick={() => void execute('preview')} className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white"><Search className="h-4 w-4" /> Preview / Dry Run</button>
      <button disabled={busy || !confirmed} onClick={() => void execute('run')} className="flex items-center gap-1 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Play className="h-4 w-4" /> Run Migration</button>
      <button disabled={busy || !confirmed || !result?.lastDocumentId} onClick={() => void execute('resume')} className="rounded-lg bg-orange-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Resume</button>
      <button disabled={!result} onClick={download} className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Download className="h-4 w-4" /> Export JSON</button>
    </div>
    <label className="mt-3 flex items-center gap-2 text-xs font-bold text-red-300"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> ยืนยันว่าตรวจ Preview และ Backup แล้วก่อนเขียนข้อมูลจริง</label>
    {result && <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-7">{(['scanned', 'eligible', 'skipped', 'updated', 'invalid', 'failed'] as const).map(key => <div key={key} className="rounded-lg bg-slate-900 p-2"><p className="text-slate-500">{key}</p><strong className="text-white">{result[key]}</strong></div>)}</div>}
    {result?.errors.length ? <pre className="mt-3 max-h-36 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] text-red-300">{JSON.stringify(result.errors, null, 2)}</pre> : null}
    {message && <p className="mt-3 text-xs font-bold text-amber-200">{message}</p>}
  </section>;
}
