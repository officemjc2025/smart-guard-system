import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  Play,
  Pause,
  RotateCcw,
  Check,
  UserCheck,
  UserX,
  Tag,
  Calendar,
  MessageSquare,
  AlertTriangle,
  Clock,
  Car,
  Users,
  Key,
  MapPin,
  ClipboardList,
  AlertCircle,
  Loader2,
  Send,
  ArrowRight,
} from 'lucide-react';
import type {
  WorkItem,
  WorkItemActivity,
  WorkItemPriority,
  WorkSourceModule,
  AssigneeOption,
} from '../../services/workItemService';
import {
  acknowledgeWorkItem,
  startWorkItem,
  setWorkItemWaiting,
  resumeWorkItem,
  resolveWorkItem,
  reopenWorkItem,
  closeWorkItem,
  assignWorkItem,
  releaseWorkItem,
  setWorkItemPriority,
  setWorkItemDueDate,
  addWorkItemNote,
  listWorkItemActivities,
  listEligibleAssignees,
} from '../../services/workItemService';
import {
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_SOURCE_MODULE_LABELS,
  WORK_ACTIVITY_ACTION_LABELS,
  canAcknowledge,
  canStart,
  canSetWaiting,
  canResume,
  canResolve,
  canReopen,
  canClose,
  canAssign,
  canRelease,
  canChangePriority,
  canChangeDueDate,
  canAddNote,
  isItemOverdue,
  isSupervisor,
} from '../../services/workItemPolicy';
import { formatThaiDateTime } from '../../utils/dateTime';
import { Timestamp } from 'firebase/firestore';

interface WorkItemDetailDialogProps {
  item: WorkItem | null;
  isOpen: boolean;
  onClose: () => void;
  siteId: string;
  operatorUid: string;
  operatorName: string;
  role: string;
  onItemUpdated?: (updated: WorkItem) => void;
}

const sourceIconMap: Record<WorkSourceModule, React.ComponentType<{ className?: string }>> = {
  General: ClipboardList,
  Vehicle: Car,
  Contractor: Users,
  Key: Key,
  Patrol: MapPin,
  Incident: AlertTriangle,
};

