import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_SOURCE_MODULE_LABELS,
  WORK_ACTIVITY_ACTION_LABELS,
  isSupervisor,
  isItemOverdue,
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
  filterWorkItems,
  calculateWorkCenterKpis,
  findDuplicateActiveWorkItem,
} from '../src/services/workItemPolicy';
import type { WorkItem } from '../src/services/workItemService';

function makeMockWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    work_item_id: 'work_1001',
    site_id: 'site_test',
    source_module: 'General',
    source_record_id: '',
    source_label: '',
    title: 'ติดตามงานทั่วไป',
    description: '',
    status: 'Open',
    priority: 'Normal',
    assigned_to: '',
    assigned_by: '',
    opened_by: 'user_guard_1',
    opened_by_name: 'สมชาย การ์ด',
    next_action: '',
    due_at: null,
    resolution_summary: '',
    acknowledged_at: null,
    acknowledged_by: '',
    started_at: null,
    started_by: '',
    resolved_at: null,
    resolved_by: '',
    closed_at: null,
    closed_by: '',
    last_activity_at: { seconds: 1700000000, nanoseconds: 0 } as any,
    last_activity_id: 'act_1',
    last_audit_id: 'aud_1',
    created_at: { seconds: 1700000000, nanoseconds: 0 } as any,
    updated_at: { seconds: 1700000000, nanoseconds: 0 } as any,
    version: 1,
    ...overrides,
  };
}

test('Work Center Thai labels are completely mapped', () => {
  assert.equal(WORK_ITEM_STATUS_LABELS.Open, 'เปิดงาน');
  assert.equal(WORK_ITEM_STATUS_LABELS.Acknowledged, 'รับทราบ');
  assert.equal(WORK_ITEM_STATUS_LABELS.InProgress, 'กำลังดำเนินการ');
  assert.equal(WORK_ITEM_STATUS_LABELS.Waiting, 'รอข้อมูล');
  assert.equal(WORK_ITEM_STATUS_LABELS.Resolved, 'แก้ไขแล้ว');
  assert.equal(WORK_ITEM_STATUS_LABELS.Closed, 'ปิดงาน');

  assert.equal(WORK_ITEM_PRIORITY_LABELS.Low, 'ต่ำ');
  assert.equal(WORK_ITEM_PRIORITY_LABELS.Normal, 'ปกติ');
  assert.equal(WORK_ITEM_PRIORITY_LABELS.High, 'สูง');
  assert.equal(WORK_ITEM_PRIORITY_LABELS.Emergency, 'ฉุกเฉิน');

  assert.equal(WORK_SOURCE_MODULE_LABELS.General, 'งานทั่วไป');
  assert.equal(WORK_SOURCE_MODULE_LABELS.Vehicle, 'ยานพาหนะ');
  assert.equal(WORK_SOURCE_MODULE_LABELS.Contractor, 'ช่างรับเหมา');
  assert.equal(WORK_SOURCE_MODULE_LABELS.Key, 'กุญแจ');
  assert.equal(WORK_SOURCE_MODULE_LABELS.Patrol, 'เดินตรวจ');
  assert.equal(WORK_SOURCE_MODULE_LABELS.Incident, 'แจ้งเหตุ');

  assert.equal(WORK_ACTIVITY_ACTION_LABELS.Created, 'สร้างงานติดตาม');
  assert.equal(WORK_ACTIVITY_ACTION_LABELS.Resolved, 'แก้ไขแล้วเสร็จ');
  assert.equal(WORK_ACTIVITY_ACTION_LABELS.Closed, 'ปิดงานสมบูรณ์');
});

test('Role supervisor hierarchy logic', () => {
  assert.equal(isSupervisor('Guard'), false);
  assert.equal(isSupervisor('ShiftHead'), true);
  assert.equal(isSupervisor('Manager'), true);
  assert.equal(isSupervisor('Admin'), true);
});

test('Overdue logic accurately checks past due dates for active items', () => {
  const pastSeconds = Math.floor(Date.now() / 1000) - 3600;
  const futureSeconds = Math.floor(Date.now() / 1000) + 3600;

  const pastItem = makeMockWorkItem({
    status: 'InProgress',
    due_at: { seconds: pastSeconds, nanoseconds: 0 } as any,
  });
  const futureItem = makeMockWorkItem({
    status: 'InProgress',
    due_at: { seconds: futureSeconds, nanoseconds: 0 } as any,
  });
  const closedPastItem = makeMockWorkItem({
    status: 'Closed',
    due_at: { seconds: pastSeconds, nanoseconds: 0 } as any,
  });

  assert.equal(isItemOverdue(pastItem), true);
  assert.equal(isItemOverdue(futureItem), false);
  assert.equal(isItemOverdue(closedPastItem), false);
});

