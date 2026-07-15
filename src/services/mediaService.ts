import { GuardLog } from '../types';

export async function uploadMedia(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

export async function fetchGuardLogs(): Promise<GuardLog[]> {
  const localLogs = localStorage.getItem('guard_logs');
  if (localLogs) {
    return JSON.parse(localLogs);
  }
  const defaultLogs: GuardLog[] = [
    {
      id: '1',
      guardName: 'John Doe',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      status: 'On Patrol',
      notes: 'South gate patrol completed. No suspicious activity.',
    },
    {
      id: '2',
      guardName: 'Jane Smith',
      timestamp: new Date(Date.now() - 7200000).toISOString(),
      status: 'Checked In',
      notes: 'Shift started. All guard systems operational.',
    }
  ];
  localStorage.setItem('guard_logs', JSON.stringify(defaultLogs));
  return defaultLogs;
}

export async function addGuardLog(log: Omit<GuardLog, 'id' | 'timestamp'>): Promise<GuardLog> {
  const newLog: GuardLog = {
    ...log,
    id: Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
  };
  const logs = await fetchGuardLogs();
  logs.unshift(newLog);
  localStorage.setItem('guard_logs', JSON.stringify(logs));
  return newLog;
}