export default function WorkItemDetailDialog({
  item,
  isOpen,
  onClose,
  siteId,
  operatorUid,
  operatorName,
  role,
  onItemUpdated,
}: WorkItemDetailDialogProps) {
  if (!isOpen || !item) return null;

  const [activities, setActivities] = useState<WorkItemActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal prompts for actions requiring reason / summary
  const [promptAction, setPromptAction] = useState<'Waiting' | 'Resolve' | 'Reopen' | null>(null);
  const [promptText, setPromptText] = useState('');

  // Assignee selection state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [eligibleAssignees, setEligibleAssignees] = useState<AssigneeOption[]>([]);
  const [selectedAssigneeUid, setSelectedAssigneeUid] = useState('');
  const [loadingAssignees, setLoadingAssignees] = useState(false);

  // Priority edit state
  const [showPriorityModal, setShowPriorityModal] = useState(false);
  const [selectedPriority, setSelectedPriority] = useState<WorkItemPriority>(item.priority);

  // Due date edit state
  const [showDueDateModal, setShowDueDateModal] = useState(false);
  const [dueDateValue, setDueDateValue] = useState('');

  // Fetch activities
  const loadActivities = async () => {
    setLoadingActivities(true);
    try {
      const list = await listWorkItemActivities(item.work_item_id);
      setActivities(list);
    } catch (err: any) {
      console.error('Error loading activities:', err);
    } finally {
      setLoadingActivities(false);
    }
  };

  useEffect(() => {
    loadActivities();
    setActionError(null);
    setNoteText('');
    setPromptAction(null);
    setPromptText('');
  }, [item.work_item_id, item.version]);

  // Load assignees when opening assign modal
  const handleOpenAssignModal = async () => {
    setShowAssignModal(true);
    setLoadingAssignees(true);
    setActionError(null);
    try {
      const list = await listEligibleAssignees(siteId);
      setEligibleAssignees(list);
      setSelectedAssigneeUid(item.assigned_to || (list[0]?.uid || ''));
    } catch (err: unknown) {
      console.error('Failed to load eligible assignees:', err);
      setActionError('ไม่สามารถโหลดรายชื่อผู้ปฏิบัติงานได้: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoadingAssignees(false);
    }
  };

  // Lifecycle Action Handlers
  const handleAcknowledge = async () => {
    if (busyAction) return;
    setBusyAction('Acknowledge');
    setActionError(null);
    try {
      const updated = await acknowledgeWorkItem(item.work_item_id, item.version);
      onItemUpdated?.(updated);
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'ไม่สามารถรับทราบงานได้');
    } finally {
      setBusyAction(null);
    }
  };

  const handleStart = async () => {
    if (busyAction) return;
    setBusyAction('Start');
    setActionError(null);
    try {
      const updated = await startWorkItem(item.work_item_id, item.version);
      onItemUpdated?.(updated);
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'ไม่สามารถเริ่มงานได้');
    } finally {
      setBusyAction(null);
    }
  };

  const handleResume = async () => {
    if (busyAction) return;
    setBusyAction('Resume');
    setActionError(null);
    try {
      const updated = await resumeWorkItem(item.work_item_id, item.version);
      onItemUpdated?.(updated);
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'ไม่สามารถดำเนินการต่อได้');
    } finally {
      setBusyAction(null);
    }
  };

  const handleClose = async () => {
    if (busyAction) return;
    setBusyAction('Close');
    setActionError(null);
    try {
      const updated = await closeWorkItem(item.work_item_id, item.version);
      onItemUpdated?.(updated);
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'ไม่สามารถปิดงานได้');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRelease = async () => {
    if (busyAction) return;
    setBusyAction('Release');
    setActionError(null);
    try {
      const updated = await releaseWorkItem(item.work_item_id, item.version);
      onItemUpdated?.(updated);
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'ไม่สามารถปลดการมอบหมายได้');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePromptSubmit = async () => {
    if (!promptText.trim() || busyAction) return;
    setBusyAction(promptAction);
    setActionError(null);
    try {
      let updated: WorkItem;
      if (promptAction === 'Waiting') {
        updated = await setWorkItemWaiting(item.work_item_id, promptText.trim(), item.version);
      } else if (promptAction === 'Resolve') {
        updated = await resolveWorkItem(item.work_item_id, promptText.trim(), item.version);
      } else if (promptAction === 'Reopen') {
        updated = await reopenWorkItem(item.work_item_id, promptText.trim(), item.version);
      } else {
        return;
      }
      onItemUpdated?.(updated);
      setPromptAction(null);
      setPromptText('');
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'การดำเนินการไม่สำเร็จ');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAssignSubmit = async () => {
    if (!selectedAssigneeUid || busyAction) return;
    setBusyAction('Assign');
    setActionError(null);
    try {
      const updated = await assignWorkItem(item.work_item_id, selectedAssigneeUid, item.version);
      onItemUpdated?.(updated);
      setShowAssignModal(false);
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'ไม่สามารถมอบหมายงานได้');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePrioritySubmit = async () => {
    if (!selectedPriority || busyAction) return;
    setBusyAction('Priority');
    setActionError(null);
    try {
      const updated = await setWorkItemPriority(item.work_item_id, selectedPriority, item.version);
      onItemUpdated?.(updated);
      setShowPriorityModal(false);
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'ไม่สามารถเปลี่ยนระดับความสำคัญได้');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDueDateSubmit = async () => {
    if (busyAction) return;
    setBusyAction('DueDate');
    setActionError(null);
    try {
      const targetDate = dueDateValue ? new Date(dueDateValue) : null;
      const ts = targetDate ? Timestamp.fromDate(targetDate) : null;
      const updated = await setWorkItemDueDate(item.work_item_id, ts, item.version);
      onItemUpdated?.(updated);
      setShowDueDateModal(false);
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'ไม่สามารถเปลี่ยนวันกำหนดส่งได้');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim() || busyAction) return;
    setBusyAction('Note');
    setActionError(null);
    try {
      const updated = await addWorkItemNote(item.work_item_id, noteText.trim(), item.version);
      onItemUpdated?.(updated);
      setNoteText('');
      await loadActivities();
    } catch (err: any) {
      setActionError(err.message || 'ไม่สามารถเพิ่มบันทึกข้อความได้');
    } finally {
      setBusyAction(null);
    }
  };

  const SourceIcon = sourceIconMap[item.source_module] || ClipboardList;
  const overdue = isItemOverdue(item);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto animate-fade-in">
      <div className="relative w-full max-w-3xl rounded-3xl border border-slate-700 bg-slate-900 text-white shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-800 p-5 sm:p-6 bg-slate-950/50 shrink-0">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-300">
                <SourceIcon className="h-3.5 w-3.5 text-blue-400" />
                {WORK_SOURCE_MODULE_LABELS[item.source_module]}
                {item.source_label && <span>• {item.source_label}</span>}
              </span>

              <span className="inline-flex items-center rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-bold text-blue-400">
                {WORK_ITEM_STATUS_LABELS[item.status]}
              </span>

              <span
                className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-bold ${
                  item.priority === 'Emergency'
                    ? 'border-red-600 bg-red-600 text-white font-black animate-pulse'
                    : item.priority === 'High'
                    ? 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                    : 'border-slate-700 bg-slate-800 text-slate-300'
                }`}
              >
                ระดับ: {WORK_ITEM_PRIORITY_LABELS[item.priority]}
              </span>

              {overdue && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/20 px-2.5 py-1 text-xs font-black text-red-300">
                  <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                  เกินกำหนด
                </span>
              )}
            </div>

            <h2 className="text-xl font-black text-white tracking-tight">
              {item.title}
            </h2>
            <span className="text-[11px] text-slate-400 font-mono">
              ID: {item.work_item_id} • Version: {item.version}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 text-slate-200 text-sm">
          {actionError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/15 p-4 text-xs font-bold text-red-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{actionError}</span>
            </div>
          )}

          {/* Action Toolbar */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">
              การดำเนินการตามขั้นตอน (Workflow Actions)
            </span>

            <div className="flex flex-wrap gap-2">
              {/* Acknowledge */}
              {canAcknowledge(role, item, operatorUid) && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={handleAcknowledge}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-bold text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busyAction === 'Acknowledge' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  รับทราบงาน (Acknowledge)
                </button>
              )}

              {/* Start */}
              {canStart(role, item, operatorUid) && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={handleStart}
                  className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 font-bold text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {busyAction === 'Start' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  เริ่มดำเนินการ (Start)
                </button>
              )}

              {/* Wait */}
              {canSetWaiting(role, item, operatorUid) && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => {
                    setPromptAction('Waiting');
                    setPromptText('');
                  }}
                  className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 font-bold text-xs text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  <Pause className="h-4 w-4" />
                  รอข้อมูลเพิ่มเติม (Wait)
                </button>
              )}

              {/* Resume */}
              {canResume(role, item, operatorUid) && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={handleResume}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 font-bold text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busyAction === 'Resume' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  ดำเนินการต่อ (Resume)
                </button>
              )}

              {/* Resolve */}
              {canResolve(role, item, operatorUid) && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => {
                    setPromptAction('Resolve');
                    setPromptText('');
                  }}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 font-bold text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  แก้ไขแล้วเสร็จ (Resolve)
                </button>
              )}

              {/* Reopen */}
              {canReopen(role, item) && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => {
                    setPromptAction('Reopen');
                    setPromptText('');
                  }}
                  className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 font-bold text-xs text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  เปิดงานอีกครั้ง (Reopen)
                </button>
              )}

              {/* Close */}
              {canClose(role, item) && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={handleClose}
                  className="flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 font-bold text-xs text-white hover:bg-slate-600 disabled:opacity-50"
                >
                  {busyAction === 'Close' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  ปิดงานสมบูรณ์ (Close)
                </button>
              )}

              {/* Assignment Controls (Supervisor) */}
              {canAssign(role, item) && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={handleOpenAssignModal}
                  className="flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2.5 font-bold text-xs text-slate-200 hover:bg-slate-700 hover:text-white disabled:opacity-50"
                >
                  <UserCheck className="h-4 w-4 text-blue-400" />
                  {item.assigned_to ? 'โอนย้ายผู้รับผิดชอบ' : 'มอบหมายงาน'}
                </button>
              )}

              {/* Release (Assignee or Supervisor) */}
              {canRelease(role, item, operatorUid) && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={handleRelease}
                  className="flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2.5 font-bold text-xs text-amber-400 hover:bg-slate-700 disabled:opacity-50"
                >
                  {busyAction === 'Release' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserX className="h-4 w-4" />
                  )}
                  ปลดการมอบหมาย
                </button>
              )}

              {/* Change Priority (Supervisor) */}
              {canChangePriority(role, item) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPriority(item.priority);
                    setShowPriorityModal(true);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-3.5 py-2.5 font-bold text-xs text-slate-300 hover:bg-slate-700"
                >
                  <Tag className="h-4 w-4 text-amber-400" />
                  เปลี่ยนความสำคัญ
                </button>
              )}

              {/* Change Due Date (Supervisor) */}
              {canChangeDueDate(role, item) && (
                <button
                  type="button"
                  onClick={() => {
                    setDueDateValue('');
                    setShowDueDateModal(true);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-slate-800 border border-slate-700 px-3.5 py-2.5 font-bold text-xs text-slate-300 hover:bg-slate-700"
                >
                  <Calendar className="h-4 w-4 text-blue-400" />
                  กำหนดส่งงาน
                </button>
              )}
            </div>
          </div>

          {/* Action prompt dialog inline if active */}
          {promptAction && (
            <div className="rounded-2xl border border-blue-500/40 bg-blue-950/40 p-4 space-y-3">
              <span className="text-xs font-black text-blue-300">
                {promptAction === 'Waiting' && 'ระบุเหตุผล / ข้อมูลที่ต้องรอเพิ่มเติม *'}
                {promptAction === 'Resolve' && 'สรุปผลการแก้ไขงาน / การดำเนินการแล้วเสร็จ *'}
                {promptAction === 'Reopen' && 'ระบุเหตุผลในการเปิดงานอีกครั้ง *'}
              </span>
              <textarea
                value={promptText}
                onChange={e => setPromptText(e.target.value)}
                placeholder="กรอกรายละเอียด..."
                rows={3}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white placeholder-slate-500 outline-hidden focus:border-blue-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPromptAction(null);
                    setPromptText('');
                  }}
                  className="rounded-xl px-4 py-2 text-xs font-bold text-slate-400 hover:bg-slate-800"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={!promptText.trim() || Boolean(busyAction)}
                  onClick={handlePromptSubmit}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busyAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  ยืนยัน
                </button>
              </div>
            </div>
          )}

          {/* Detail Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Description */}
            <div className="sm:col-span-2 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="text-xs font-bold text-slate-400 block mb-1">
                รายละเอียดงาน (Description)
              </span>
              <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                {item.description || 'ไม่มีรายละเอียดเพิ่มเติม'}
              </p>
            </div>

            {/* Next Action */}
            {item.next_action && (
              <div className="sm:col-span-2 rounded-2xl border border-blue-900/40 bg-blue-950/20 p-4">
                <span className="text-xs font-bold text-blue-400 block mb-1">
                  ขั้นตอนถัดไป (Next Action)
                </span>
                <p className="text-sm text-blue-200">{item.next_action}</p>
              </div>
            )}

            {/* Resolution Summary */}
            {item.resolution_summary && (
              <div className="sm:col-span-2 rounded-2xl border border-emerald-900/40 bg-emerald-950/20 p-4">
                <span className="text-xs font-bold text-emerald-400 block mb-1">
                  สรุปผลการแก้ไข (Resolution Summary)
                </span>
                <p className="text-sm text-emerald-200 whitespace-pre-wrap">
                  {item.resolution_summary}
                </p>
              </div>
            )}

            {/* Opened By */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="text-xs font-bold text-slate-400 block mb-1">ผู้เปิดงาน (Opened by)</span>
              <span className="font-semibold text-white">{item.opened_by_name || item.opened_by}</span>
            </div>

            {/* Assignee */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="text-xs font-bold text-slate-400 block mb-1">ผู้รับผิดชอบ (Assignee)</span>
              <span className="font-semibold text-white">
                {item.assigned_to || 'ยังไม่มอบหมาย'}
              </span>
            </div>

            {/* Due Date */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="text-xs font-bold text-slate-400 block mb-1">กำหนดส่งงาน (Due Date)</span>
              <span className={`font-semibold ${overdue ? 'text-red-400' : 'text-white'}`}>
                {item.due_at ? formatThaiDateTime(item.due_at) : 'ไม่ระบุ'}
              </span>
            </div>

            {/* Source Reference */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="text-xs font-bold text-slate-400 block mb-1">แหล่งข้อมูลอ้างอิง</span>
              <span className="font-semibold text-white">
                {WORK_SOURCE_MODULE_LABELS[item.source_module]}
                {item.source_record_id && ` (${item.source_record_id})`}
              </span>
            </div>
          </div>

          {/* Activity Timeline Section */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-black text-white">
                  ประวัติการดำเนินงาน (Activity Timeline)
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {activities.length} รายการ
              </span>
            </div>

            {loadingActivities ? (
              <div className="flex items-center justify-center py-6 text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                กำลังโหลดประวัติกิจกรรม...
              </div>
            ) : activities.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500">
                ไม่มีประวัติการดำเนินงาน
              </div>
            ) : (
              <div className="relative pl-6 space-y-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {activities.map(act => (
                  <div key={act.activity_id} className="relative group">
                    {/* Timeline dot */}
                    <div className="absolute -left-6 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-slate-900 bg-blue-500" />

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-blue-300">
                        {WORK_ACTIVITY_ACTION_LABELS[act.action] || act.action}
                      </span>
                      <span className="text-xs font-bold text-white">
                        {act.actor_name}
                      </span>
                      <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                        {act.actor_role}
                      </span>
                      <span className="text-[11px] text-slate-500 ml-auto">
                        {formatThaiDateTime(act.created_at)}
                      </span>
                    </div>

                    {act.from_status !== act.to_status && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                        <span>{WORK_ITEM_STATUS_LABELS[act.from_status as keyof typeof WORK_ITEM_STATUS_LABELS] || act.from_status || 'เริ่มต้น'}</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className="font-bold text-white">
                          {WORK_ITEM_STATUS_LABELS[act.to_status as keyof typeof WORK_ITEM_STATUS_LABELS] || act.to_status}
                        </span>
                      </div>
                    )}

                    {act.note && (
                      <div className="mt-2 rounded-xl bg-slate-900 border border-slate-800 p-3 text-xs text-slate-300 whitespace-pre-wrap">
                        {act.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add Note Input Area */}
            {canAddNote(role, item, operatorUid) && (
              <form onSubmit={handleAddNoteSubmit} className="pt-3 border-t border-slate-800 flex flex-col gap-2">
                <span className="text-xs font-bold text-slate-400">
                  เพิ่มบันทึกข้อความ / ความคืบหน้า
                </span>
                <div className="flex gap-2">
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder="พิมพ์ข้อความบันทึกความคืบหน้า..."
                    rows={2}
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-white placeholder-slate-500 outline-hidden focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={!noteText.trim() || Boolean(busyAction)}
                    className="self-end rounded-xl bg-blue-600 px-4 py-3 font-bold text-xs text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    {busyAction === 'Note' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    ส่ง
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-800 bg-slate-950/80 p-4 px-6 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 hover:bg-slate-700 px-5 py-2.5 text-xs font-bold text-white transition-colors"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>

      {/* Sub-modal: Assignee Selector */}
      {showAssignModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl space-y-4">
            <h3 className="text-base font-black text-white">มอบหมาย / โอนย้ายผู้รับผิดชอบ</h3>
            {loadingAssignees ? (
              <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                กำลังโหลดรายชื่อเจ้าหน้าที่...
              </div>
            ) : (
              <div className="space-y-3">
                <label className="text-xs text-slate-400 block">เลือกเจ้าหน้าที่ในสังกัด:</label>
                <select
                  value={selectedAssigneeUid}
                  onChange={e => setSelectedAssigneeUid(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white outline-hidden"
                >
                  <option value="">-- เลือกเจ้าหน้าที่ --</option>
                  {eligibleAssignees.map(a => (
                    <option key={a.uid} value={a.uid}>
                      {a.name} ({a.role})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-400 hover:bg-slate-800"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={!selectedAssigneeUid || Boolean(busyAction)}
                onClick={handleAssignSubmit}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busyAction === 'Assign' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันการมอบหมาย'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-modal: Priority Selector */}
      {showPriorityModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl space-y-4">
            <h3 className="text-base font-black text-white">เปลี่ยนระดับความสำคัญ</h3>
            <select
              value={selectedPriority}
              onChange={e => setSelectedPriority(e.target.value as WorkItemPriority)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white outline-hidden"
            >
              <option value="Low">ต่ำ (Low)</option>
              <option value="Normal">ปกติ (Normal)</option>
              <option value="High">สูง (High)</option>
              <option value="Emergency">ฉุกเฉิน (Emergency)</option>
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPriorityModal(false)}
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-400 hover:bg-slate-800"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={handlePrioritySubmit}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busyAction === 'Priority' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-modal: Due Date Selector */}
      {showDueDateModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl space-y-4">
            <h3 className="text-base font-black text-white">กำหนดวันส่งงาน</h3>
            <input
              type="datetime-local"
              value={dueDateValue}
              onChange={e => setDueDateValue(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white outline-hidden"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDueDateModal(false)}
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-400 hover:bg-slate-800"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={handleDueDateSubmit}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busyAction === 'DueDate' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกกำหนดส่ง'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
