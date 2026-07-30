import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { auth } from '../firebase';
import {
  exportOperationalAnalytics,
  getHistoricalDailyAnalytics,
  getTodayOperationalMetrics,
  subscribeRealtimeQueueMetrics,
  type DailyAnalyticsRecord,
  type RealtimeQueueMetrics,
} from '../services/operationalAnalyticsService';
import type { VehicleQueuePriority, VehicleQueueStatus } from '../types';

const emptyRealtime: RealtimeQueueMetrics = { waiting: 0, assigned: 0, inProgress: 0, waitingInformation: 0, ready: 0, assignedToMe: 0, urgent: 0, oldestWaitingSeconds: 0 };

export default function OperationalAnalyticsDashboard({ siteId, role, operatorName }: { siteId: string; role: string; operatorName: string }) {
  const [tab, setTab] = useState<'Queue' | 'Analytics' | 'My Work'>('Queue');
  const [realtime, setRealtime] = useState(emptyRealtime);
  const [daily, setDaily] = useState<DailyAnalyticsRecord | null>(null);
  const [history, setHistory] = useState<DailyAnalyticsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [priority, setPriority] = useState<VehicleQueuePriority | ''>('');
  const [queueStatus, setQueueStatus] = useState<VehicleQueueStatus | ''>('');
  const endDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const start = new Date(); start.setDate(start.getDate() - 6);
  const [startDate, setStartDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(start));
  const [rangeEnd, setRangeEnd] = useState(endDate);
  const canDailyAnalytics = ['ShiftHead', 'Manager', 'Admin'].includes(role);
  const canHistorical = ['Manager', 'Admin'].includes(role);

  useEffect(() => {
    setLoading(true);
    const stop = subscribeRealtimeQueueMetrics(siteId, auth.currentUser?.uid || '', metrics => { setRealtime(metrics); setLoading(false); }, reason => {
      const message = reason.message.includes('index') ? 'Index ยังไม่พร้อมใช้งาน' : reason.message.includes('permission') ? 'ไม่มีสิทธิ์เข้าถึงข้อมูล' : reason.message;
      setError(message); setLoading(false);
    }, { priority: priority || undefined, queueStatus: queueStatus || undefined });
    return stop;
  }, [siteId, priority, queueStatus]);

  const loadAnalytics = async () => {
    setLoading(true); setError('');
    try {
      setDaily(canDailyAnalytics ? await getTodayOperationalMetrics(siteId) : null);
      if (canHistorical) setHistory(await getHistoricalDailyAnalytics(siteId, startDate, rangeEnd));
    } catch (reason) {
      console.error('[OperationalAnalytics][loadAnalytics]', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadAnalytics(); }, [siteId, role]);

  const averages = useMemo(() => {
    const completed = daily?.sessions_completed || 0;
    return {
      waiting: completed ? Math.round((daily?.total_waiting_seconds || 0) / completed) : 0,
      working: completed ? Math.round((daily?.total_working_seconds || 0) / completed) : 0,
      cycle: completed ? Math.round((daily?.total_cycle_seconds || 0) / completed) : 0,
      completionRate: daily?.sessions_created ? Math.round((completed / daily.sessions_created) * 100) : 0,
    };
  }, [daily]);

  const download = () => {
    const csv = exportOperationalAnalytics(history, { siteId, startDate, endDate: rangeEnd, generatedBy: operatorName });
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `operational-analytics-${siteId}-${startDate}-${rangeEnd}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-black text-slate-800">Operational Analytics</h3><div className="flex gap-1">{(['Queue', 'Analytics', 'My Work'] as const).map(item => <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === item ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{item}</button>)}</div></div>
    {!navigator.onLine && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-800">Offline — กำลังแสดงข้อมูล cache ล่าสุด</p>}
    {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">{error}</p>}
    {loading ? <div className="mt-4 h-28 animate-pulse rounded-xl bg-slate-100" /> : tab === 'Queue' ? <>
      <div className="mt-3 flex gap-2"><select value={priority} onChange={event => setPriority(event.target.value as VehicleQueuePriority | '')} className="rounded-lg border p-2 text-xs"><option value="">ทุก Priority</option>{(['Emergency', 'High', 'Normal', 'Low'] as const).map(item => <option key={item}>{item}</option>)}</select><select value={queueStatus} onChange={event => setQueueStatus(event.target.value as VehicleQueueStatus | '')} className="rounded-lg border p-2 text-xs"><option value="">ทุกสถานะ</option>{(['Waiting', 'Assigned', 'In Progress', 'Waiting Information', 'Ready'] as const).map(item => <option key={item}>{item}</option>)}</select></div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">{Object.entries(realtime).map(([key, value]) => <div key={key} className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold text-slate-500">{key}</p><strong className="text-xl text-slate-900">{key === 'oldestWaitingSeconds' ? `${value}s` : value}</strong></div>)}</div>
    </> : tab === 'My Work' ? <div className="mt-4 rounded-xl bg-indigo-50 p-6 text-center"><p className="text-xs font-bold text-indigo-700">งานที่มอบหมายให้ฉัน</p><strong className="text-4xl text-indigo-900">{realtime.assignedToMe}</strong></div> : <>
      {!canHistorical ? <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Historical analytics สำหรับ Manager และ Admin</p> : <><div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs">เริ่ม<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="block rounded-lg border p-2" /></label><label className="text-xs">สิ้นสุด<input type="date" value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} className="block rounded-lg border p-2" /></label><button onClick={() => void loadAnalytics()} className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"><RefreshCw className="h-3 w-3" /> โหลด</button><button onClick={download} className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white"><Download className="h-3 w-3" /> CSV</button></div><div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">{[['Created', daily?.sessions_created || 0], ['Completed', daily?.sessions_completed || 0], ['Avg Wait', averages.waiting], ['Avg Work', averages.working], ['Avg Cycle', averages.cycle], ['Transfers', daily?.transfer_count || 0], ['Reassign', daily?.reassign_count || 0], ['Completion %', averages.completionRate]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">{label}</p><strong>{value}</strong></div>)}</div><div className="mt-4 overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['Date', 'Completed', 'Avg Wait', 'Avg Work', 'Avg Cycle', 'Transfer'].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{history.map(item => <tr key={item.date_key} className="border-t"><td className="p-2">{item.date_key}</td><td>{item.sessions_completed}</td><td>{item.sessions_completed ? Math.round(item.total_waiting_seconds / item.sessions_completed) : 0}</td><td>{item.sessions_completed ? Math.round(item.total_working_seconds / item.sessions_completed) : 0}</td><td>{item.sessions_completed ? Math.round(item.total_cycle_seconds / item.sessions_completed) : 0}</td><td>{item.transfer_count}</td></tr>)}</tbody></table>{!history.length && <p className="p-6 text-center text-slate-400">ไม่มีข้อมูลในช่วงนี้</p>}</div></>}</>
    }</section>;
}
