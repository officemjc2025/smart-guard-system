import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { VehicleQueuePriority, VehicleQueueStatus } from '../types';

export interface RealtimeQueueMetrics {
  waiting: number;
  assigned: number;
  inProgress: number;
  waitingInformation: number;
  ready: number;
  assignedToMe: number;
  urgent: number;
  oldestWaitingSeconds: number;
}

export interface DailyAnalyticsRecord {
  site_id: string;
  date_key: string;
  timezone: string;
  schema_version: number;
  sessions_created: number;
  sessions_completed: number;
  sessions_cancelled: number;
  total_waiting_seconds: number;
  total_working_seconds: number;
  total_cycle_seconds: number;
  transfer_count: number;
  reassign_count: number;
  release_count: number;
  priority_change_count: number;
  priority_emergency_count: number;
  priority_high_count: number;
  priority_normal_count: number;
  priority_low_count: number;
}

export interface AnalyticsFilters {
  priority?: VehicleQueuePriority;
  queueStatus?: VehicleQueueStatus;
  assignedTo?: string;
}

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const reportQueryError = (queryName: string, reason: unknown) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error(`[OperationalAnalytics][${queryName}]`, {
    code: 'code' in error ? String(error.code) : undefined,
    message: error.message,
  });
  return error;
};

const dailyRecord = (data: Record<string, unknown>): DailyAnalyticsRecord => ({
  site_id: String(data.site_id || ''), date_key: String(data.date_key || ''),
  timezone: String(data.timezone || 'Asia/Bangkok'), schema_version: number(data.schema_version) || 1,
  sessions_created: number(data.sessions_created), sessions_completed: number(data.sessions_completed),
  sessions_cancelled: number(data.sessions_cancelled), total_waiting_seconds: number(data.total_waiting_seconds),
  total_working_seconds: number(data.total_working_seconds), total_cycle_seconds: number(data.total_cycle_seconds),
  transfer_count: number(data.transfer_count), reassign_count: number(data.reassign_count),
  release_count: number(data.release_count), priority_change_count: number(data.priority_change_count),
  priority_emergency_count: number(data.priority_emergency_count), priority_high_count: number(data.priority_high_count),
  priority_normal_count: number(data.priority_normal_count), priority_low_count: number(data.priority_low_count),
});

export function bangkokDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function assertBoundedDateRange(startDate: string, endDate: string, maxDays = 31) {
  const start = new Date(`${startDate}T00:00:00+07:00`);
  const end = new Date(`${endDate}T23:59:59.999+07:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw new Error('ช่วงวันที่ไม่ถูกต้อง');
  const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  if (days > maxDays) throw new Error(`ช่วงวันที่ต้องไม่เกิน ${maxDays} วัน`);
  return { start, end, days };
}

export function subscribeRealtimeQueueMetrics(
  siteId: string,
  currentUid: string,
  callback: (metrics: RealtimeQueueMetrics) => void,
  onError: (error: Error) => void,
  filters: AnalyticsFilters = {},
): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, 'vehicleSessions'),
      where('site_id', '==', siteId),
      where('queueStatus', 'in', ['Waiting', 'Assigned', 'In Progress', 'Waiting Information', 'Ready']),
      orderBy('queuePosition', 'asc'),
      limit(100),
    ),
    snapshot => {
      const sessions = snapshot.docs.map(item => item.data()).filter(item =>
        (!filters.priority || item.priority === filters.priority)
        && (!filters.queueStatus || item.queueStatus === filters.queueStatus)
        && (!filters.assignedTo || item.assignedTo === filters.assignedTo));
      const waiting = sessions.filter(item => item.queueStatus === 'Waiting');
      const now = Date.now();
      callback({
        waiting: waiting.length,
        assigned: sessions.filter(item => item.queueStatus === 'Assigned').length,
        inProgress: sessions.filter(item => item.queueStatus === 'In Progress').length,
        waitingInformation: sessions.filter(item => item.queueStatus === 'Waiting Information').length,
        ready: sessions.filter(item => item.queueStatus === 'Ready').length,
        assignedToMe: sessions.filter(item => item.assignedTo === currentUid).length,
        urgent: sessions.filter(item => item.priority === 'Emergency' || item.priority === 'High').length,
        oldestWaitingSeconds: waiting.length ? Math.max(...waiting.map(item => Math.max(0, Math.floor((now - (item.created_at?.toMillis?.() ?? now)) / 1000)))) : 0,
      });
    },
    reason => onError(reportQueryError('vehicleSessions.realtimeQueue', reason)),
  );
}

export async function getTodayOperationalMetrics(siteId: string): Promise<DailyAnalyticsRecord | null> {
  try {
    const snapshot = await getDoc(doc(db, 'siteAnalyticsDaily', `${siteId}_${bangkokDateKey()}`));
    return snapshot.exists() ? dailyRecord(snapshot.data()) : null;
  } catch (reason) {
    throw reportQueryError('siteAnalyticsDaily.today', reason);
  }
}

export async function getHistoricalDailyAnalytics(siteId: string, startDate: string, endDate: string): Promise<DailyAnalyticsRecord[]> {
  assertBoundedDateRange(startDate, endDate);
  try {
    const snapshot = await getDocs(query(
      collection(db, 'siteAnalyticsDaily'),
      where('site_id', '==', siteId),
      where('date_key', '>=', startDate),
      where('date_key', '<=', endDate),
      orderBy('date_key', 'asc'),
      limit(31),
    ));
    return snapshot.docs.map(item => dailyRecord(item.data()));
  } catch (reason) {
    throw reportQueryError('siteAnalyticsDaily.history', reason);
  }
}

const safeCsvCell = (value: string | number) => {
  const raw = String(value);
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replace(/"/g, '""')}"`;
};

export function exportOperationalAnalytics(
  records: DailyAnalyticsRecord[],
  metadata: { siteId: string; startDate: string; endDate: string; generatedBy: string },
): string {
  const rows: Array<Array<string | number>> = [
    ['report_name', 'Operational Analytics'],
    ['site_id', metadata.siteId],
    ['date_range', `${metadata.startDate}..${metadata.endDate}`],
    ['timezone', 'Asia/Bangkok'],
    ['generated_at', new Date().toISOString()],
    ['generated_by', metadata.generatedBy],
    ['schema_version', 1],
    [],
    ['date', 'created', 'completed', 'avg_waiting_seconds', 'avg_working_seconds', 'avg_cycle_seconds', 'transfer_count', 'reassign_count', 'emergency', 'high', 'normal', 'low'],
    ...records.map(item => {
      const completed = item.sessions_completed || 1;
      return [
        item.date_key, item.sessions_created, item.sessions_completed,
        Math.round(item.total_waiting_seconds / completed),
        Math.round(item.total_working_seconds / completed),
        Math.round(item.total_cycle_seconds / completed),
        item.transfer_count, item.reassign_count,
        item.priority_emergency_count, item.priority_high_count,
        item.priority_normal_count, item.priority_low_count,
      ];
    }),
  ];
  return rows.map(row => row.map(safeCsvCell).join(',')).join('\n');
}
