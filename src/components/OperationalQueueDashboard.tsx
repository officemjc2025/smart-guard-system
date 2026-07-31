import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Clock, Flame, Hand, UserCheck } from 'lucide-react';
import { auth } from '../firebase';
import type { VehicleQueuePriority, VehicleSessionRecord } from '../types';
import { listEligibleQueueOperators, releaseVehicleJob, setVehicleJobPriority, takeVehicleJob, transferVehicleJob, type EligibleQueueOperator } from '../services/vehicleAssignmentService';
import { dismissQueueNotificationPrompt, getQueueNotificationStatus, notifyQueueAssignment, requestQueueNotificationPermission, type QueueNotificationStatus } from '../services/vehicleQueueNotificationService';
import { subscribeCompletedToday, subscribeOperationalQueue } from '../services/vehicleQueueService';
import { SessionConflictError } from '../services/vehicleSessionVersionService';

interface OperationalQueueDashboardProps {
  siteId: string;
  operatorName: string;
  role: string;
  onContinue: (session: VehicleSessionRecord) => void;
}

const priorityClasses: Record<VehicleQueuePriority, string> = {
  Emergency: 'bg-red-100 text-red-800',
  High: 'bg-orange-100 text-orange-800',
  Normal: 'bg-blue-100 text-blue-800',
  Low: 'bg-slate-100 text-slate-700',
};

