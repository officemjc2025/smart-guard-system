import { useState } from 'react';
import { AlertTriangle, Download, Search, ShieldCheck } from 'lucide-react';
import { auditParkingCards, downloadParkingCardAuditCsv, dryRunParkingCardMigration, executeParkingCardMigration, type ParkingCardAuditReport } from '../services/parkingCardMigrationService';

export default function ParkingCardDataAuditPanel({ onMigrated, onAuditReady }: { onMigrated: () => Promise<void> | void; onAuditReady: () => void }) {
  const [report, setReport] = useState<ParkingCardAuditReport | null>(null);
  const [dryRun, setDryRun] = useState<Awaited<ReturnType<typeof dryRunParkingCardMigration>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inspect = async () => { setBusy(true); setMessage(''); try { setReport(await auditParkingCards()); setDryRun(null); onAuditReady(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const preview = async () => { setBusy(true); setMessage(''); try { const result = await dryRunParkingCardMigration(); setDryRun(result); setReport(result.report); onAuditReady(); setMessage(`Dry Run: พร้อม Migration ${result.candidates.length} รายการ โดยยังไม่แก้ไขข้อมูลบัตร`); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const migrate = async () => {
    if (!dryRun || !window.confirm(`ยืนยัน Migration ${dryRun.candidates.length} รายการไปยัง Site ${dryRun.siteId}? การทำงานนี้จะไม่ลบหรือ reset สถานะรถ`)) return;
    setBusy(true); setMessage('');
    try { const result = await executeParkingCardMigration(dryRun); setMessage(`Migration สำเร็จ ${result.updated} รายการ, ล้มเหลว ${result.failed} รายการ`); await onMigrated(); setDryRun(null); setReport(await auditParkingCards()); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  };
  const cards = report ? [
    ['เอกสารทั้งหมด', report.totalDocuments], ['บัตรใน Site ปัจจุบัน', report.currentSiteDocuments], ['Legacy ไม่มี site_id', report.legacyMissingSiteId],
    ['เลขบัตรซ้ำ', report.duplicateCardNumbers.length], ['ค่า QR ซ้ำ', report.duplicateQrValues.length], ['ไม่มีเลขบัตร', report.missingCardNumber],
    ['ไม่มีค่า QR', report.missingQrValue], ['สถานะไม่มาตรฐาน', report.invalidStatuses], ['มีรถใช้งานอยู่', report.recordsWithCurrentVehicle], ['พร้อม Migration', report.migrationCandidates.length],
  ] : [];
  return <section className="mb-5 rounded-2xl border border-amber-700/40 bg-amber-950/20 p-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><h3 className="flex items-center gap-2 font-black text-amber-300"><ShieldCheck className="h-5 w-5" /> ตรวจสอบข้อมูลบัตรเดิม</h3><p className="text-xs text-slate-400">Read-only audit ก่อนกำหนด Site และ normalized fields ให้ข้อมูล Legacy</p></div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void inspect()} className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white"><Search className="h-4 w-4" /> ตรวจสอบข้อมูล</button><button disabled={!report} onClick={() => report && downloadParkingCardAuditCsv(report)} className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Download className="h-4 w-4" /> ดาวน์โหลดรายงาน CSV</button><button disabled={busy} onClick={() => void preview()} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white">Dry Run Migration</button>{dryRun && <button disabled={busy || dryRun.candidates.length === 0} onClick={() => void migrate()} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">ยืนยัน Migration</button>}</div></div>
    {message && <p className="mt-3 rounded-lg bg-slate-900 p-3 text-xs text-slate-200">{message}</p>}
    {report && <><div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">{cards.map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-900 p-3"><p className="text-[10px] font-bold text-slate-400">{label}</p><p className="text-lg font-black text-white">{value}</p></div>)}</div>{report.recordsWithCurrentVehicle > 0 && <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-900/40 p-3 text-xs font-bold text-amber-200"><AlertTriangle className="h-4 w-4" /> รายการที่มีรถใช้งานจะรักษาสถานะ ทะเบียนรถ และ Vehicle Log เดิมไว้ พร้อมติดธงตรวจสอบ integrity</p>}</>}
  </section>;
}
