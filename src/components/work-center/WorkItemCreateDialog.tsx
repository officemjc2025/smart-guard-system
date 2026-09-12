import React, { useState, useEffect } from 'react';
import {
  X,
  PlusCircle,
  AlertTriangle,
  Loader2,
  Calendar,
  User,
  Tag,
  ClipboardList,
  Car,
  Users,
  Key,
  MapPin,
  CheckCircle2,
} from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import type {
  WorkItem,
  WorkItemPriority,
  WorkSourceModule,
  AssigneeOption,
} from '../../services/workItemService';
import {
  createWorkItem,
  listEligibleAssignees,
} from '../../services/workItemService';
import {
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_SOURCE_MODULE_LABELS,
  isSupervisor,
  findDuplicateActiveWorkItem,
  CANONICAL_WORK_ITEM_ROLES,
} from '../../services/workItemPolicy';

interface WorkItemCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  siteId: string;
  operatorUid: string;
  operatorName: string;
  role: string;
  existingItems?: WorkItem[];
  defaultSourceModule?: WorkSourceModule;
  defaultSourceRecordId?: string;
  defaultSourceLabel?: string;
  defaultTitle?: string;
  defaultDescription?: string;
  defaultPriority?: WorkItemPriority;
  lockSourceContext?: boolean;
  onItemCreated?: (createdId: string) => void;
}

const sourceOptions: WorkSourceModule[] = [
  'General',
  'Vehicle',
  'Contractor',
  'Key',
  'Patrol',
  'Incident',
];

const priorityOptions: WorkItemPriority[] = ['Low', 'Normal', 'High', 'Emergency'];

