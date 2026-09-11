import type {
  WorkItem,
  WorkItemStatus,
  WorkItemPriority,
  WorkSourceModule,
  WorkActivityAction,
} from './workItemService';

export type WorkCenterView =
  | 'all'
  | 'mine'
  | 'unassigned'
  | 'inProgress'
  | 'waiting'
  | 'overdue'
  | 'completed';

export interface WorkCenterKpis {
  openCount: number;
  myCount: number;
  urgentCount: number;
  overdueCount: number;
  unassignedCount: number;
  inProgressCount: number;
  waitingCount: number;
  completedCount: number;
  totalCount: number;
}

export const WORK_ITEM_STATUS_LABELS: Record<WorkItemStatus, string> = {
  Open: 'เปิดงาน',
  Acknowledged: 'รับทราบ',
  InProgress: 'กำลังดำเนินการ',
  Waiting: 'รอข้อมูล',
  Resolved: 'แก้ไขแล้ว',
  Closed: 'ปิดงาน',
};

export const WORK_ITEM_PRIORITY_LABELS: Record<WorkItemPriority, string> = {
  Low: 'ต่ำ',
  Normal: 'ปกติ',
  High: 'สูง',
  Emergency: 'ฉุกเฉิน',
};

export const WORK_SOURCE_MODULE_LABELS: Record<WorkSourceModule, string> = {
  General: 'งานทั่วไป',
  Vehicle: 'ยานพาหนะ',
  Contractor: 'ช่างรับเหมา',
  Key: 'กุญแจ',
  Patrol: 'เดินตรวจ',
  Incident: 'แจ้งเหตุ',
};

export const WORK_ACTIVITY_ACTION_LABELS: Record<WorkActivityAction, string> = {
  Created: 'สร้างงานติดตาม',
  Acknowledged: 'รับทราบงาน',
  Started: 'เริ่มดำเนินการ',
  Waiting: 'รอข้อมูลเพิ่มเติม',
  Resumed: 'ดำเนินการต่อ',
  Assigned: 'มอบหมายงาน',
  Transferred: 'โอนย้ายผู้รับผิดชอบ',
  Released: 'ปลดการมอบหมาย',
  PriorityChanged: 'เปลี่ยนระดับความสำคัญ',
  DueDateChanged: 'เปลี่ยนวันกำหนดส่ง',
  NoteAdded: 'เพิ่มบันทึกข้อความ',
  Resolved: 'แก้ไขแล้วเสร็จ',
  Reopened: 'เปิดงานอีกครั้ง',
  Closed: 'ปิดงานสมบูรณ์',
};

export function isSupervisor(role: string): boolean {
  return ['ShiftHead', 'Manager', 'Admin'].includes(role);
}

export function isAllowedWorkItemTransition(
  from: WorkItemStatus,
  to: WorkItemStatus,
  role: string,
  resolutionSummary = ''
): boolean {
  const normal =
    (from === 'Open' && to === 'Acknowledged') ||
    (from === 'Acknowledged' && to === 'InProgress') ||
    (from === 'InProgress' && ['Waiting', 'Resolved'].includes(to)) ||
    (from === 'Waiting' && to === 'InProgress') ||
    (from === 'Resolved' && to === 'Closed');
  const reopen = from === 'Resolved' && to === 'InProgress' && isSupervisor(role);
  return (normal || reopen) && (to !== 'Resolved' || Boolean(resolutionSummary.trim()));
}

export function canAcknowledge(role: string, item: Pick<WorkItem, 'status' | 'assigned_to'>, uid: string): boolean {
  if (item.status !== 'Open') return false;
  return !item.assigned_to || item.assigned_to === uid || isSupervisor(role);
}

export function canStart(role: string, item: Pick<WorkItem, 'status' | 'assigned_to'>, uid: string): boolean {
  if (item.status !== 'Acknowledged') return false;
  return item.assigned_to === uid || isSupervisor(role);
}

export function canSetWaiting(role: string, item: Pick<WorkItem, 'status' | 'assigned_to'>, uid: string): boolean {
  if (item.status !== 'InProgress') return false;
  return item.assigned_to === uid || isSupervisor(role);
}

export function canResume(role: string, item: Pick<WorkItem, 'status' | 'assigned_to'>, uid: string): boolean {
  if (item.status !== 'Waiting') return false;
  return item.assigned_to === uid || isSupervisor(role);
}

export function canResolve(role: string, item: Pick<WorkItem, 'status' | 'assigned_to'>, uid: string): boolean {
  if (item.status !== 'InProgress') return false;
  return item.assigned_to === uid || isSupervisor(role);
}

export function canReopen(role: string, item: Pick<WorkItem, 'status'>): boolean {
  if (item.status !== 'Resolved') return false;
  return isSupervisor(role);
}

export function canClose(role: string, item: Pick<WorkItem, 'status'>): boolean {
  if (item.status !== 'Resolved') return false;
  return isSupervisor(role);
}

export function canAssign(role: string, item: Pick<WorkItem, 'status'>): boolean {
  if (item.status === 'Closed') return false;
  return isSupervisor(role);
}

export function canRelease(role: string, item: Pick<WorkItem, 'status' | 'assigned_to'>, uid: string): boolean {
  if (!item.assigned_to || item.status === 'Closed') return false;
  return item.assigned_to === uid || isSupervisor(role);
}