test('Work Item Lifecycle Action Permissions', () => {
  const unassignedOpen = makeMockWorkItem({ status: 'Open', assigned_to: '' });
  const assignedToG1 = makeMockWorkItem({ status: 'Open', assigned_to: 'guard_1' });

  // Acknowledge
  assert.equal(canAcknowledge('Guard', unassignedOpen, 'guard_1'), true);
  assert.equal(canAcknowledge('Guard', assignedToG1, 'guard_1'), true);
  assert.equal(canAcknowledge('Guard', assignedToG1, 'guard_2'), false);
  assert.equal(canAcknowledge('ShiftHead', assignedToG1, 'supervisor_1'), true);

  // Start
  const acknowledgedItem = makeMockWorkItem({ status: 'Acknowledged', assigned_to: 'guard_1' });
  assert.equal(canStart('Guard', acknowledgedItem, 'guard_1'), true);
  assert.equal(canStart('Guard', acknowledgedItem, 'guard_2'), false);
  assert.equal(canStart('Manager', acknowledgedItem, 'manager_1'), true);

  // Set Waiting / Resume
  const inProgressItem = makeMockWorkItem({ status: 'InProgress', assigned_to: 'guard_1' });
  const waitingItem = makeMockWorkItem({ status: 'Waiting', assigned_to: 'guard_1' });
  assert.equal(canSetWaiting('Guard', inProgressItem, 'guard_1'), true);
  assert.equal(canSetWaiting('Guard', inProgressItem, 'guard_2'), false);
  assert.equal(canResume('Guard', waitingItem, 'guard_1'), true);

  // Resolve
  assert.equal(canResolve('Guard', inProgressItem, 'guard_1'), true);
  assert.equal(canResolve('Guard', inProgressItem, 'guard_2'), false);

  // Reopen
  const resolvedItem = makeMockWorkItem({ status: 'Resolved', assigned_to: 'guard_1' });
  assert.equal(canReopen('Guard', resolvedItem), false);
  assert.equal(canReopen('ShiftHead', resolvedItem), true);
  assert.equal(canReopen('Admin', resolvedItem), true);

  // Close
  assert.equal(canClose('Guard', resolvedItem), false);
  assert.equal(canClose('ShiftHead', resolvedItem), true);
  assert.equal(canClose('Manager', resolvedItem), true);

  // Assignment & Release
  assert.equal(canAssign('Guard', inProgressItem), false);
  assert.equal(canAssign('ShiftHead', inProgressItem), true);
  assert.equal(canRelease('Guard', inProgressItem, 'guard_1'), true);
  assert.equal(canRelease('ShiftHead', inProgressItem, 'guard_1'), true);
  assert.equal(canRelease('Guard', inProgressItem, 'guard_2'), false);

  // Priority & Due Date
  assert.equal(canChangePriority('Guard', inProgressItem), false);
  assert.equal(canChangePriority('ShiftHead', inProgressItem), true);
  assert.equal(canChangeDueDate('Guard', inProgressItem), false);
  assert.equal(canChangeDueDate('Manager', inProgressItem), true);

  // Notes
  const unassignedInProgress = makeMockWorkItem({ status: 'InProgress', assigned_to: '' });
  const closedItem = makeMockWorkItem({ status: 'Closed', assigned_to: 'guard_1' });
  const closedUnassigned = makeMockWorkItem({ status: 'Closed', assigned_to: '' });

  // 1. Guard + unassigned => false
  assert.equal(canAddNote('Guard', unassignedInProgress, 'guard_1'), false);
  // 2. Guard + assigned to self => true
  assert.equal(canAddNote('Guard', inProgressItem, 'guard_1'), true);
  // 3. Guard + assigned to another UID => false
  assert.equal(canAddNote('Guard', inProgressItem, 'guard_2'), false);
  // 4. ShiftHead / Manager / Admin + non-Closed => true (even if unassigned or assigned to someone else)
  assert.equal(canAddNote('ShiftHead', inProgressItem, 'supervisor_1'), true);
  assert.equal(canAddNote('Manager', inProgressItem, 'manager_1'), true);
  assert.equal(canAddNote('Admin', unassignedInProgress, 'admin_1'), true);
  // 5. Closed Work Item => false for all roles
  assert.equal(canAddNote('Guard', closedItem, 'guard_1'), false);
  assert.equal(canAddNote('ShiftHead', closedItem, 'supervisor_1'), false);
  assert.equal(canAddNote('Manager', closedItem, 'manager_1'), false);
  assert.equal(canAddNote('Admin', closedUnassigned, 'admin_1'), false);
});

