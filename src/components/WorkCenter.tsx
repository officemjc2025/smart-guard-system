import React, { useState, useEffect, useMemo } from 'react';
import {
  ClipboardList,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  Clock,
  UserCheck,
  CheckCircle2,
  Inbox,
  Loader2,
  RefreshCw,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
} from 'lucide-react';
import type {
  WorkItem,
  WorkItemPriority,
  WorkSourceModule,
} from '../services/workItemService';
import { subscribeWorkItems } from '../services/workItemService';
import {
  calculateWorkCenterKpis,
  filterWorkItems,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_SOURCE_MODULE_LABELS,
  isSupervisor,
} from '../services/workItemPolicy';
import WorkItemCard from './work-center/WorkItemCard';
import WorkItemDetailDialog from './work-center/WorkItemDetailDialog';
import WorkItemCreateDialog from './work-center/WorkItemCreateDialog';

export type WorkCenterTab =
  | 'all'
  | 'mine'
  | 'unassigned'
  | 'inProgress'
  | 'waiting'
  | 'overdue'
  | 'completed';

interface WorkCenterProps {
  siteId: string;
  operatorUid: string;
  operatorName: string;
  role: string;
  onNavigate?: (tab: string) => void;
  initialSelectedItemId?: string;
  onClearInitialSelectedItemId?: () => void;
}

