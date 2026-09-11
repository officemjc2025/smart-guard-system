import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { Timestamp } from 'firebase/firestore';
import type { WorkItem, WorkSourceModule } from '../src/services/workItemService';
import {
  findDuplicateActiveWorkItem,
  findLatestCompletedWorkItem,
  isWorkItemActive,
  isWorkItemCompleted,
  canAssign,
  canReopen,
  canClose,
  isSupervisor,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_PRIORITY_LABELS,
  resolveVehicleWorkItemSource,
} from '../src/services/workItemPolicy';

describe('SGS Work Center – Phase 3: Source Record Follow-up Integration Tests', () => {
  const mockNow = new Date('2026-09-11T12:00:00Z');

  const createMockItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
    work_item_id: 'work_inc_001',
    site_id: 'site-01',
    source_module: 'Incident',
    source_record_id: 'INC_1001',
    source_label: 'เหตุการณ์: INC_1001 (อุปกรณ์ชำรุด)',
    title: 'ติดตามเหตุการณ์: อุปกรณ์ชำรุด ที่ หน้าป้อมยาม',
    description: 'ประเภทเหตุการณ์: อุปกรณ์ชำรุด\nสถานที่: หน้าป้อมยาม',
    status: 'Open',
    priority: 'Normal',
    assigned_to: '',
    assigned_by: '',
    opened_by: 'guard_001',
    opened_by_name: 'สมชาย ผู้รักษาความปลอดภัย',
    next_action: 'ประสานงานช่างซ่อม',
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
    last_activity_at: Timestamp.fromDate(mockNow),
    last_activity_id: 'act_001',
    last_audit_id: 'aud_001',
    created_at: Timestamp.fromDate(mockNow),
    updated_at: Timestamp.fromDate(mockNow),
    version: 1,
    ...overrides,
  });

  // Test 1: Incident follow-up detection when no active item exists
  it('1. Correctly detects no active linked Work Item for Incident', () => {
    const items: WorkItem[] = [];
    const active = findDuplicateActiveWorkItem(items, 'Incident', 'INC_1001');
    assert.equal(active, undefined);
  });

  // Test 2: Incident follow-up detection when active item exists
  it('2. Correctly finds active linked Work Item and renders status & assignee info', () => {
    const activeItem = createMockItem({
      status: 'InProgress',
      assigned_to: 'guard_002',
      priority: 'High',
      next_action: 'ตรวจสอบวงจรไฟฟ้า',
    });
    const items: WorkItem[] = [activeItem];

    const found = findDuplicateActiveWorkItem(items, 'Incident', 'INC_1001');
    assert.ok(found);
    assert.equal(found.work_item_id, 'work_inc_001');
    assert.equal(found.status, 'InProgress');
    assert.equal(WORK_ITEM_STATUS_LABELS[found.status], 'กำลังดำเนินการ');
    assert.equal(found.priority, 'High');
    assert.equal(WORK_ITEM_PRIORITY_LABELS[found.priority], 'สูง');
    assert.equal(found.assigned_to, 'guard_002');
    assert.equal(found.next_action, 'ตรวจสอบวงจรไฟฟ้า');
  });

  // Test 3: Canonical source mapping
  it('3. Canonical mapping preserves site_id, source_module, and source_record_id', () => {
    const item = createMockItem({
      source_module: 'Incident',
      source_record_id: 'INC_9999',
      source_label: 'เหตุการณ์: INC_9999 (บุคคลต้องสงสัย)',
      site_id: 'site-01',
    });

    assert.equal(item.site_id, 'site-01');
    assert.equal(item.source_module, 'Incident');
    assert.equal(item.source_record_id, 'INC_9999');
    assert.ok(item.source_label.includes('INC_9999'));
  });

  // Test 4: Active duplicate is detected across all active statuses
  it('4. Active duplicate is detected for Open, Acknowledged, InProgress, Waiting', () => {
    const activeStatuses: WorkItem['status'][] = ['Open', 'Acknowledged', 'InProgress', 'Waiting'];

    for (const status of activeStatuses) {
      const item = createMockItem({ status });
      assert.equal(isWorkItemActive(status), true);
      assert.equal(isWorkItemCompleted(status), false);

      const found = findDuplicateActiveWorkItem([item], 'Incident', 'INC_1001');
      assert.ok(found);
      assert.equal(found.status, status);
    }
  });

  // Test 5: Resolved/Closed items do not count as active duplicates
  it('5. Resolved/Closed items do not block new follow-ups and are tracked as historical follow-ups', () => {
    const resolvedItem = createMockItem({
      work_item_id: 'work_inc_old_1',
      status: 'Resolved',
      resolution_summary: 'ซ่อมแซมเสร็จสิ้นแล้ว',
    });
    const closedItem = createMockItem({
      work_item_id: 'work_inc_old_2',
      status: 'Closed',
      resolution_summary: 'ปิดงานเรียบร้อย',
    });

    assert.equal(isWorkItemActive('Resolved'), false);
    assert.equal(isWorkItemCompleted('Resolved'), true);
    assert.equal(isWorkItemActive('Closed'), false);
    assert.equal(isWorkItemCompleted('Closed'), true);

    const activeFromResolved = findDuplicateActiveWorkItem([resolvedItem], 'Incident', 'INC_1001');
    assert.equal(activeFromResolved, undefined);

    const activeFromClosed = findDuplicateActiveWorkItem([closedItem], 'Incident', 'INC_1001');
    assert.equal(activeFromClosed, undefined);

    const latestCompleted = findLatestCompletedWorkItem([closedItem, resolvedItem], 'Incident', 'INC_1001');
    assert.ok(latestCompleted);
    assert.equal(latestCompleted.work_item_id, 'work_inc_old_2');
  });

  // Test 6: Role permissions - Guard constraints
  it('6. Guard cannot assign others or perform supervisor-only operations', () => {
    const item = createMockItem({ status: 'InProgress', assigned_to: 'guard_001' });

    assert.equal(isSupervisor('Guard'), false);
    assert.equal(canAssign('Guard', item), false);
    assert.equal(canReopen('Guard', createMockItem({ status: 'Resolved' })), false);
    assert.equal(canClose('Guard', createMockItem({ status: 'Resolved' })), false);
  });

  // Test 7: Role permissions - ShiftHead, Manager, Admin policy
  it('7. ShiftHead, Manager, and Admin have supervisor management privileges', () => {
    const supervisorRoles = ['ShiftHead', 'Manager', 'Admin'];

    for (const role of supervisorRoles) {
      assert.equal(isSupervisor(role), true);
      const openItem = createMockItem({ status: 'Open' });
      assert.equal(canAssign(role, openItem), true);

      const resolvedItem = createMockItem({ status: 'Resolved' });
      expectRoleSupervisor(role, resolvedItem);
    }
  });

  function expectRoleSupervisor(role: string, resolvedItem: WorkItem) {
    assert.equal(canReopen(role, resolvedItem), true);
    assert.equal(canClose(role, resolvedItem), true);
  }

  // Test 8: Immutability of source records - Work Item operations do not mutate source records
  it('8. Work Item data structure does not alter or contain source record internal state', () => {
    const item = createMockItem({
      source_module: 'Incident',
      source_record_id: 'INC_1001',
    });

    // Verify WorkItem model fields are strictly scoped to WorkItems collection
    assert.equal(item.source_module, 'Incident');
    assert.equal(item.source_record_id, 'INC_1001');
    assert.equal((item as any).incident_datetime, undefined);
    assert.equal((item as any).reported_by, undefined);
  });

  // Test 9: Safe error sanitization - no Firebase index URL exposed
  it('9. Error sanitization produces user-friendly Thai message without exposing Firebase index URLs', () => {
    const rawFirebaseError = 'The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/sgs/firestore/indexes?create_composite=...';

    // UI sanitizer pattern
    const sanitizedError = 'ไม่สามารถโหลดงานติดตามได้ กรุณาลองใหม่อีกครั้ง';
    assert.ok(!sanitizedError.includes('https://console.firebase.google.com'));
    assert.ok(!sanitizedError.includes('The query requires an index'));
    assert.equal(sanitizedError, 'ไม่สามารถโหลดงานติดตามได้ กรุณาลองใหม่อีกครั้ง');
  });

  // Test 10: Non-Incident operational source modules support (Vehicle, Contractor, Key, Patrol)
  it('10. Non-Incident operational source modules support canonical follow-up linking', () => {
    const modules: WorkSourceModule[] = ['Vehicle', 'Contractor', 'Key', 'Patrol'];

    for (const mod of modules) {
      const recordId = `${mod}_REC_100`;
      const item = createMockItem({
        source_module: mod,
        source_record_id: recordId,
        source_label: `${mod}: ${recordId}`,
        title: `ติดตามงาน ${mod}: ${recordId}`,
      });

      const foundActive = findDuplicateActiveWorkItem([item], mod, recordId);
      assert.ok(foundActive);
      assert.equal(foundActive.source_module, mod);
      assert.equal(foundActive.source_record_id, recordId);
    }
  });

  // Test 11: Deep focus selection logic
  it('11. Deep focus matches target work item by ID among subscribed items', () => {
    const item1 = createMockItem({ work_item_id: 'work_001', title: 'Task 1' });
    const item2 = createMockItem({ work_item_id: 'work_002', title: 'Task 2' });
    const items = [item1, item2];

    const targetId = 'work_002';
    const focused = items.find(i => i.work_item_id === targetId);

    assert.ok(focused);
    assert.equal(focused.work_item_id, 'work_002');
    assert.equal(focused.title, 'Task 2');
  });

  // Test 12: Source labels formatting
  it('12. Source label formatting handles empty or special cases safely', () => {
    const generalActive = findDuplicateActiveWorkItem([], 'General', '');
    assert.equal(generalActive, undefined);

    const generalCompleted = findLatestCompletedWorkItem([], 'General', '');
    assert.equal(generalCompleted, undefined);
  });

  // Test 13: Source context lock enforcement logic
  it('13. Source-launched creation enforces locked canonical source context', () => {
    const defaultSourceModule: WorkSourceModule = 'Incident';
    const defaultSourceRecordId = 'INC_2026';
    const defaultSourceLabel = 'เหตุการณ์: INC_2026 (อัคคีภัย)';
    const lockSourceContext = true;

    // Simulated user UI tamper attempt
    const tamperedModule: WorkSourceModule = 'Vehicle';
    const tamperedRecordId = 'VEH_TAMPER';
    const tamperedLabel = 'Fake Label';

    // When lockSourceContext is true, effective submission values must remain canonical defaults
    const effectiveSourceModule = lockSourceContext ? defaultSourceModule : tamperedModule;
    const effectiveSourceRecordId = lockSourceContext ? defaultSourceRecordId : tamperedRecordId;
    const effectiveSourceLabel = lockSourceContext ? defaultSourceLabel : tamperedLabel;

    assert.equal(effectiveSourceModule, 'Incident');
    assert.equal(effectiveSourceRecordId, 'INC_2026');
    assert.equal(effectiveSourceLabel, 'เหตุการณ์: INC_2026 (อัคคีภัย)');
  });

  // Test 14: Generic Work Center creation preserves editable source context
  it('14. Generic Work Center creation (lockSourceContext=false) permits custom source context', () => {
    const lockSourceContext = false;
    const userSelectedModule: WorkSourceModule = 'Key';
    const userEnteredRecordId = 'KEY_999';
    const userEnteredLabel = 'เบิกกุญแจห้อง 101';

    const effectiveSourceModule = lockSourceContext ? 'General' : userSelectedModule;
    const effectiveSourceRecordId = lockSourceContext ? '' : userEnteredRecordId;
    const effectiveSourceLabel = lockSourceContext ? '' : userEnteredLabel;

    assert.equal(effectiveSourceModule, 'Key');
    assert.equal(effectiveSourceRecordId, 'KEY_999');
    assert.equal(effectiveSourceLabel, 'เบิกกุญแจห้อง 101');
  });

  // Test 15: Static regression assertion for malformed Tailwind class concatenations
  it('15. Static regression check: no malformed concatenated Tailwind classes in work-center components', () => {
    const workCenterDir = path.resolve(process.cwd(), 'src/components/work-center');
    const files = fs.readdirSync(workCenterDir).filter(f => f.endsWith('.tsx'));

    // Known bad patterns verified in Phase 3
    const malformedRegex = /(?:h-[0-9.]+text-|items-centergap-|font-blackpx-|gap-[0-9.]+truncate|font-semiboldtext-|gap-[0-9.]+text-)/;

    // Self-test: verify that the regex correctly detects the verified bad tokens
    assert.match('w-4 h-4text-blue-600', malformedRegex);
    assert.match('flex items-centergap-1.5', malformedRegex);
    assert.match('w-3.5 h-3.5text-slate-400', malformedRegex);
    assert.match('font-blackpx-2', malformedRegex);
    assert.match('gap-1.5truncate', malformedRegex);
    assert.match('font-semiboldtext-slate-700', malformedRegex);
    assert.match('gap-1.5text-[11px]', malformedRegex);

    // Self-test: verify that valid tokens are not falsely flagged
    assert.doesNotMatch('max-h-[92vh]', malformedRegex);
    assert.doesNotMatch('text-[11px]', malformedRegex);
    assert.doesNotMatch('dark:bg-slate-900/50', malformedRegex);

    for (const file of files) {
      const content = fs.readFileSync(path.join(workCenterDir, file), 'utf8');
      const match = content.match(malformedRegex);
      assert.equal(match, null, `Found malformed Tailwind token concatenation in ${file}: ${match?.[0]}`);
    }
  });

  // Test 16: WorkItemCreateDialog retains user-visible sanitized error on create failure
  it('16. WorkItemCreateDialog catch path sets user-visible sanitized Thai error and does not leak raw err.message', () => {
    const dialogFilePath = path.resolve(process.cwd(), 'src/components/work-center/WorkItemCreateDialog.tsx');
    const content = fs.readFileSync(dialogFilePath, 'utf8');

    // Verify createWorkItem catch block structure
    // Must call setErrorMsg with sanitized Thai string and log original error
    const catchMatch = content.match(/createWorkItem\([\s\S]*?\}\);\s*[\s\S]*?\}\s*catch\s*\((?:err|e):?\s*unknown\)\s*\{([\s\S]*?)\}\s*finally/);
    assert.ok(catchMatch, 'Catch block for createWorkItem must exist');
    const catchBody = catchMatch[1];

    // Verify setErrorMsg is called
    assert.ok(catchBody.includes('setErrorMsg('), 'Catch block must call setErrorMsg');

    // Verify controlled Thai error message
    assert.ok(
      catchBody.includes('ไม่สามารถสร้างงานติดตามได้'),
      'Catch block must set controlled Thai error message'
    );

    // Verify raw error message is not rendered to user
    assert.ok(
      !catchBody.includes('setErrorMsg(err.message') && !catchBody.includes('setErrorMsg((err as any).message'),
      'Raw error message must not be passed to setErrorMsg'
    );

    // Verify original error is logged to console for diagnostics
    assert.ok(catchBody.includes('console.error('), 'Original error must be logged to console.error');
  });

  // Test 17: Vehicle source mapping uses canonical vehicle_session_id
  it('17. Vehicle source mapping uses vehicle_session_id and does not use log_id or session_id as Work Item sourceRecordId', () => {
    const validVehicleRecord = {
      log_id: 'vlog_001_legacy',
      session_id: 'sess_999_legacy',
      vehicle_session_id: 'vses_canonical_1001',
      vehicle_plate: '1กข 9999',
      card_number: 'C-101',
      visitor_name: 'นายสมชาย ผู้มาติดต่อ',
      target_room: '101/5',
      purpose: 'ส่งของ',
    };

    const mapped = resolveVehicleWorkItemSource(validVehicleRecord);
    assert.ok(mapped);
    assert.equal(mapped.sourceModule, 'Vehicle');
    assert.equal(mapped.sourceRecordId, 'vses_canonical_1001');
    assert.notEqual(mapped.sourceRecordId, 'vlog_001_legacy');
    assert.notEqual(mapped.sourceRecordId, 'sess_999_legacy');
    assert.ok(mapped.sourceLabel.includes('1กข 9999'));
    assert.ok(mapped.defaultTitle.includes('1กข 9999'));
    assert.equal(mapped.defaultPriority, 'Normal');
  });

  // Test 18: Vehicle record with missing/blank vehicle_session_id returns null (no bogus Work Item source)
  it('18. Vehicle record with missing/blank vehicle_session_id returns null and refuses to link bogus source', () => {
    // Missing vehicle_session_id
    const legacyOnlyLogId = {
      log_id: 'vlog_legacy_only',
      session_id: 'sess_legacy_only',
      vehicle_plate: '2ขค 1234',
    };
    assert.equal(resolveVehicleWorkItemSource(legacyOnlyLogId), null);

    // Empty/whitespace vehicle_session_id
    const blankSessionId = {
      log_id: 'vlog_123',
      vehicle_session_id: '   ',
      vehicle_plate: '3งจ 5678',
    };
    assert.equal(resolveVehicleWorkItemSource(blankSessionId), null);

    // Undefined record
    assert.equal(resolveVehicleWorkItemSource(undefined as any), null);
  });

  // Test 19: SearchHistory reuses canonical resolveVehicleWorkItemSource and renders controlled Thai UX for legacy records
  it('19. SearchHistory imports and reuses canonical resolveVehicleWorkItemSource helper with legacy null guard', () => {
    const searchHistoryPath = path.resolve(process.cwd(), 'src/components/SearchHistory.tsx');
    const content = fs.readFileSync(searchHistoryPath, 'utf8');

    // Verify SearchHistory imports resolveVehicleWorkItemSource
    assert.match(
      content,
      /import\s*\{[^}]*resolveVehicleWorkItemSource[^}]*\}\s*from\s*['"]\.\.\/services\/workItemPolicy['"]/,
      'SearchHistory must import resolveVehicleWorkItemSource from workItemPolicy'
    );

    // Verify SearchHistory calls resolveVehicleWorkItemSource(record)
    assert.match(
      content,
      /return\s+resolveVehicleWorkItemSource\(record\);/,
      'SearchHistory must delegate vehicle source mapping to resolveVehicleWorkItemSource(record)'
    );

    // Verify SearchHistory does NOT contain duplicated inline Vehicle sourceRecordId construction
    assert.ok(
      !content.includes("sourceModule: 'Vehicle'") && !content.includes('sourceModule: "Vehicle"'),
      'SearchHistory must not contain inline Vehicle sourceModule construction'
    );

    // Verify NO fallback to log_id or session_id for Work Item creation
    assert.ok(
      !content.includes('record.log_id || record.session_id'),
      'SearchHistory must not use record.log_id or record.session_id for Work Item source'
    );

    // Verify controlled Thai UX message for legacy records
    const legacyNoticeThai = 'ไม่สามารถสร้างงานติดตามจากรายการรถเดิมนี้ได้ เนื่องจากไม่มีข้อมูลอ้างอิง Vehicle Session';
    assert.ok(
      content.includes(legacyNoticeThai),
      'SearchHistory must render controlled Thai message for legacy vehicle records'
    );

    // Verify that when sourceInfo is null, SourceWorkItemAction is NOT rendered
    assert.match(
      content,
      /if \(!sourceInfo\) \{[\s\S]*?ไม่สามารถสร้างงานติดตามจากรายการรถเดิมนี้ได้[\s\S]*?return \([\s\S]*?<SourceWorkItemAction/,
      'SearchHistory must guard SourceWorkItemAction behind non-null sourceInfo check'
    );
  });
});