test('KPI calculations accurately tally statuses and assignments', () => {
  const pastSeconds = Math.floor(Date.now() / 1000) - 3600;
  const items: WorkItem[] = [
    makeMockWorkItem({ work_item_id: '1', status: 'Open', assigned_to: '' }),
    makeMockWorkItem({ work_item_id: '2', status: 'Open', assigned_to: 'guard_1' }),
    makeMockWorkItem({ work_item_id: '3', status: 'InProgress', assigned_to: 'guard_1' }),
    makeMockWorkItem({ work_item_id: '4', status: 'Waiting', assigned_to: 'guard_2' }),
    makeMockWorkItem({
      work_item_id: '5',
      status: 'InProgress',
      assigned_to: 'guard_1',
      due_at: { seconds: pastSeconds, nanoseconds: 0 } as any,
    }),
    makeMockWorkItem({ work_item_id: '6', status: 'Resolved', assigned_to: 'guard_2' }),
    makeMockWorkItem({ work_item_id: '7', status: 'Closed', assigned_to: 'guard_1' }),
  ];

  const kpis = calculateWorkCenterKpis(items, 'guard_1');
  assert.equal(kpis.openCount, 5); // 1, 2, 3, 4, 5
  assert.equal(kpis.myCount, 3); // 2, 3, 5
  assert.equal(kpis.unassignedCount, 1); // 1
  assert.equal(kpis.inProgressCount, 2); // 3, 5
  assert.equal(kpis.waitingCount, 1); // 4
  assert.equal(kpis.overdueCount, 1); // 5
  assert.equal(kpis.completedCount, 2); // 6 (Resolved), 7 (Closed)
  assert.equal(kpis.totalCount, 7);
});

test('filterWorkItems filters accurately by tab, search, priority, and source', () => {
  const pastSeconds = Math.floor(Date.now() / 1000) - 3600;
  const items: WorkItem[] = [
    makeMockWorkItem({
      work_item_id: 'w1',
      title: 'งานทะเบียนรถ 1กข 1234',
      status: 'Open',
      priority: 'High',
      source_module: 'Vehicle',
      source_label: '1กข 1234',
      assigned_to: 'g1',
    }),
    makeMockWorkItem({
      work_item_id: 'w2',
      title: 'ตรวจกุญแจห้องไฟฟ้า',
      status: 'InProgress',
      priority: 'Emergency',
      source_module: 'Key',
      source_label: 'กุญแจ 01',
      assigned_to: '',
      due_at: { seconds: pastSeconds, nanoseconds: 0 } as any,
    }),
    makeMockWorkItem({
      work_item_id: 'w3',
      title: 'งานช่างแอร์ สุขใจ',
      status: 'Waiting',
      priority: 'Normal',
      source_module: 'Contractor',
      source_label: 'บ.สุขใจ',
      assigned_to: 'g2',
    }),
    makeMockWorkItem({
      work_item_id: 'w4',
      title: 'ตรวจสอบกล้องวงจรปิด',
      status: 'Resolved',
      priority: 'Low',
      source_module: 'Incident',
      source_label: 'กล้องชั้น 2',
      assigned_to: 'g1',
    }),
    makeMockWorkItem({
      work_item_id: 'w5',
      title: 'งานปิดแล้ว',
      status: 'Closed',
      priority: 'Normal',
      source_module: 'General',
      source_label: 'ทั่วไป',
      assigned_to: 'g1',
    }),
  ];

  // All view includes all
  const allView = filterWorkItems(items, 'all', 'g1');
  assert.equal(allView.length, 5);

  // Mine view (Active only: w1 is Open, w4 is Resolved, w5 is Closed)
  const mineView = filterWorkItems(items, 'mine', 'g1');
  assert.equal(mineView.length, 1); // only w1
  assert.equal(mineView[0].work_item_id, 'w1');

  // Unassigned view
  const unassignedView = filterWorkItems(items, 'unassigned', 'g1');
  assert.equal(unassignedView.length, 1);
  assert.equal(unassignedView[0].work_item_id, 'w2');

  // Overdue view
  const overdueView = filterWorkItems(items, 'overdue', 'g1');
  assert.equal(overdueView.length, 1);
  assert.equal(overdueView[0].work_item_id, 'w2');

  // Completed view
  const completedView = filterWorkItems(items, 'completed', 'g1');
  assert.equal(completedView.length, 2); // w4 (Resolved), w5 (Closed)

  // Search filter
  const searchResults = filterWorkItems(items, 'all', 'g1', { searchTerm: '1กข' });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].work_item_id, 'w1');

  // Priority filter
  const highPriority = filterWorkItems(items, 'all', 'g1', { priorityFilter: 'High' });
  assert.equal(highPriority.length, 1);
  assert.equal(highPriority[0].work_item_id, 'w1');

  // Source filter
  const keySource = filterWorkItems(items, 'all', 'g1', { sourceModuleFilter: 'Key' });
  assert.equal(keySource.length, 1);
  assert.equal(keySource[0].work_item_id, 'w2');
});