export default function WorkCenter({
  siteId,
  operatorUid,
  operatorName,
  role,
  onNavigate,
  initialSelectedItemId,
  onClearInitialSelectedItemId,
}: WorkCenterProps) {
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [activeTab, setActiveTab] = useState<WorkCenterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<WorkItemPriority | 'All'>('All');
  const [sourceFilter, setSourceFilter] = useState<WorkSourceModule | 'All'>('All');

  // Dialogs state
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Deep focus initialSelectedItemId
  useEffect(() => {
    if (!initialSelectedItemId || workItems.length === 0) return;
    const target = workItems.find(i => i.work_item_id === initialSelectedItemId);
    if (target) {
      setSelectedItem(target);
      setIsDetailOpen(true);
    }
  }, [initialSelectedItemId, workItems]);

  // Realtime subscription
  useEffect(() => {
    if (!siteId) return;

    setIsLoading(true);
    setError(null);

    const unsubscribe = subscribeWorkItems(
      siteId,
      items => {
        setWorkItems(items);
        setIsLoading(false);

        // If a detail modal is open, keep selectedItem updated
        setSelectedItem(prev => {
          if (!prev) return null;
          return items.find(i => i.work_item_id === prev.work_item_id) || prev;
        });
      },
      undefined,
      err => {
        console.error('WorkItems subscription error:', err);
        setError('ไม่สามารถโหลดงานติดตามได้ กรุณาลองใหม่อีกครั้ง');
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [siteId]);

  // KPIs
  const kpis = useMemo(() => {
    return calculateWorkCenterKpis(workItems, operatorUid);
  }, [workItems, operatorUid]);

  // Filtered items
  const displayedItems = useMemo(() => {
    return filterWorkItems(workItems, activeTab, operatorUid, {
      searchTerm: searchQuery,
      priorityFilter: priorityFilter === 'All' ? 'ALL' : priorityFilter,
      sourceModuleFilter: sourceFilter === 'All' ? 'ALL' : sourceFilter,
    });
  }, [workItems, activeTab, operatorUid, searchQuery, priorityFilter, sourceFilter]);

  const handleCardClick = (item: WorkItem) => {
    setSelectedItem(item);
    setIsDetailOpen(true);
  };

  const handleItemUpdated = (updated: WorkItem) => {
    setWorkItems(prev =>
      prev.map(i => (i.work_item_id === updated.work_item_id ? updated : i))
    );
    setSelectedItem(updated);
  };

  const supervisor = isSupervisor(role);

  return (
    <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-indigo-700/50 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 p-4 sm:p-5 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30 border border-blue-400/30 shrink-0">
            <ClipboardList className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                งานติดตาม (Work Center)
              </h1>
              {supervisor && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white/10 text-indigo-100 border border-indigo-300/40">
                  สิทธิ์ผู้ดูแล
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm font-medium text-slate-200 mt-0.5">
              ศูนย์ประสานงานและติดตามสถานะงานทุกโมดูลแบบ Real-time
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-sm font-semibold shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>สร้างงานติดตามใหม่</span>
        </button>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3.5">
        <button
          onClick={() => setActiveTab('all')}
          className={`p-3 sm:p-3.5 rounded-2xl border text-left transition-all min-h-[76px] flex flex-col justify-between ${
            activeTab === 'all'
              ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-700 shadow-sm'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">งานเปิดทั้งหมด</span>
            <Inbox className="w-4 h-4 text-blue-500 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-slate-100">
            {kpis.openCount}
          </div>
        </button>

        <button
          onClick={() => setActiveTab('mine')}
          className={`p-3 sm:p-3.5 rounded-2xl border text-left transition-all min-h-[76px] flex flex-col justify-between ${
            activeTab === 'mine'
              ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-400 dark:border-indigo-700 shadow-sm'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">งานของฉัน</span>
            <UserCheck className="w-4 h-4 text-indigo-500 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {kpis.myCount}
          </div>
        </button>

        <button
          onClick={() => setActiveTab('unassigned')}
          className={`p-3 sm:p-3.5 rounded-2xl border text-left transition-all min-h-[76px] flex flex-col justify-between ${
            activeTab === 'unassigned'
              ? 'bg-purple-50 dark:bg-purple-950/40 border-purple-400 dark:border-purple-700 shadow-sm'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">ยังไม่มอบหมาย</span>
            <HelpCircle className="w-4 h-4 text-purple-500 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-purple-600 dark:text-purple-400">
            {kpis.unassignedCount}
          </div>
        </button>

        <button
          onClick={() => setActiveTab('inProgress')}
          className={`p-3 sm:p-3.5 rounded-2xl border text-left transition-all min-h-[76px] flex flex-col justify-between ${
            activeTab === 'inProgress'
              ? 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-400 dark:border-cyan-700 shadow-sm'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">กำลังทำ / รอ</span>
            <Clock className="w-4 h-4 text-cyan-500 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-cyan-600 dark:text-cyan-400">
            {kpis.inProgressCount + kpis.waitingCount}
          </div>
        </button>

        <button
          onClick={() => setActiveTab('overdue')}
          className={`p-3 sm:p-3.5 rounded-2xl border text-left transition-all min-h-[76px] flex flex-col justify-between ${
            activeTab === 'overdue'
              ? 'bg-red-50 dark:bg-red-950/40 border-red-400 dark:border-red-700 shadow-sm'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">เกินกำหนด</span>
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-red-600 dark:text-red-400">
            {kpis.overdueCount}
          </div>
        </button>

        <button
          onClick={() => setActiveTab('completed')}
          className={`p-3 sm:p-3.5 rounded-2xl border text-left transition-all min-h-[76px] flex flex-col justify-between ${
            activeTab === 'completed'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-700 shadow-sm'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 mb-1">
            <span className="text-xs font-medium">เสร็จสิ้นแล้ว</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {kpis.completedCount}
          </div>
        </button>
      </div>

      {/* Main Tab Strip with Mobile Scroll Discoverability Cue */}
      <div className="relative -mx-3 sm:mx-0">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-none border-b border-slate-200 dark:border-slate-800 px-3 sm:px-0 pr-9 sm:pr-0">
          {[
            { id: 'all', label: 'ทั้งหมด', count: kpis.openCount },
            { id: 'mine', label: 'งานของฉัน', count: kpis.myCount },
            { id: 'unassigned', label: 'ยังไม่มอบหมาย', count: kpis.unassignedCount },
            { id: 'inProgress', label: 'กำลังดำเนินการ', count: kpis.inProgressCount },
            { id: 'waiting', label: 'รอข้อมูล', count: kpis.waitingCount },
            { id: 'overdue', label: 'เกินกำหนด', count: kpis.overdueCount, alert: kpis.overdueCount > 0 },
            { id: 'completed', label: 'เสร็จสิ้น / ประวัติ', count: kpis.completedCount },
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as WorkCenterTab)}
                className={`px-3.5 py-2.5 min-h-[40px] rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      isActive
                        ? 'bg-white/20 dark:bg-slate-800/20 text-white dark:text-slate-900'
                        : tab.alert
                        ? 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Subtle Right Edge Fade Indicator showing scrollability on mobile */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 bottom-1.5 w-8 bg-gradient-to-l from-slate-50 via-slate-50/80 to-transparent dark:from-slate-900 dark:via-slate-900/80 sm:hidden"
        />
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="ค้นหาตามชื่องาน, รายละเอียด, ป้ายกำกับ, ผู้สร้าง..."
            className="w-full pl-9.5 pr-3.5 py-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 shrink-0">
          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value as WorkItemPriority | 'All')}
            className="w-full sm:w-auto px-3 py-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="All">ความสำคัญทั้งหมด</option>
            <option value="Emergency">🚨 ฉุกเฉิน</option>
            <option value="High">🔴 สูง</option>
            <option value="Normal">🔵 ปกติ</option>
            <option value="Low">⚪ ต่ำ</option>
          </select>

          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value as WorkSourceModule | 'All')}
            className="w-full sm:w-auto px-3 py-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="All">โมดูลทั้งหมด</option>
            <option value="General">งานทั่วไป</option>
            <option value="Vehicle">ยานพาหนะ</option>
            <option value="Contractor">ผู้รับเหมา</option>
            <option value="Key">กุญแจ</option>
            <option value="Patrol">ตรวจการณ์</option>
            <option value="Incident">เหตุการณ์</option>
          </select>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {/* Main Content Area */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-sm font-medium">กำลังโหลดรายการงานติดตาม...</p>
        </div>
      ) : displayedItems.length === 0 ? (
        <div className="py-16 px-4 rounded-3xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center space-y-3">
          <div className="p-3.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">
            <Inbox className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
              ไม่พบรายการงานติดตาม
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-sm">
              {searchQuery || priorityFilter !== 'All' || sourceFilter !== 'All'
                ? 'ลองปรับเปลี่ยนคำค้นหาหรือตัวกรองเพื่อค้นหารายการที่ต้องการ'
                : activeTab === 'mine'
                ? 'คุณยังไม่มีงานที่ได้รับมอบหมายในขณะนี้'
                : 'ยังไม่มีรายการงานติดตามในหมวดหมู่นี้'}
            </p>
          </div>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="mt-2 px-4 py-2 min-h-[44px] rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60 text-xs sm:text-sm font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors cursor-pointer"
          >
            สร้างงานติดตามใหม่
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3.5 sm:gap-4">
          {displayedItems.map(item => (
            <WorkItemCard
              key={item.work_item_id}
              item={item}
              onClick={() => handleCardClick(item)}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <WorkItemCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        siteId={siteId}
        operatorUid={operatorUid}
        operatorName={operatorName}
        role={role}
        existingItems={workItems}
        onItemCreated={newId => {
          console.log('Work Item created with ID:', newId);
        }}
      />

      {/* Detail Dialog */}
      <WorkItemDetailDialog
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedItem(null);
          onClearInitialSelectedItemId?.();
        }}
        item={selectedItem}
        siteId={siteId}
        operatorUid={operatorUid}
        operatorName={operatorName}
        role={role}
        onItemUpdated={handleItemUpdated}
      />
    </div>
  );
}