export default function WorkItemCreateDialog({
  isOpen,
  onClose,
  siteId,
  operatorUid,
  operatorName,
  role,
  existingItems = [],
  defaultSourceModule = 'General',
  defaultSourceRecordId = '',
  defaultSourceLabel = '',
  defaultTitle = '',
  defaultDescription = '',
  defaultPriority = 'Normal',
  lockSourceContext = false,
  onItemCreated,
}: WorkItemCreateDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [sourceModule, setSourceModule] = useState<WorkSourceModule>(defaultSourceModule);
  const [sourceRecordId, setSourceRecordId] = useState(defaultSourceRecordId);
  const [sourceLabel, setSourceLabel] = useState(defaultSourceLabel);
  const [priority, setPriority] = useState<WorkItemPriority>(defaultPriority);
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [nextAction, setNextAction] = useState('');
  const [dueAtStr, setDueAtStr] = useState('');

  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveRole = CANONICAL_WORK_ITEM_ROLES.includes(role as any) ? role : 'Guard';
  const effectiveOperatorName = operatorName || sessionStorage.getItem('selected_operator_name') || 'ผู้ปฏิบัติงาน';
  const supervisor = isSupervisor(effectiveRole);

  // Initialize or reset defaults when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTitle(defaultTitle);
      setDescription(defaultDescription);
      setSourceModule(defaultSourceModule);
      setSourceRecordId(defaultSourceRecordId);
      setSourceLabel(defaultSourceLabel);
      setPriority(defaultPriority);
      setAssignedTo('');
      setNextAction('');
      setDueAtStr('');
      setErrorMsg(null);
    }
  }, [isOpen, defaultTitle, defaultDescription, defaultSourceModule, defaultSourceRecordId, defaultSourceLabel, defaultPriority]);

  // Load eligible assignees only if supervisor
  useEffect(() => {
    if (isOpen && siteId && supervisor) {
      listEligibleAssignees(siteId)
        .then(opts => setAssigneeOptions(opts))
        .catch(err => {
          console.warn('Failed to load assignees:', err);
          setErrorMsg('ไม่สามารถโหลดรายชื่อผู้ปฏิบัติงานได้: ' + (err instanceof Error ? err.message : String(err)));
        });
    }
  }, [isOpen, siteId, supervisor]);

  if (!isOpen) return null;

  // Check duplicate active work item
  const duplicateActiveItem =
    (lockSourceContext ? defaultSourceModule : sourceModule) !== 'General' && (lockSourceContext ? defaultSourceRecordId : sourceRecordId).trim()
      ? findDuplicateActiveWorkItem(
          existingItems,
          lockSourceContext ? defaultSourceModule : sourceModule,
          (lockSourceContext ? defaultSourceRecordId : sourceRecordId).trim()
        )
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('กรุณาระบุชื่องาน / หัวข้องาน');
      return;
    }
    if (title.trim().length > 256) {
      setErrorMsg('ชื่องานต้องมีความยาวไม่เกิน 256 ตัวอักษร');
      return;
    }
    if (description.trim().length > 5000) {
      setErrorMsg('รายละเอียดต้องมีความยาวไม่เกิน 5,000 ตัวอักษร');
      return;
    }

    if (priority === 'Emergency' && !supervisor) {
      setErrorMsg('เฉพาะหัวหน้ากะหรือผู้จัดการเท่านั้นที่สามารถสร้างงานระดับฉุกเฉินได้');
      return;
    }

    if (assignedTo && assignedTo !== operatorUid && !supervisor) {
      setErrorMsg('เจ้าหน้าที่ทั่วไปสามารถมอบหมายงานให้ตนเองได้เท่านั้น');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      let dueAtTimestamp: Timestamp | null = null;
      if (dueAtStr) {
        const parsed = new Date(dueAtStr);
        if (!isNaN(parsed.getTime())) {
          dueAtTimestamp = Timestamp.fromDate(parsed);
        }
      }

      const effectiveSourceModule = lockSourceContext ? defaultSourceModule : sourceModule;
      const effectiveSourceRecordId = lockSourceContext
        ? (defaultSourceModule === 'General' ? '' : defaultSourceRecordId.trim())
        : (sourceModule === 'General' ? '' : sourceRecordId.trim());
      const effectiveSourceLabel = lockSourceContext ? defaultSourceLabel.trim() : sourceLabel.trim();

      const createdId = await createWorkItem({
        siteId,
        sourceModule: effectiveSourceModule,
        sourceRecordId: effectiveSourceRecordId,
        sourceLabel: effectiveSourceLabel,
        title: title.trim(),
        description: description.trim(),
        priority,
        assignedTo: assignedTo || undefined,
        nextAction: nextAction.trim() || undefined,
        dueAt: dueAtTimestamp,
      });

      if (onItemCreated) {
        onItemCreated(createdId);
      }
      onClose();
    } catch (err: unknown) {
      console.error('Failed to create work item:', err);
      setErrorMsg('ไม่สามารถสร้างงานติดตามได้ กรุณาตรวจสอบข้อมูลและลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-work-item-title"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-scale-up">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="create-work-item-title" className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">
                สร้างงานติดตามใหม่
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                สร้างรายการงานติดตามในศูนย์ประสานงาน (Work Center)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2.5 text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
              <div className="flex-1">{errorMsg}</div>
            </div>
          )}

          {/* Duplicate active item warning banner */}
          {duplicateActiveItem && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 flex items-start gap-2.5 text-xs sm:text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
              <div>
                <span className="font-semibold">พบงานติดตามที่ยังเปิดอยู่สำหรับรายการนี้:</span>{' '}
                <span className="underline font-medium">{duplicateActiveItem.title}</span> (สถานะ:{' '}
                <span className="font-bold">{WORK_ITEM_STATUS_LABELS[duplicateActiveItem.status]}</span>)
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  ระบบอนุญาตให้สร้างได้ แต่โปรดตรวจสอบว่าจำเป็นต้องสร้างงานติดตามซ้ำหรือไม่
                </p>
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              ชื่องาน / หัวข้องาน <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={256}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="เช่น ติดตามแลกบัตรเกิน 24 ชม., กุญแจห้องเซิร์ฟเวอร์ยังไม่คืน"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="text-right text-[11px] text-slate-400 mt-1">
              {title.length}/256 ตัวอักษร
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              รายละเอียดงาน
            </label>
            <textarea
              rows={3}
              maxLength={5000}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="ระบุข้อมูลเพิ่มเติมเกี่ยวกับสิ่งที่ต้องดำเนินการ, เบอร์ติดต่อ, หรือจุดสังเกต"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Source Module & Context */}
          {lockSourceContext ? (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  ข้อมูลต้นทาง (Source Context)
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  🔒 เชื่อมโยงกับบันทึกต้นทาง
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] text-slate-400 block font-semibold mb-0.5">โมดูล</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {WORK_SOURCE_MODULE_LABELS[defaultSourceModule] || defaultSourceModule}
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] text-slate-400 block font-semibold mb-0.5">รหัสบันทึก</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                    {defaultSourceRecordId || '—'}
                  </span>
                </div>
              </div>
              {defaultSourceLabel && (
                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                  <span className="text-[10px] text-slate-400 block font-semibold mb-0.5">ป้ายกำกับ / อ้างอิง</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{defaultSourceLabel}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  โมดูลที่มา (Source Module)
                </label>
                <select
                  value={sourceModule}
                  onChange={e => setSourceModule(e.target.value as WorkSourceModule)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {sourceOptions.map(opt => (
                    <option key={opt} value={opt}>
                      {WORK_SOURCE_MODULE_LABELS[opt]}
                    </option>
                  ))}
                </select>
              </div>

              {sourceModule !== 'General' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    ป้ายกำกับ / อ้างอิง (Label)
                  </label>
                  <input
                    type="text"
                    value={sourceLabel}
                    onChange={e => setSourceLabel(e.target.value)}
                    placeholder="เช่น ทะเบียน 1กข 1234, ช่างแอร์"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    ป้ายกำกับทั่วไป (ไม่บังคับ)
                  </label>
                  <input
                    type="text"
                    value={sourceLabel}
                    onChange={e => setSourceLabel(e.target.value)}
                    placeholder="เช่น ตรวจตราพิเศษรอบดึก"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {sourceModule !== 'General' && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    รหัสบันทึกต้นทาง (Source Record ID)
                  </label>
                  <input
                    type="text"
                    value={sourceRecordId}
                    onChange={e => setSourceRecordId(e.target.value)}
                    placeholder="เช่น veh_12345, contractor_67890 (ถ้ามี)"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
          )}

          {/* Priority & Assignee Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Priority */}
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                ระดับความสำคัญ (Priority)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {priorityOptions.map(p => {
                  const isEmergency = p === 'Emergency';
                  const disabled = isEmergency && !supervisor;
                  const isSelected = priority === p;

                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={disabled}
                      onClick={() => setPriority(p)}
                      title={disabled ? 'เฉพาะหัวหน้ากะ/ผู้จัดการ' : undefined}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all ${
                        disabled
                          ? 'opacity-40 cursor-not-allowed bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                          : isSelected
                          ? p === 'Emergency'
                            ? 'bg-red-500 text-white border-red-500 shadow-sm'
                            : p === 'High'
                            ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                            : p === 'Low'
                            ? 'bg-slate-600 text-white border-slate-600 shadow-sm'
                            : 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {WORK_ITEM_PRIORITY_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Assignee */}
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                มอบหมายให้ (Assignee)
              </label>
              {supervisor ? (
                <select
                  value={assignedTo}
                  onChange={e => setAssignedTo(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- ยังไม่มอบหมาย (Unassigned) --</option>
                  <option value={operatorUid}>ตนเอง ({effectiveOperatorName})</option>
                  {assigneeOptions
                    .filter(opt => opt.uid !== operatorUid)
                    .map(opt => (
                      <option key={opt.uid} value={opt.uid}>
                        {opt.name} ({opt.role})
                      </option>
                    ))}
                </select>
              ) : (
                <div className="space-y-1.5">
                  <select
                    value={assignedTo}
                    onChange={e => setAssignedTo(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- ยังไม่มอบหมาย --</option>
                    <option value={operatorUid}>รับมอบหมายให้ตนเอง ({effectiveOperatorName})</option>
                  </select>
                  <p className="text-[11px] text-slate-400">
                    * เจ้าหน้าที่ทั่วไปสามารถรับงานให้ตนเอง หรือปล่อยว่างไว้ให้หัวหน้ากะมอบหมาย
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Next Action & Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                การดำเนินการถัดไป (Next Action)
              </label>
              <input
                type="text"
                maxLength={500}
                value={nextAction}
                onChange={e => setNextAction(e.target.value)}
                placeholder="เช่น โทรติดต่อเจ้าของบ้าน, ไปตรวจจุดเกิดเหตุ"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                กำหนดส่ง / กำหนดเสร็จ (Due Date)
              </label>
              <input
                type="datetime-local"
                value={dueAtStr}
                onChange={e => setDueAtStr(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Footer buttons */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm hover:shadow transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>กำลังสร้างงาน...</span>
                </>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4" />
                  <span>สร้างงานติดตาม</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