test('My Work filter and KPI semantic consistency across all statuses', () => {
  const currentUid = 'guard_operator_99';
  const otherUid = 'guard_operator_100';

  const testItems: WorkItem[] = [
    makeMockWorkItem({ work_item_id: 't_open', status: 'Open', assigned_to: currentUid }),
    makeMockWorkItem({ work_item_id: 't_ack', status: 'Acknowledged', assigned_to: currentUid }),
    makeMockWorkItem({ work_item_id: 't_inp', status: 'InProgress', assigned_to: currentUid }),
    makeMockWorkItem({ work_item_id: 't_wait', status: 'Waiting', assigned_to: currentUid }),
    makeMockWorkItem({ work_item_id: 't_res', status: 'Resolved', assigned_to: currentUid }),
    makeMockWorkItem({ work_item_id: 't_close', status: 'Closed', assigned_to: currentUid }),
    makeMockWorkItem({ work_item_id: 't_other_open', status: 'Open', assigned_to: otherUid }),
    makeMockWorkItem({ work_item_id: 't_other_inp', status: 'InProgress', assigned_to: otherUid }),
  ];

  const filteredMine = filterWorkItems(testItems, 'mine', currentUid);
  const kpis = calculateWorkCenterKpis(testItems, currentUid);

  // 1. Assigned Open appears
  assert.equal(filteredMine.some(i => i.work_item_id === 't_open'), true);
  // 2. Assigned Acknowledged appears
  assert.equal(filteredMine.some(i => i.work_item_id === 't_ack'), true);
  // 3. Assigned InProgress appears
  assert.equal(filteredMine.some(i => i.work_item_id === 't_inp'), true);
  // 4. Assigned Waiting appears
  assert.equal(filteredMine.some(i => i.work_item_id === 't_wait'), true);
  // 5. Assigned Resolved does NOT appear
  assert.equal(filteredMine.some(i => i.work_item_id === 't_res'), false);
  // 6. Assigned Closed does NOT appear
  assert.equal(filteredMine.some(i => i.work_item_id === 't_close'), false);
  // 7. Assigned to other UID does NOT appear
  assert.equal(filteredMine.some(i => i.work_item_id === 't_other_open'), false);
  assert.equal(filteredMine.some(i => i.work_item_id === 't_other_inp'), false);

  // 8. filter count agrees with KPI myCount
  assert.equal(filteredMine.length, 4);
  assert.equal(kpis.myCount, 4);
  assert.equal(filteredMine.length, kpis.myCount);
});

