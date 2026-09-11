import {
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, where, type Timestamp, type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, type SmartGuardRole } from '../firebase';
import { createUuid } from '../utils/uuid';
import { listEligibleQueueOperators } from './vehicleAssignmentService';
export { isAllowedWorkItemTransition } from './workItemPolicy';

export type WorkItemStatus = 'Open' | 'Acknowledged' | 'InProgress' | 'Waiting' | 'Resolved' | 'Closed';
export type WorkItemPriority = 'Low' | 'Normal' | 'High' | 'Emergency';
export type WorkSourceModule = 'Vehicle' | 'Contractor' | 'Key' | 'Patrol' | 'Incident' | 'General';
export type WorkActivityAction = 'Created' | 'Acknowledged' | 'Started' | 'Waiting' | 'Resumed' | 'Assigned' | 'Transferred' | 'Released' | 'PriorityChanged' | 'DueDateChanged' | 'NoteAdded' | 'Resolved' | 'Reopened' | 'Closed';

export interface WorkItem {
  work_item_id: string; site_id: string; source_module: WorkSourceModule; source_record_id: string; source_label: string;
  title: string; description: string; status: WorkItemStatus; priority: WorkItemPriority; assigned_to: string; assigned_by: string;
  opened_by: string; opened_by_name: string; next_action: string; due_at: Timestamp | null; resolution_summary: string;
  acknowledged_at: Timestamp | null; acknowledged_by: string; started_at: Timestamp | null; started_by: string;
  resolved_at: Timestamp | null; resolved_by: string; closed_at: Timestamp | null; closed_by: string;
  last_activity_at: Timestamp; last_activity_id: string; last_audit_id: string; created_at: Timestamp; updated_at: Timestamp; version: number;
}

export interface CreateWorkItemInput { siteId: string; sourceModule: WorkSourceModule; sourceRecordId?: string; sourceLabel?: string; title: string; description?: string; priority?: WorkItemPriority; assignedTo?: string; nextAction?: string; dueAt?: Timestamp | null; }
export interface WorkItemActor { uid: string; name: string; role: SmartGuardRole | string; siteId: string; }
export interface WorkItemActivity { activity_id: string; work_item_id: string; site_id: string; action: WorkActivityAction; actor_uid: string; actor_name: string; actor_role: string; from_status: string; to_status: string; note: string; created_at: Timestamp; schema_version: 1; }


const sourceCollections: Record<Exclude<WorkSourceModule, 'General'>, string> = { Vehicle: 'vehicleSessions', Contractor: 'contractorLogs', Key: 'keyLogs', Patrol: 'patrolLogs', Incident: 'incidentReports' };
const activeActor = (): WorkItemActor => {
  const uid = auth.currentUser?.uid;
  const siteId = sessionStorage.getItem('selected_site_id') || '';
  if (!uid || !siteId) throw new Error('Authenticated active site is required.');
  return { uid, siteId, name: sessionStorage.getItem('selected_operator_name') || uid, role: sessionStorage.getItem('selected_operator_role') || 'Guard' };
};
const ensureText = (value: string, field: string) => { if (!value.trim()) throw new Error(`${field} is required.`); return value.trim(); };
const actionFor = (action: WorkActivityAction) => `WorkItem:${action === 'PriorityChanged' ? 'Priority' : action === 'DueDateChanged' ? 'DueDate' : action}`;

function assertSite(actor: WorkItemActor, siteId: string) { if (actor.siteId !== siteId) throw new Error('Cross-site Work Item access is denied.'); }
function canManage(actor: WorkItemActor) { return ['ShiftHead', 'Manager', 'Admin'].includes(actor.role); }
function canOperate(actor: WorkItemActor, item: WorkItem) { return canManage(actor) || item.assigned_to === actor.uid || (!item.assigned_to && actor.role === 'Guard'); }
function isEligibleAssignee(profile: { exists: () => boolean; data: () => Record<string, unknown> | undefined }, siteId: string) {
  const data = profile.data();
  if (!profile.exists() || data?.status !== 'Active' || !['Guard', 'ShiftHead', 'Manager', 'Admin'].includes(String(data?.role)) || data?.site_id !== siteId) {
    throw new Error('Assignee must be an active same-site operator.');
  }
}
function sourceRef(module: WorkSourceModule, id?: string) { return module === 'General' ? null : doc(db, sourceCollections[module], ensureText(id || '', 'sourceRecordId')); }

