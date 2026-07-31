import { currentOperationalShift, operationalShift } from './operationalShift';

type Data = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string'
  ? value.trim().normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '') : '';
const has = (value: unknown, aliases: string[]) => aliases.some(alias => text(value) === text(alias));
const present = (value: unknown) => Boolean(value);

export const patrolLifecycle = (item: Data, now = new Date()) => {
  const shift = operationalShift(item.checkin_time, now);
  return {
    current: Boolean(shift?.isCurrentShift),
    archived: Boolean(shift?.isShiftClosed && has(item.workflow_status, ['completed'])),
    carryOver: false,
    shift,
  };
};

export const contractorLifecycle = (item: Data, now = new Date()) => {
  const completed = has(item.status, ['ออกแล้ว', 'exited', 'completed'])
    && present(item.exit_time)
    && (!item.workflow_status || has(item.workflow_status, ['completed']))
    && !present(item.workspace_lock_uid);
  const original = operationalShift(item.entry_time, now);
  return { current: !completed, archived: completed, carryOver: !completed && original?.shiftId !== currentOperationalShift(now).shiftId, shift: original };
};

export const vehicleLifecycle = (item: Data, now = new Date()) => {
  const completed = has(item.status, ['ออกแล้ว', 'exited', 'completed'])
    && present(item.exit_time)
    && (!item.workflow_status || has(item.workflow_status, ['completed']));
  const original = operationalShift(item.entry_time, now);
  return { current: !completed, archived: completed, carryOver: !completed && original?.shiftId !== currentOperationalShift(now).shiftId, shift: original };
};

export const keyLifecycle = (item: Data, now = new Date()) => {
  const completed = has(item.status, ['คืนแล้ว', 'returned', 'completed'])
    && present(item.return_time) && present(item.return_photo_url) && present(item.return_signature_url);
  const original = operationalShift(item.checkout_time, now);
  return { current: !completed, archived: completed, carryOver: !completed && original?.shiftId !== currentOperationalShift(now).shiftId, shift: original };
};

export const incidentLifecycle = (item: Data, now = new Date()) => {
  const resolved = has(item.incident_status || item.status, ['resolved', 'closed', 'ปิดงานแล้ว']);
  const acknowledged = present(item.acknowledged_at)
    || has(item.incident_status, ['acknowledged', 'inprogress', 'resolved', 'closed']);
  const original = operationalShift(item.reported_at || item.created_at || item.incident_datetime, now);
  return {
    current: !resolved,
    archived: resolved,
    carryOver: !resolved && original?.shiftId !== currentOperationalShift(now).shiftId,
    unacknowledged: !acknowledged && !resolved,
    inProgress: has(item.incident_status || item.status, ['inprogress', 'กำลังดำเนินการ']),
    shift: original,
  };
};