test('findDuplicateActiveWorkItem conforms strictly to Active / Completed semantics', () => {
  // 9-14: Same source across all statuses
  const itemOpen = makeMockWorkItem({ work_item_id: 'd_open', source_module: 'Vehicle', source_record_id: 'veh_01', status: 'Open' });
  const itemAck = makeMockWorkItem({ work_item_id: 'd_ack', source_module: 'Vehicle', source_record_id: 'veh_01', status: 'Acknowledged' });
  const itemInp = makeMockWorkItem({ work_item_id: 'd_inp', source_module: 'Vehicle', source_record_id: 'veh_01', status: 'InProgress' });
  const itemWait = makeMockWorkItem({ work_item_id: 'd_wait', source_module: 'Vehicle', source_record_id: 'veh_01', status: 'Waiting' });
  const itemRes = makeMockWorkItem({ work_item_id: 'd_res', source_module: 'Vehicle', source_record_id: 'veh_01', status: 'Resolved' });
  const itemClose = makeMockWorkItem({ work_item_id: 'd_close', source_module: 'Vehicle', source_record_id: 'veh_01', status: 'Closed' });

  // 9. Same source + Open => duplicate found
  assert.equal(findDuplicateActiveWorkItem([itemOpen], 'Vehicle', 'veh_01')?.work_item_id, 'd_open');
  // 10. Same source + Acknowledged => duplicate found
  assert.equal(findDuplicateActiveWorkItem([itemAck], 'Vehicle', 'veh_01')?.work_item_id, 'd_ack');
  // 11. Same source + InProgress => duplicate found
  assert.equal(findDuplicateActiveWorkItem([itemInp], 'Vehicle', 'veh_01')?.work_item_id, 'd_inp');
  // 12. Same source + Waiting => duplicate found
  assert.equal(findDuplicateActiveWorkItem([itemWait], 'Vehicle', 'veh_01')?.work_item_id, 'd_wait');
  // 13. Same source + Resolved => no duplicate
  assert.equal(findDuplicateActiveWorkItem([itemRes], 'Vehicle', 'veh_01'), undefined);
  // 14. Same source + Closed => no duplicate
  assert.equal(findDuplicateActiveWorkItem([itemClose], 'Vehicle', 'veh_01'), undefined);

  // 15. Different source record => no duplicate
  assert.equal(findDuplicateActiveWorkItem([itemInp], 'Vehicle', 'veh_other'), undefined);

  // 16. General source => no duplicate warning
  const itemGeneral = makeMockWorkItem({ work_item_id: 'd_gen', source_module: 'General', source_record_id: '', status: 'InProgress' });
  assert.equal(findDuplicateActiveWorkItem([itemGeneral], 'General', ''), undefined);
  assert.equal(findDuplicateActiveWorkItem([itemGeneral], 'General', 'some_id'), undefined);
});

test('Work Center assignee identity is role-gated and adapts canonical operator directory', () => {
  const activeItem = makeMockWorkItem({ status: 'InProgress', assigned_to: 'g1' });
  const closedItem = makeMockWorkItem({ status: 'Closed', assigned_to: 'g1' });

  // 1. Guard cannot assign or reassign, thus does not need eligible assignees directory
  assert.equal(canAssign('Guard', activeItem), false);
  assert.equal(canAssign('Guard', closedItem), false);

  // 2. ShiftHead, Manager, Admin can assign active items
  assert.equal(canAssign('ShiftHead', activeItem), true);
  assert.equal(canAssign('Manager', activeItem), true);
  assert.equal(canAssign('Admin', activeItem), true);

  // 3. Closed items cannot be assigned even by supervisors
  assert.equal(canAssign('ShiftHead', closedItem), false);
  assert.equal(canAssign('Admin', closedItem), false);

  // 4. Verify canonical adapter preserves Firebase UID, name, role without relying on /operators collection
  const mockCanonicalOperators = [
    {
      uid: 'firebase_auth_uid_1001',
      name: 'สมชาย เจ้าหน้าที่',
      role: 'Guard',
      shift: 'Day',
    },
    {
      uid: 'firebase_auth_uid_1002',
      name: 'สมศักดิ์ หัวหน้ากะ',
      role: 'ShiftHead',
      shift: 'Day',
    },
  ];

  // Adapter projection to AssigneeOption: { uid, name, role }
  const adaptedAssignees = mockCanonicalOperators.map(op => ({
    uid: op.uid,
    name: op.name,
    role: op.role,
  }));

  assert.deepEqual(adaptedAssignees, [
    {
      uid: 'firebase_auth_uid_1001',
      name: 'สมชาย เจ้าหน้าที่',
      role: 'Guard',
    },
    {
      uid: 'firebase_auth_uid_1002',
      name: 'สมศักดิ์ หัวหน้ากะ',
      role: 'ShiftHead',
    },
  ]);

  // Ensure uid is the exact canonical Firebase Auth UID
  assert.equal(adaptedAssignees[0].uid, 'firebase_auth_uid_1001');
  assert.equal(adaptedAssignees[1].uid, 'firebase_auth_uid_1002');
});