async function transact(itemId: string, actor: WorkItemActor, action: WorkActivityAction | ((item: WorkItem) => WorkActivityAction), note: string, mutate: (item: WorkItem) => Partial<WorkItem>, expectedVersion?: number) {
  return runTransaction(db, async tx => {
    const itemRef = doc(db, 'workItems', itemId); const snap = await tx.get(itemRef);
    if (!snap.exists()) throw new Error('Work Item not found.');
    const item = snap.data() as WorkItem; assertSite(actor, item.site_id);
    if (expectedVersion !== undefined && item.version !== expectedVersion) throw new Error(`Work Item version mismatch: expected ${expectedVersion}, found ${item.version}.`);
    const resolvedAction = typeof action === 'function' ? action(item) : action;
    const changes = mutate(item);
    if (changes.assigned_to && changes.assigned_to !== item.assigned_to) {
      isEligibleAssignee(await tx.get(doc(db, 'users', changes.assigned_to)), item.site_id);
    }
    const nextVersion = item.version + 1;
    const activityRef = doc(itemRef, 'activities', `WORKITEM_ACTIVITY_${itemId}_V${nextVersion}`);
    const auditRef = doc(db, 'auditLogs', `WORKITEM_${itemId}_V${nextVersion}`);
    const next = { ...changes, version: nextVersion, last_activity_id: activityRef.id, last_audit_id: auditRef.id, updated_at: serverTimestamp(), last_activity_at: serverTimestamp() };
    tx.update(itemRef, next);
    tx.set(activityRef, { activity_id: activityRef.id, work_item_id: itemId, site_id: item.site_id, action: resolvedAction, actor_uid: actor.uid, actor_name: actor.name, actor_role: actor.role, from_status: item.status, to_status: String(next.status || item.status), note, created_at: serverTimestamp(), schema_version: 1 });
    tx.set(auditRef, { audit_id: auditRef.id, site_id: item.site_id, operator_id: actor.uid, account_uid: actor.uid, operator_name: actor.name, user_name: actor.name, action: actionFor(resolvedAction), module_name: 'WorkItems', record_id: itemId, old_value: item.status, new_value: String(next.status || item.status), action_result: 'Success', created_at: serverTimestamp() });
    return { ...item, ...next } as WorkItem;
  });
}

