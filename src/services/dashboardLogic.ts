import { canonicalParkingCardStatus } from './parkingCardStatus';
import { incidentLifecycle } from './operationalLifecycle';
import { currentOperationalShift, operationalShift } from './operationalShift';

type RecordData = Record<string, unknown>;
type TimestampLike = { toDate(): Date };

export interface DashboardSummary {
  vehiclesIn: number;
  vehiclesOut: number;
  vehiclesCurrent: number;
  contractorsCurrent: number;
  keysCheckedOut: number;
  patrolDone: number;
  patrolTotal: number;
  patrolPending: number;
  patrolOverdue: number;
  incidentsToday: number;
  openIncidents: number;
  unacknowledgedIncidents: number;
  incidentsInProgress: number;
  blacklistAlerts: number;
  availableCards: number;
  cardsInUse: number;
  suspendedCards: number;
  lostCards: number;
  vipEntriesToday: number;
  recentIncidents: Array<Record<string, any>>;
}

const normalized = (value: unknown) => typeof value === 'string'
  ? value.trim().normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '')
  : '';
const hasStatus = (value: unknown, aliases: readonly string[]) =>
  aliases.some(alias => normalized(value) === normalized(alias));

export const dashboardDate = (value: unknown): Date | null => {
  const candidate = value && typeof value === 'object' && 'toDate' in value
    && typeof (value as TimestampLike).toDate === 'function'
    ? (value as TimestampLike).toDate()
    : value instanceof Date ? value
      : typeof value === 'number' || typeof value === 'string' ? new Date(value) : null;
  return candidate && !Number.isNaN(candidate.getTime()) ? candidate : null;
};

export function bangkokDayRange(date = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value || '';
  const start = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00+07:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

const isInRange = (value: unknown, range: { start: Date; end: Date }) => {
  const date = dashboardDate(value);
  return Boolean(date && date >= range.start && date < range.end);
};

const vehicleInside = (item: RecordData) =>
  hasStatus(item.status, ['กำลังจอด', 'active', 'parked', 'inuse', 'vehicleinside', 'inprogress'])
  && !dashboardDate(item.exit_time)
  && !hasStatus(item.workflow_status, ['completed', 'cancelled']);

const contractorInside = (item: RecordData) =>
  hasStatus(item.status, ['กำลังปฏิบัติงาน', 'active', 'inbuilding', 'inside', 'inprogress'])
  && !dashboardDate(item.exit_time)
  && !hasStatus(item.workflow_status, ['completed', 'cancelled']);

const keyCheckedOut = (item: RecordData) =>
  hasStatus(item.status, ['ถูกเบิก', 'checkedout', 'borrowed', 'inuse'])
  && !dashboardDate(item.return_time);

const incidentOpen = (item: RecordData) =>
  !hasStatus(item.status, ['ปิดงานแล้ว', 'closed', 'resolved']);

const isVipEntry = (item: RecordData) =>
  [item.access_type, item.visitor_type, item.card_type, item.parking_card_type]
    .some(value => normalized(value) === 'vip')
  || (typeof item.note === 'string' && item.note.split(' • ').includes('VIP entry event'));

export function calculateDashboardSummary(input: {
  vehicles: RecordData[];
  contractors: RecordData[];
  keys: RecordData[];
  patrols: RecordData[];
  patrolPoints: RecordData[];
  incidents: RecordData[];
  cards: RecordData[];
}, date = new Date()): DashboardSummary {
  const range = bangkokDayRange(date);
  const activePointIds = new Set(input.patrolPoints
    .filter(item => normalized(item.status) === 'active')
    .map(item => String(item.patrol_point_id || ''))
    .filter(Boolean));
  const currentShift = currentOperationalShift(date);
  const currentShiftPatrols = input.patrols.filter(item =>
    operationalShift(item.checkin_time, date)?.shiftId === currentShift.shiftId);
  const checkedPointIds = new Set(currentShiftPatrols
    .map(item => String(item.patrol_point_id || ''))
    .filter(id => activePointIds.has(id)));
  const cards = input.cards.map(item =>
    canonicalParkingCardStatus(item.status_normalized || item.status));
  const incidentReportedToday = input.incidents.filter(item =>
    isInRange(item.reported_at || item.created_at, range));

  return {
    vehiclesIn: input.vehicles.filter(item => isInRange(item.entry_time, range)).length,
    vehiclesOut: input.vehicles.filter(item => isInRange(item.exit_time, range)).length,
    vehiclesCurrent: input.vehicles.filter(vehicleInside).length,
    contractorsCurrent: input.contractors.filter(contractorInside).length,
    keysCheckedOut: input.keys.filter(keyCheckedOut).length,
    patrolDone: checkedPointIds.size,
    patrolTotal: activePointIds.size,
    patrolPending: Math.max(0, activePointIds.size - checkedPointIds.size),
    patrolOverdue: currentShiftPatrols.filter(item =>
      normalized(item.area_status) === 'abnormal' || hasStatus(item.status, ['ผิดปกติ'])).length,
    incidentsToday: incidentReportedToday.length,
    openIncidents: input.incidents.filter(incidentOpen).length,
    unacknowledgedIncidents: input.incidents.filter(item => incidentLifecycle(item, date).unacknowledged).length,
    incidentsInProgress: input.incidents.filter(item => incidentLifecycle(item, date).inProgress).length,
    blacklistAlerts: 0,
    availableCards: cards.filter(status => status === 'Available').length,
    cardsInUse: cards.filter(status => status === 'InUse').length,
    suspendedCards: cards.filter(status => status === 'Suspended').length,
    lostCards: cards.filter(status => status === 'Lost').length,
    vipEntriesToday: input.vehicles.filter(item =>
      isInRange(item.entry_time, range) && isVipEntry(item)).length,
    recentIncidents: [...input.incidents]
      .sort((left, right) =>
        (dashboardDate(right.reported_at || right.created_at || right.incident_datetime)?.getTime() || 0)
        - (dashboardDate(left.reported_at || left.created_at || left.incident_datetime)?.getTime() || 0))
      .slice(0, 3),
  };
}