export function canChangePriority(role: string, item: Pick<WorkItem, 'status'>): boolean {
  if (item.status === 'Closed') return false;
  return isSupervisor(role);
}

export function canChangeDueDate(role: string, item: Pick<WorkItem, 'status'>): boolean {
  if (item.status === 'Closed') return false;
  return isSupervisor(role);
}

export function canAddNote(role: string, item: Pick<WorkItem, 'status' | 'assigned_to'>, uid: string): boolean {
  if (item.status === 'Closed') return false;
  return item.assigned_to === uid || isSupervisor(role);
}

export const isWorkItemCompleted = (status: WorkItemStatus): boolean =>
  ['Resolved', 'Closed'].includes(status);

export const isWorkItemActive = (status: WorkItemStatus): boolean =>
  !isWorkItemCompleted(status);

export function isItemOverdue(item: Pick<WorkItem, 'status' | 'due_at'>, now = new Date()): boolean {
  if (!item.due_at || isWorkItemCompleted(item.status)) return false;
  let dueDate: Date;
  if (item.due_at && typeof item.due_at.toDate === 'function') {
    dueDate = item.due_at.toDate();
  } else if (item.due_at && typeof (item.due_at as any).seconds === 'number') {
    dueDate = new Date((item.due_at as any).seconds * 1000);
  } else {
    dueDate = new Date(item.due_at as any);
  }
  return dueDate.getTime() < now.getTime();
}

export function filterWorkItems(
  items: WorkItem[],
  view: WorkCenterView,
  operatorUid: string,
  options: {
    searchTerm?: string;
    priorityFilter?: WorkItemPriority | 'ALL';
    sourceModuleFilter?: WorkSourceModule | 'ALL';
    now?: Date;
  } = {}
): WorkItem[] {
  const now = options.now || new Date();
  const search = options.searchTerm?.trim().toLowerCase() || '';

  return items.filter(item => {
    // 1. High-level view filter
    if (view === 'mine') {
      if (item.assigned_to !== operatorUid || isWorkItemCompleted(item.status)) return false;
    } else if (view === 'unassigned') {
      if (item.assigned_to !== '' || isWorkItemCompleted(item.status)) return false;
    } else if (view === 'inProgress') {
      if (!['Acknowledged', 'InProgress'].includes(item.status)) return false;
    } else if (view === 'waiting') {
      if (item.status !== 'Waiting') return false;
    } else if (view === 'overdue') {
      if (!isItemOverdue(item, now)) return false;
    } else if (view === 'completed') {
      if (!isWorkItemCompleted(item.status)) return false;
    }

    // 2. Priority filter
    if (options.priorityFilter && options.priorityFilter !== 'ALL') {
      if (item.priority !== options.priorityFilter) return false;
    }

    // 3. Source module filter
    if (options.sourceModuleFilter && options.sourceModuleFilter !== 'ALL') {
      if (item.source_module !== options.sourceModuleFilter) return false;
    }

    // 4. Search filter
    if (search) {
      const matchTitle = item.title.toLowerCase().includes(search);
      const matchDescription = item.description?.toLowerCase().includes(search) || false;
      const matchSourceLabel = item.source_label?.toLowerCase().includes(search) || false;
      const matchSourceRecord = item.source_record_id?.toLowerCase().includes(search) || false;
      const matchOpenedBy = item.opened_by_name?.toLowerCase().includes(search) || false;
      const matchNextAction = item.next_action?.toLowerCase().includes(search) || false;
      const matchId = item.work_item_id.toLowerCase().includes(search);
      if (!(matchTitle || matchDescription || matchSourceLabel || matchSourceRecord || matchOpenedBy || matchNextAction || matchId)) {
        return false;
      }
    }

    return true;
  });
}

export function calculateWorkCenterKpis(items: WorkItem[], operatorUid: string, now = new Date()): WorkCenterKpis {
  let openCount = 0;
  let myCount = 0;
  let urgentCount = 0;
  let overdueCount = 0;
  let unassignedCount = 0;
  let inProgressCount = 0;
  let waitingCount = 0;
  let completedCount = 0;

  for (const item of items) {
    const isCompleted = isWorkItemCompleted(item.status);
    const isActive = !isCompleted;

    if (isActive) {
      openCount++;
      if (item.assigned_to === operatorUid) {
        myCount++;
      }
      if (!item.assigned_to) {
        unassignedCount++;
      }
      if (['Acknowledged', 'InProgress'].includes(item.status)) {
        inProgressCount++;
      }
      if (item.status === 'Waiting') {
        waitingCount++;
      }
      if (['High', 'Emergency'].includes(item.priority)) {
        urgentCount++;
      }
      if (isItemOverdue(item, now)) {
        overdueCount++;
      }
    } else {
      completedCount++;
    }
  }

  return {
    openCount,
    myCount,
    urgentCount,
    overdueCount,
    unassignedCount,
    inProgressCount,
    waitingCount,
    completedCount,
    totalCount: items.length,
  };
}

export function findDuplicateActiveWorkItem(
  items: WorkItem[],
  sourceModule: WorkSourceModule,
  sourceRecordId?: string
): WorkItem | undefined {
  if (sourceModule === 'General' || !sourceRecordId?.trim()) return undefined;
  const cleanId = sourceRecordId.trim();
  return items.find(
    item =>
      item.source_module === sourceModule &&
      item.source_record_id === cleanId &&
      isWorkItemActive(item.status)
  );
}