export async function createWorkItem(input: CreateWorkItemInput): Promise<string> {
  const actor = activeActor(); assertSite(actor, input.siteId); ensureText(input.title, 'title');
  const id = `work_${createUuid()}`; const ref = doc(db, 'workItems', id); const source = sourceRef(input.sourceModule, input.sourceRecordId);
  if (input.assignedTo && input.assignedTo !== actor.uid && !canManage(actor)) throw new Error('Only supervisors may create work assigned to another operator.');
  await runTransaction(db, async tx => {
    if (source) { const sourceSnap = await tx.get(source); if (!sourceSnap.exists() || sourceSnap.data().site_id !== input.siteId) throw new Error('Source record is missing or belongs to another site.'); }
    if (input.assignedTo) isEligibleAssignee(await tx.get(doc(db, 'users', input.assignedTo)), input.siteId);
    const activityRef = doc(ref, 'activities', `WORKITEM_ACTIVITY_${id}_V1`); const auditRef = doc(db, 'auditLogs', `WORKITEM_${id}_V1`);
    tx.set(ref, { work_item_id: id, site_id: input.siteId, source_module: input.sourceModule, source_record_id: input.sourceModule === 'General' ? '' : input.sourceRecordId, source_label: input.sourceLabel || '', title: input.title.trim(), description: input.description?.trim() || '', status: 'Open', priority: input.priority || 'Normal', assigned_to: input.assignedTo || '', assigned_by: input.assignedTo ? actor.uid : '', opened_by: actor.uid, opened_by_name: actor.name, next_action: input.nextAction?.trim() || '', due_at: input.dueAt || null, resolution_summary: '', acknowledged_at: null, acknowledged_by: '', started_at: null, started_by: '', resolved_at: null, resolved_by: '', closed_at: null, closed_by: '', last_activity_at: serverTimestamp(), last_activity_id: activityRef.id, last_audit_id: auditRef.id, created_at: serverTimestamp(), updated_at: serverTimestamp(), version: 1 });
    tx.set(activityRef, { activity_id: activityRef.id, work_item_id: id, site_id: input.siteId, action: 'Created', actor_uid: actor.uid, actor_name: actor.name, actor_role: actor.role, from_status: '', to_status: 'Open', note: '', created_at: serverTimestamp(), schema_version: 1 });
    tx.set(auditRef, { audit_id: auditRef.id, site_id: input.siteId, operator_id: actor.uid, account_uid: actor.uid, operator_name: actor.name, user_name: actor.name, action: 'WorkItem:Create', module_name: 'WorkItems', record_id: id, old_value: '', new_value: 'Open', action_result: 'Success', created_at: serverTimestamp() });
  }); return id;
}
export async function getWorkItem(id: string) { const s = await getDoc(doc(db, 'workItems', id)); if (!s.exists()) return null; const a = activeActor(); assertSite(a, s.data().site_id); return s.data() as WorkItem; }
export async function listOpenWorkItems(siteId: string, assignedTo?: string) { const a = activeActor(); assertSite(a, siteId); const constraints = [where('site_id', '==', siteId), where('status', 'in', ['Open', 'Acknowledged', 'InProgress', 'Waiting', 'Resolved']), ...(assignedTo ? [where('assigned_to', '==', assignedTo)] : []), orderBy('updated_at', 'desc')]; const s = await getDocs(query(collection(db, 'workItems'), ...constraints)); return s.docs.map(d => d.data() as WorkItem); }
export function subscribeWorkItems(siteId: string, callback: (items: WorkItem[]) => void, assignedTo?: string, onError?: (error: Error) => void): Unsubscribe {
  const a = activeActor(); assertSite(a, siteId);
  const constraints = [where('site_id', '==', siteId), ...(assignedTo ? [where('assigned_to', '==', assignedTo)] : []), orderBy('updated_at', 'desc')];
  return onSnapshot(
    query(collection(db, 'workItems'), ...constraints),
    s => callback(s.docs.map(d => d.data() as WorkItem)),
    err => onError?.(err instanceof Error ? err : new Error(String(err)))
  );
}

