import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Download, Play, Search } from 'lucide-react';
import { assertBoundedDateRange } from '../services/operationalAnalyticsService';
import { FUNCTIONS_REGION } from '../config/firebaseFunctions';

interface RebuildResult {
  scanned: number;
  eligible?: number;
  processed?: number;
  writes?: number;
  lastDocumentId?: string | null;
}

export default function AnalyticsRebuildPanel({ isAdmin }: { isAdmin: boolean }) {
  const end = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const start = new Date(); start.setDate(start.getDate() - 6);
  const [startDate, setStartDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(start));
  const [endDate, setEndDate] = useState(end);
  const [preview, setPreview] = useState<RebuildResult | null>(null);
  const [result, setResult] = useState<RebuildResult | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;
  const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';

  const execute = async (write: boolean) => {
    setBusy(true); setMessage('');
    try {
      assertBoundedDateRange(startDate, endDate);
      if (write && (!backupConfirmed || !preview)) throw new Error('ต้อง Backup และ Preview ก่อน Rebuild');
      const name = write ? 'rebuildSiteDailyAnalytics' : 'previewSiteDailyAnalyticsRebuild';
      const callable = httpsCallable<Record<string, unknown>, RebuildResult>(getFunctions(undefined, FUNCTIONS_REGION), name);
      const response = await callable({ siteId, startDate, endDate, confirmed: write });
      if (write) setResult(response.data); else setPreview(response.data);
      setMessage(write ? 'Rebuild สำเร็จ' : 'Preview สำเร็จ — ไม่มีการเขียนข้อมูล');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const download = () => {
    const data = result || preview;
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ siteId, startDate, endDate, ...data }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `analytics-rebuild-${siteId}-${startDate}-${endDate}.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <section className="rounded-2xl border border-cyan-700/40 bg-cyan-950/20 p-5">
    <h3 className="font-black text-cyan-300">Daily Analytics Rebuild</h3>
    <p className="mt-1 text-xs text-slate-400">Admin only · จำกัดช่วงไม่เกิน 31 วัน · Preview-first</p>
    <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs text-slate-300">เริ่ม<input type="date" value={startDate} onChange={event => { setStartDate(event.target.value); setPreview(null); }} className="block rounded-lg bg-slate-900 p-2" /></label><label className="text-xs text-slate-300">สิ้นสุด<input type="date" value={endDate} onChange={event => { setEndDate(event.target.value); setPreview(null); }} className="block rounded-lg bg-slate-900 p-2" /></label><button disabled={busy} onClick={() => void execute(false)} className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white"><Search className="h-3 w-3" /> Preview</button><button disabled={busy || !backupConfirmed || !preview} onClick={() => void execute(true)} className="flex items-center gap-1 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Play className="h-3 w-3" /> Rebuild</button><button disabled={!preview && !result} onClick={download} className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Download className="h-3 w-3" /> JSON</button></div>
    <label className="mt-3 flex gap-2 text-xs font-bold text-red-300"><input type="checkbox" checked={backupConfirmed} onChange={event => setBackupConfirmed(event.target.checked)} /> ยืนยัน Backup และตรวจ Preview แล้ว</label>
    {(result || preview) && <pre className="mt-3 rounded-lg bg-slate-950 p-3 text-xs text-cyan-200">{JSON.stringify(result || preview, null, 2)}</pre>}
    {message && <p className="mt-3 text-xs font-bold text-cyan-200">{message}</p>}
  </section>;
}
