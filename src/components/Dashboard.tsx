/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { 
  Car, Users, Key, ShieldCheck, AlertTriangle, 
  ArrowUpRight, ArrowDownLeft, RefreshCw, Clock, Ban,
  ClipboardList, ArrowRight
} from 'lucide-react';
import type { TabType } from '../App';
import { auth } from '../firebase';
import {
  getDashboardSummary,
  subscribeDashboardSummary,
  type DashboardSummary,
} from '../services/dashboardService';
import { subscribeWorkItems } from '../services/workItemService';
import { calculateWorkCenterKpis } from '../services/workItemPolicy';
import {
  firebaseErrorCode,
  firebaseErrorMessage,
  recordAuthStage,
} from '../services/authDiagnostics';
import { canLoadDashboard } from '../services/authFlowPolicy';
import { formatThaiTime } from '../utils/dateTime';
import AuthenticatedEvidenceImage from './AuthenticatedEvidenceImage';

interface DashboardProps {
  onNavigate: (tab: TabType) => void;
  activeRole: string;
  siteId: string;
}

export default function Dashboard({ onNavigate, activeRole, siteId }: DashboardProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loadError, setLoadError] = useState('');

  const [recentIncidents, setRecentIncidents] = useState<DashboardSummary['recentIncidents']>([]);
  const [workItemsKpis, setWorkItemsKpis] = useState({
    totalOpen: 0,
    myOpen: 0,
    unassigned: 0,
    inProgress: 0,
    waiting: 0,
    overdue: 0,
    resolved: 0,
    closed: 0,
  });

  const fetchStats = async () => {
    if (!canLoadDashboard({ role: activeRole, site_id: siteId, status: 'Active' })) return;
    setLoading(true);
    setLoadError('');
    try {
      const { recentIncidents: latestIncidents, ...summary } = await getDashboardSummary(
        siteId,
      );
      setData({ ...summary, recentIncidents: latestIncidents });
      setRecentIncidents(latestIncidents);
      recordAuthStage({
        stage: 'AUTH-13',
        status: 'PASS',
        code: 'ok',
        message: 'Dashboard initial data load completed.',
        source: 'src/components/Dashboard.tsx fetchStats',
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      setLoadError('ไม่สามารถโหลดข้อมูลได้');
      recordAuthStage({
        stage: 'AUTH-13',
        status: 'FAIL',
        code: firebaseErrorCode(error),
        message: firebaseErrorMessage(error),
        source: 'src/components/Dashboard.tsx fetchStats',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canLoadDashboard({ role: activeRole, site_id: siteId, status: 'Active' })) return;
    setLoading(true);
    setLoadError('');
    return subscribeDashboardSummary(siteId, summary => {
      const { recentIncidents: latestIncidents, ...metrics } = summary;
      setData({ ...metrics, recentIncidents: latestIncidents });
      setRecentIncidents(latestIncidents);
      setLoading(false);
    }, error => {
      console.error('Dashboard realtime query failed:', error);
      setLoadError('ไม่สามารถโหลดข้อมูลได้');
      setLoading(false);
    });
  }, [activeRole, siteId]);

  useEffect(() => {
    if (!siteId) return;
    const uid = auth.currentUser?.uid || '';
    const unsub = subscribeWorkItems(
      siteId,
      items => {
        setWorkItemsKpis(calculateWorkCenterKpis(items, uid));
      },
      undefined,
      err => console.warn('Dashboard WorkItems subscription error:', err)
    );
    return () => unsub();
  }, [siteId]);

  // Format date helper
  const formatTime = (isoString: unknown) => {
    return isoString ? formatThaiTime(isoString, '') : '';
  };

  if (!data && loading) {
    return <div className="mx-auto flex min-h-64 max-w-7xl items-center justify-center text-sm font-bold text-slate-500">กำลังโหลดข้อมูล Dashboard...</div>;
  }
  if (!data) {
    return <div role="alert" className="mx-auto max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-6 text-center font-bold text-red-800">
      {loadError || 'ไม่สามารถโหลดข้อมูลได้'}
      <button type="button" onClick={() => void fetchStats()} className="ml-3 underline">ลองใหม่</button>
    </div>;
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto px-1">
      {/* Header Panel */}
      {loadError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{loadError}</div>}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div>
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">ยินดีต้อนรับ • แดชบอร์ดความปลอดภัย</span>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2">
            Smart Guard System
            <span className="text-xs bg-blue-50 border border-blue-200 text-blue-700 font-bold px-2.5 py-0.5 rounded-full">
              สิทธิ์: {activeRole}
            </span>
          </h1>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-950 text-white font-semibold py-3 px-5 rounded-xl text-sm transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'กำลังซิงค์...' : 'รีเฟรชข้อมูล'}
        </button>
      </div>

      {/* Grid: Main KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Vehicles */}
        <div 
          onClick={() => onNavigate('vehicles')}
          className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-blue-300 transition-all cursor-pointer group flex flex-col justify-between min-h-36"
        >
          <div className="flex justify-between items-start">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-500">ยานพาหนะสะสมวันนี้</span>
              <span className="text-3xl font-black text-slate-800 mt-2 flex items-baseline gap-1.5">
                {data.vehiclesCurrent} <span className="text-xs font-medium text-slate-400">คันที่ยังจอด</span>
              </span>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:scale-110 transition-transform">
              <Car className="w-5 h-5" />
            </div>
          </div>
          <div className="flex gap-4 text-xs font-semibold text-slate-500 pt-3 border-t border-slate-100 mt-3">
            <span className="flex items-center gap-1 text-emerald-600">
              <ArrowUpRight className="w-3.5 h-3.5" /> เข้า: {data.vehiclesIn}
            </span>
            <span className="flex items-center gap-1 text-slate-500">
              <ArrowDownLeft className="w-3.5 h-3.5" /> ออกแล้ว: {data.vehiclesOut}
            </span>
          </div>
        </div>

        {/* Contractors */}
        <div 
          onClick={() => onNavigate('contractors')}
          className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-amber-300 transition-all cursor-pointer group flex flex-col justify-between min-h-36"
        >
          <div className="flex justify-between items-start">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-500">ผู้รับเหมาในพื้นที่</span>
              <span className="text-3xl font-black text-slate-800 mt-2">
                {data.contractorsCurrent} <span className="text-xs font-medium text-slate-400">รายกำลังทำ</span>
              </span>
            </div>
            <div className="p-3 bg-amber-50 text-amber-600 rounded-xl group-hover:scale-110 transition-transform">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="text-xs text-amber-700 font-medium bg-amber-50 px-2 py-1 rounded-lg w-fit mt-3">
            {data.contractorsCurrent > 0 ? '⚠️ กรุณาตรวจสอบเวลาออกของช่าง' : '✅ ไม่มีงานช่างค้างคา'}
          </div>
        </div>

        {/* Unreturned Keys */}
        <div 
          onClick={() => onNavigate('keys')}
          className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-red-300 transition-all cursor-pointer group flex flex-col justify-between min-h-36"
        >
          <div className="flex justify-between items-start">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-500">กุญแจที่ถูกเบิก</span>
              <span className="text-3xl font-black text-slate-800 mt-2">
                {data.keysCheckedOut} <span className="text-xs font-medium text-slate-400">ชุดยังไม่คืน</span>
              </span>
            </div>
            <div className="p-3 bg-red-50 text-red-600 rounded-xl group-hover:scale-110 transition-transform">
              <Key className="w-5 h-5" />
            </div>
          </div>
          <div className="text-xs text-red-700 font-medium bg-red-50 px-2 py-1 rounded-lg w-fit mt-3">
            {data.keysCheckedOut > 0 ? '🚨 มีกุญแจสำคัญถูกเบิกค้างคืน' : '✅ กุญแจทุกลูกจัดเก็บครบ'}
          </div>
        </div>

        {/* Patrol coverage */}
        <div 
          onClick={() => onNavigate('patrol')}
          className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-emerald-300 transition-all cursor-pointer group flex flex-col justify-between min-h-36"
        >
          <div className="flex justify-between items-start">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-500">การเดินตรวจวันนี้</span>
              <span className="text-3xl font-black text-slate-800 mt-2">
                {data.patrolDone}/{data.patrolTotal} <span className="text-xs font-medium text-slate-400">จุดตรวจเสร็จ</span>
              </span>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="flex gap-3 text-xs font-semibold pt-3 border-t border-slate-100 mt-3 text-slate-500">
            <span className="text-amber-600">รอดำเนินการ: {data.patrolPending}</span>
            {data.patrolOverdue > 0 && <span className="text-red-600 font-bold">⚠️ พบสิ่งผิดปกติ</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Vehicles Inside', data.vehiclesCurrent, 'text-blue-700'],
          ['Available Cards', data.availableCards, 'text-emerald-700'],
          ['Cards In Use', data.cardsInUse, 'text-indigo-700'],
          ['Suspended Cards', data.suspendedCards, 'text-amber-700'],
          ['Lost Cards', data.lostCards, 'text-red-700'],
          ['VIP Entries Today', data.vipEntriesToday, 'text-purple-700'],
        ].map(([label, value, color]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className={`mt-1 text-2xl font-black ${color}`}>{value}</p>
        </div>)}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-xs font-bold text-red-700">เหตุที่ยังไม่ได้รับทราบ</p>
          <p className="mt-1 text-2xl font-black text-red-800">{data.unacknowledgedIncidents}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-bold text-amber-700">เหตุกำลังดำเนินการ</p>
          <p className="mt-1 text-2xl font-black text-amber-800">{data.incidentsInProgress}</p>
        </div>
      </div>

      {/* Work Center Quick Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 rounded-2xl p-5 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-indigo-900/50">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-sm text-blue-300">
            <ClipboardList className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">ศูนย์งานติดตาม (Work Center)</h2>
              {workItemsKpis.overdue > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-red-500 text-white animate-pulse">
                  เกินกำหนด {workItemsKpis.overdue} งาน
                </span>
              )}
            </div>
            <p className="text-xs text-blue-200 mt-0.5">
              งานเปิดทั้งหมด {workItemsKpis.totalOpen} งาน • ของฉัน {workItemsKpis.myOpen} งาน • ยังไม่มอบหมาย {workItemsKpis.unassigned} งาน • รอ/กำลังทำ {workItemsKpis.inProgress + workItemsKpis.waiting} งาน
            </p>
          </div>
        </div>

        <button
          onClick={() => onNavigate('workCenter')}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white text-xs sm:text-sm font-bold rounded-xl shadow transition-all flex items-center justify-center gap-2 cursor-pointer w-full md:w-auto"
        >
          <span>เปิดศูนย์งานติดตาม</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Row: Analytics Gauge & Recent Incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Patrol Progress Gauge - SVG Gauge (Custom design) */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col items-center justify-between min-h-[320px]">
          <h2 className="text-base font-bold text-slate-800 self-start">เป้าหมายความปลอดภัยประมวลผล</h2>
          
          <div className="relative flex items-center justify-center my-4">
            <svg className="w-44 h-44 transform -rotate-90">
              {/* Background ring */}
              <circle
                cx="88"
                cy="88"
                r="74"
                className="stroke-slate-100 fill-transparent"
                strokeWidth="14"
              />
              {/* Foreground progress ring */}
              <circle
                cx="88"
                cy="88"
                r="74"
                className="stroke-blue-600 fill-transparent transition-all duration-1000 ease-out"
                strokeWidth="14"
                strokeDasharray={464}
                strokeDashoffset={464 - (464 * (data.patrolTotal ? data.patrolDone / data.patrolTotal : 0))}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center">
              <span className="text-4xl font-black text-slate-800">
                {Math.round((data.patrolTotal ? data.patrolDone / data.patrolTotal : 0) * 100)}%
              </span>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">Patrol Coverage</span>
            </div>
          </div>

          <p className="text-center text-xs text-slate-500 font-medium max-w-[220px]">
            {data.patrolTotal === 0 ? 'ยังไม่ได้กำหนดจุดตรวจสำหรับพื้นที่นี้'
              : data.patrolDone === data.patrolTotal
              ? '🎉 ยอดเยี่ยม! รปภ. เดินตรวจครบทุกจุดตรวจความเรียบร้อยครบ 100%' 
              : `เหลืออีกเพียง ${data.patrolPending} จุดตรวจ จะบรรลุเป้าหมายการเดินตรวจรอบปัจจุบัน`}
          </p>
        </div>

        {/* Recent Incidents and System Events */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between min-h-[320px]">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                รายงานเหตุด่วนผิดปกติล่าสุด (Incident Log)
              </h2>
              <button 
                onClick={() => onNavigate('incidents')} 
                className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
              >
                + แจ้งเหตุการณ์ใหม่
              </button>
            </div>

            {recentIncidents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 border border-dashed border-slate-200 rounded-xl">
                <ShieldCheck className="w-10 h-10 text-slate-300 mb-2" />
                <span className="text-sm font-medium">ยังไม่มีรายงานเหตุผิดปกติในวันนี้</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {recentIncidents.map((incident, idx) => (
                  <div 
                    key={incident.incident_id || idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all gap-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-lg shrink-0 mt-0.5 ${
                        incident.status === 'ปิดงานแล้ว' ? 'bg-slate-200 text-slate-600' : 'bg-red-50 text-red-600'
                      }`}>
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-800">{incident.incident_type}</span>
                          <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3" /> {formatTime(incident.incident_datetime)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-1">{incident.description}</p>
                        <span className="text-[11px] font-bold text-slate-600 block mt-1">📍 {incident.location}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-center">
                      {incident.photo_url && (
                        <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                          <AuthenticatedEvidenceImage
                            mediaReference={incident.photo_url}
                            alt={`หลักฐาน ${incident.incident_id || incident.incident_type || ''}`}
                            className="w-full h-full rounded-lg object-cover"
                          />
                        </div>
                      )}
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        incident.status === 'แจ้งแล้ว' ? 'bg-red-100 text-red-700' :
                        incident.status === 'กำลังดำเนินการ' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>
                        {incident.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-slate-100 mt-4">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              เวลาเซิร์ฟเวอร์เรียลไทม์: {formatThaiTime(new Date())}
            </span>
            <button 
              onClick={() => onNavigate('history')} 
              className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 hover:underline cursor-pointer"
            >
              ดูประวัติเดินตรวจย้อนหลังทั้งหมด
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Grid: Quick Actions Panel */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-800 mb-4">เมนูลัดสำหรับ รปภ. (Quick Guard Actions)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <button 
            id="qa-vehicle-in"
            onClick={() => onNavigate('vehicles')}
            className="flex flex-col items-center gap-2 p-4 border border-slate-100 bg-blue-50/40 hover:bg-blue-50 hover:border-blue-200 rounded-xl transition-all active:scale-95 text-center cursor-pointer"
          >
            <Car className="w-6 h-6 text-blue-600" />
            <span className="text-xs font-bold text-slate-700">รถเข้าอาคาร</span>
          </button>
          <button 
            id="qa-contractor-in"
            onClick={() => onNavigate('contractors')}
            className="flex flex-col items-center gap-2 p-4 border border-slate-100 bg-amber-50/40 hover:bg-amber-50 hover:border-amber-200 rounded-xl transition-all active:scale-95 text-center cursor-pointer"
          >
            <Users className="w-6 h-6 text-amber-600" />
            <span className="text-xs font-bold text-slate-700">ลงทะเบียนผู้รับเหมา</span>
          </button>
          <button 
            id="qa-key-out"
            onClick={() => onNavigate('keys')}
            className="flex flex-col items-center gap-2 p-4 border border-slate-100 bg-red-50/40 hover:bg-red-50 hover:border-red-200 rounded-xl transition-all active:scale-95 text-center cursor-pointer"
          >
            <Key className="w-6 h-6 text-red-600" />
            <span className="text-xs font-bold text-slate-700">เบิกกุญแจห้อง</span>
          </button>
          <button 
            id="qa-patrol-check"
            onClick={() => onNavigate('patrol')}
            className="flex flex-col items-center gap-2 p-4 border border-slate-100 bg-emerald-50/40 hover:bg-emerald-50 hover:border-emerald-200 rounded-xl transition-all active:scale-95 text-center cursor-pointer"
          >
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            <span className="text-xs font-bold text-slate-700">สแกนเดินตรวจ</span>
          </button>
          <button 
            id="qa-report-incident"
            onClick={() => onNavigate('incidents')}
            className="flex flex-col items-center gap-2 p-4 border border-slate-100 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 rounded-xl transition-all active:scale-95 text-center cursor-pointer"
          >
            <AlertTriangle className="w-6 h-6 text-slate-600" />
            <span className="text-xs font-bold text-slate-700">รายงานเหตุผิดปกติ</span>
          </button>
          <button 
            id="qa-search-history"
            onClick={() => onNavigate('history')}
            className="flex flex-col items-center gap-2 p-4 border border-slate-100 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 rounded-xl transition-all active:scale-95 text-center cursor-pointer"
          >
            <RefreshCw className="w-6 h-6 text-slate-600" />
            <span className="text-xs font-bold text-slate-700">ค้นหาประวัติ</span>
          </button>
        </div>
      </div>
    </div>
  );
}
