import type { WorkItemStatus } from './workItemService';

export function isAllowedWorkItemTransition(from: WorkItemStatus, to: WorkItemStatus, role: string, resolutionSummary = '') {
  const normal = (from === 'Open' && to === 'Acknowledged') || (from === 'Acknowledged' && to === 'InProgress') || (from === 'InProgress' && ['Waiting', 'Resolved'].includes(to)) || (from === 'Waiting' && to === 'InProgress') || (from === 'Resolved' && to === 'Closed');
  const reopen = from === 'Resolved' && to === 'InProgress' && ['ShiftHead', 'Manager', 'Admin'].includes(role);
  return (normal || reopen) && (to !== 'Resolved' || Boolean(resolutionSummary.trim()));
}