export function subscribeWorkItemsForSource(
  siteId: string,
  sourceModule: WorkSourceModule,
  sourceRecordId: string,
  callback: (items: WorkItem[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const a = activeActor(); assertSite(a, siteId);
  const constraints = [
    where('site_id', '==', siteId),
    where('source_module', '==', sourceModule),
    where('source_record_id', '==', sourceRecordId),
    orderBy('updated_at', 'desc')
  ];
  return onSnapshot(
    query(collection(db, 'workItems'), ...constraints),
    s => callback(s.docs.map(d => d.data() as WorkItem)),
    err => onError?.(err instanceof Error ? err : new Error(String(err)))
  );
}

export async function listWorkItemsForSource(
  siteId: string,
  sourceModule: WorkSourceModule,
  sourceRecordId: string
): Promise<WorkItem[]> {
  const a = activeActor(); assertSite(a, siteId);
  const constraints = [
    where('site_id', '==', siteId),
    where('source_module', '==', sourceModule),
    where('source_record_id', '==', sourceRecordId),
    orderBy('updated_at', 'desc')
  ];
  const s = await getDocs(query(collection(db, 'workItems'), ...constraints));
  return s.docs.map(d => d.data() as WorkItem);
}

export interface AssigneeOption {
  uid: string;
  name: string;
  role: string;
}

export async function listEligibleAssignees(siteId: string): Promise<AssigneeOption[]> {
  const operators = await listEligibleQueueOperators(siteId);
  return operators.map(op => ({
    uid: op.uid,
    name: op.name,
    role: op.role,
  }));
}
export async function acknowledgeWorkItem(id: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'Acknowledged', '', i => { if (i.status !== 'Open') throw new Error('Only Open Work Items can be acknowledged.'); if (i.assigned_to && i.assigned_to !== a.uid && !canManage(a)) throw new Error('Work Item is assigned to another operator.'); return { status: 'Acknowledged', acknowledged_at: serverTimestamp() as unknown as Timestamp, acknowledged_by: a.uid, assigned_to: i.assigned_to || a.uid, assigned_by: i.assigned_to ? i.assigned_by : a.uid }; }, expectedVersion); }
export async function startWorkItem(id: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'Started', '', i => { if (i.status !== 'Acknowledged' || !canOperate(a, i)) throw new Error('Work Item cannot be started by this operator.'); return { status: 'InProgress', started_at: serverTimestamp() as unknown as Timestamp, started_by: a.uid }; }, expectedVersion); }
export async function setWorkItemWaiting(id: string, note: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'Waiting', ensureText(note, 'note'), i => { if (i.status !== 'InProgress' || !canOperate(a, i)) throw new Error('Only assigned InProgress work can wait.'); return { status: 'Waiting' }; }, expectedVersion); }
export async function resumeWorkItem(id: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'Resumed', '', i => { if (i.status !== 'Waiting' || !canOperate(a, i)) throw new Error('Only assigned Waiting work can resume.'); return { status: 'InProgress' }; }, expectedVersion); }
export async function assignWorkItem(id: string, assignee: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, i => i.assigned_to ? 'Transferred' : 'Assigned', '', i => { if (!canManage(a) || i.status === 'Closed') throw new Error('Only ShiftHead, Manager, or Admin may assign work.'); if (i.assigned_to === assignee) throw new Error('Work Item is already assigned to this operator.'); return { assigned_to: assignee, assigned_by: a.uid }; }, expectedVersion); }
export async function releaseWorkItem(id: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'Released', '', i => { if (!(canManage(a) || i.assigned_to === a.uid)) throw new Error('Only the assignee or supervisor may release work.'); return { assigned_to: '', assigned_by: a.uid }; }, expectedVersion); }
export async function setWorkItemPriority(id: string, priority: WorkItemPriority, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'PriorityChanged', '', i => { if (!canManage(a) || (priority === 'Emergency' && a.role === 'Guard')) throw new Error('Insufficient permission to change priority.'); return { priority }; }, expectedVersion); }
export async function setWorkItemDueDate(id: string, dueAt: Timestamp | null, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'DueDateChanged', '', i => { if (!canManage(a)) throw new Error('Insufficient permission to change due date.'); return { due_at: dueAt }; }, expectedVersion); }
export async function addWorkItemNote(id: string, note: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'NoteAdded', ensureText(note, 'note'), i => { if (!canOperate(a, i)) throw new Error('Only assigned operators may add notes.'); return {}; }, expectedVersion); }
export async function resolveWorkItem(id: string, summary: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'Resolved', ensureText(summary, 'resolution summary'), i => { if (i.status !== 'InProgress' || !canOperate(a, i)) throw new Error('Only assigned InProgress work can be resolved.'); return { status: 'Resolved', resolution_summary: summary.trim(), resolved_at: serverTimestamp() as unknown as Timestamp, resolved_by: a.uid }; }, expectedVersion); }
export async function reopenWorkItem(id: string, note: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'Reopened', ensureText(note, 'note'), i => { if (i.status !== 'Resolved' || !canManage(a)) throw new Error('Only ShiftHead, Manager, or Admin may reopen resolved work.'); return { status: 'InProgress', resolved_at: null, resolved_by: '' }; }, expectedVersion); }
export async function closeWorkItem(id: string, expectedVersion?: number) { const a = activeActor(); return transact(id, a, 'Closed', '', i => { if (i.status !== 'Resolved' || !canManage(a)) throw new Error('Only supervisors may close resolved work.'); return { status: 'Closed', closed_at: serverTimestamp() as unknown as Timestamp, closed_by: a.uid }; }, expectedVersion); }
export async function listWorkItemActivities(id: string) { const a = activeActor(); const item = await getWorkItem(id); if (!item) throw new Error('Work Item not found.'); assertSite(a, item.site_id); const s = await getDocs(query(collection(db, 'workItems', id, 'activities'), orderBy('created_at', 'asc'))); return s.docs.map(d => d.data() as WorkItemActivity); }