export default function OperationalQueueDashboard({ siteId, operatorName, role, onContinue }: OperationalQueueDashboardProps) {
  const [queue, setQueue] = useState<VehicleSessionRecord[]>([]);
  const [completed, setCompleted] = useState<VehicleSessionRecord[]>([]);
  const [message, setMessage] = useState('');
  const [operators, setOperators] = useState<EligibleQueueOperator[]>([]);
  const [transferSession, setTransferSession] = useState<VehicleSessionRecord | null>(null);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferSearch, setTransferSearch] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [notificationStatus, setNotificationStatus] = useState<QueueNotificationStatus>(() => getQueueNotificationStatus());
  const [conflict, setConflict] = useState<{ error: SessionConflictError; retry: () => Promise<void>; reviewing: boolean } | null>(null);
  const knownAssignments = useRef(new Set<string>());
  const uid = auth.currentUser?.uid || '';
  const canManage = ['ShiftHead', 'Manager', 'Admin'].includes(role);

  useEffect(() => {
    const reportReadError = (queryName: string) => (reason: Error) => {
      console.error(`[OperationalAnalytics][${queryName}]`, {
        code: 'code' in reason ? String(reason.code) : undefined,
        message: reason.message,
      });
      setMessage(reason.message);
    };
    const stopQueue = subscribeOperationalQueue(siteId, items => {
      const mine = items.filter(item => item.assignedTo === uid);
      mine.forEach(item => {
        if (!knownAssignments.current.has(item.session_id)) notifyQueueAssignment(item);
        knownAssignments.current.add(item.session_id);
      });
      setQueue(items);
    }, reportReadError('vehicleSessions.operationalQueue'));
    const stopCompleted = subscribeCompletedToday(
      siteId,
      setCompleted,
      reportReadError('vehicleSessions.completedToday'),
    );
    return () => { stopQueue(); stopCompleted(); };
  }, [siteId, uid]);

  useEffect(() => {
    if (canManage) void listEligibleQueueOperators(siteId).then(setOperators).catch(reason => setMessage(reason instanceof Error ? reason.message : String(reason)));
  }, [canManage, siteId]);

  const dashboard = useMemo(() => {
    const waiting = queue.filter(item => item.queueStatus === 'Waiting');
    const assignedToMe = queue.filter(item => item.assignedTo === uid);
    const now = Date.now();
    const waits = waiting.map(item => Math.max(0, now - new Date(item.created_at).getTime())).filter(Number.isFinite);
    return {
      waiting: waiting.length,
      assignedToMe: assignedToMe.length,
      oldestMinutes: waits.length ? Math.round(Math.max(...waits) / 60000) : 0,
      averageMinutes: waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length / 60000) : 0,
    };
  }, [queue, uid]);

  const context = { operatorName, role, siteId };
  const perform = async (operation: () => Promise<void>) => {
    setMessage('');
    try { await operation(); }
    catch (reason) {
      if (reason instanceof SessionConflictError) {
        setConflict({ error: reason, retry: operation, reviewing: false });
      }
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-slate-800">คิวปฏิบัติการรถเข้า</h3>
        <span className="flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm"><Bell className="h-4 w-4" /> การแจ้งเตือน: {notificationStatus}</span>
      </div>
      {notificationStatus === 'default' && <div className="flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900 sm:flex-row sm:items-center sm:justify-between">
        <p><strong>รับแจ้งเตือนเมื่องานถูกมอบหมาย</strong><br />ช่วยให้รับช่วงงานได้เร็วขึ้น แต่ระบบยังใช้งานได้ตามปกติหากไม่เปิด</p>
        <div className="flex gap-2"><button type="button" onClick={() => { dismissQueueNotificationPrompt(); setNotificationStatus('dismissed'); }} className="rounded-lg bg-white px-3 py-2 font-bold">ไว้ภายหลัง</button><button type="button" onClick={() => void requestQueueNotificationPermission().then(() => setNotificationStatus(getQueueNotificationStatus()))} className="rounded-lg bg-indigo-700 px-3 py-2 font-bold text-white">เปิดการแจ้งเตือน</button></div>
      </div>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[
          ['รอรับงาน', dashboard.waiting],
          ['งานของฉัน', dashboard.assignedToMe],
          ['รอนานสุด (นาที)', dashboard.oldestMinutes],
          ['เสร็จวันนี้', completed.length],
          ['รอเฉลี่ย (นาที)', dashboard.averageMinutes],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-white p-3 shadow-sm"><p className="text-[11px] font-bold text-slate-500">{label}</p><p className="text-xl font-black text-slate-900">{value}</p></div>)}
      </div>
      {message && <p className="rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">{message}</p>}
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {queue.map(session => {
          const mine = session.assignedTo === uid;
          const missing = [
            !session.vehicle_plate && 'ทะเบียน',
            !session.visitor_name && 'ชื่อผู้มาติดต่อ',
            !session.target_room && 'ห้อง/ปลายทาง',
          ].filter(Boolean);
          return <article key={session.session_id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${priorityClasses[session.priority]}`}>{session.priority}</span>
                <strong className="text-sm text-slate-900">{session.card_number}</strong>
                <span className="text-xs text-slate-500">{session.vehicle_plate || 'ยังไม่มีทะเบียน'} · {session.queueStatus}</span>
              </div>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><Clock className="h-3 w-3" /> อัปเดต {session.last_activity_at ? new Date(session.last_activity_at).toLocaleString('th-TH') : '-'}</p>
              <p className="mt-1 text-[10px] text-slate-500">
                เปิดโดย {session.opened_by_name || session.opened_by || '-'}
                {' · '}ผู้รับผิดชอบ {session.assignedTo || 'คิวกลาง'}
                {' · '}แก้ล่าสุด {session.last_updated_by || '-'}
              </p>
              <p className={`mt-1 text-[10px] font-bold ${missing.length ? 'text-amber-700' : 'text-emerald-700'}`}>
                {missing.length ? `ข้อมูลที่ขาด: ${missing.join(', ')}` : 'ข้อมูลหลักฐานครบ'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {!session.assignedTo && <button type="button" onClick={() => void perform(() => takeVehicleJob(session.session_id, context, { expectedSessionVersion: session.sessionVersion, expectedAssignmentVersion: session.assignmentVersion }))} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white"><Hand className="h-3 w-3" /> รับงาน</button>}
              <button type="button" onClick={() => onContinue(session)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white"><UserCheck className="h-3 w-3" /> ดำเนินการต่อ</button>
              {mine && <button type="button" onClick={() => void perform(() => releaseVehicleJob(session.session_id, context, { expectedSessionVersion: session.sessionVersion, expectedAssignmentVersion: session.assignmentVersion }))} className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-bold text-slate-700">คืนคิว</button>}
              {canManage && <button type="button" onClick={() => { setTransferSession(session); setTransferTarget(''); setTransferNote(''); }} className="rounded-lg bg-violet-100 px-3 py-2 text-xs font-bold text-violet-800">โอนงาน</button>}
              {canManage && <select aria-label="กำหนดความสำคัญ" value={session.priority} onChange={event => void perform(() => setVehicleJobPriority(session.session_id, event.target.value as VehicleQueuePriority, context, { expectedSessionVersion: session.sessionVersion }))} className="rounded-lg border border-slate-200 px-2 text-xs font-bold">
                {(['Emergency', 'High', 'Normal', 'Low'] as const).map(priority => <option key={priority}>{priority}</option>)}
              </select>}
              {session.priority === 'Emergency' && <Flame className="h-5 w-5 text-red-600" />}
            </div>
          </article>;
        })}
        {!queue.length && <p className="py-6 text-center text-sm font-bold text-slate-400">ไม่มีงานในคิว</p>}
      </div>
      {transferSession && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
          <h4 className="font-black text-slate-900">โอนงานบัตร {transferSession.card_number}</h4>
          <p className="mt-1 text-xs text-slate-500">เลือกผู้ปฏิบัติงาน Active ในพื้นที่เดียวกัน ระบบจะแสดงจำนวนงานปัจจุบัน</p>
          <input value={transferSearch} onChange={event => setTransferSearch(event.target.value)} placeholder="ค้นหาชื่อ บทบาท หรือกะ" className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm" />
          <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
            {operators.filter(operator => `${operator.name} ${operator.role} ${operator.shift}`.toLocaleLowerCase().includes(transferSearch.toLocaleLowerCase())).map(operator => {
              const workload = queue.filter(item => item.assignedTo === operator.uid).length;
              return <label key={operator.uid} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3">
                <span><strong className="block text-sm text-slate-800">{operator.name}</strong><small className="text-slate-500">{operator.role} · กะ {operator.shift || '-'} · งาน {workload}</small></span>
                <input type="radio" name="transfer-target" checked={transferTarget === operator.uid} onChange={() => setTransferTarget(operator.uid)} />
              </label>;
            })}
          </div>
          <textarea value={transferNote} onChange={event => setTransferNote(event.target.value)} maxLength={500} placeholder="หมายเหตุการโอน (ไม่บังคับ)" className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm" />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setTransferSession(null)} className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold">ยกเลิก</button>
            <button type="button" disabled={!transferTarget} onClick={() => void perform(async () => {
              await transferVehicleJob(transferSession.session_id, transferTarget, context, { note: transferNote, administrativeOverride: role === 'Admin', expectedSessionVersion: transferSession.sessionVersion, expectedAssignmentVersion: transferSession.assignmentVersion });
              setTransferSession(null);
            })} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">ยืนยันโอนงาน</button>
          </div>
        </div>
      </div>}
      {conflict && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-5">
          <h4 className="font-black text-red-700">ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว</h4>
          <p className="mt-2 text-sm text-slate-600">เวอร์ชันที่คาดไว้ {conflict.error.expectedVersion} · เวอร์ชันล่าสุด {conflict.error.actualVersion}</p>
          {conflict.reviewing && <div className="mt-3 rounded-xl bg-slate-100 p-3 text-xs text-slate-700">Stage ล่าสุด: {String(conflict.error.latestSession?.stage || '-')}<br />Queue ล่าสุด: {String(conflict.error.latestSession?.queueStatus || '-')}</div>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setConflict(null)} className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-bold">ยกเลิก</button>
            <button type="button" onClick={() => setConflict(current => current ? { ...current, reviewing: true } : null)} className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">ตรวจสอบความเปลี่ยนแปลง</button>
            <button type="button" onClick={() => { setConflict(null); setMessage('โหลดข้อมูลล่าสุดจากคิวแล้ว กรุณาตรวจสอบก่อนทำรายการใหม่'); }} className="rounded-lg bg-blue-100 px-3 py-2 text-xs font-bold text-blue-800">โหลดข้อมูลล่าสุด</button>
            <button type="button" disabled={!conflict.reviewing} onClick={() => void conflict.retry().then(() => setConflict(null)).catch(reason => setMessage(reason instanceof Error ? reason.message : String(reason)))} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">ลองใหม่หลังตรวจสอบ</button>
          </div>
        </div>
      </div>}
    </section>
  );
}
