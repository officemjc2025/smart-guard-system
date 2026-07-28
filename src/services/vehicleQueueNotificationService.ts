import type { VehicleSessionRecord } from '../types';

const DISMISSED_KEY = 'smart_guard_queue_notification_dismissed';

export type QueueNotificationStatus = NotificationPermission | 'unsupported' | 'dismissed';

export function getQueueNotificationStatus(): QueueNotificationStatus {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (localStorage.getItem(DISMISSED_KEY) === 'true') return 'dismissed';
  return Notification.permission;
}

export function dismissQueueNotificationPrompt(): void {
  localStorage.setItem(DISMISSED_KEY, 'true');
}

export async function requestQueueNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'denied') return false;
  localStorage.removeItem(DISMISSED_KEY);
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

export function notifyQueueAssignment(session: VehicleSessionRecord): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification('ได้รับมอบหมายงานรถเข้า', {
    body: `บัตร ${session.card_number}${session.vehicle_plate ? ` · ${session.vehicle_plate}` : ''}`,
    tag: `vehicle-session-${session.session_id}`,
  });
}
