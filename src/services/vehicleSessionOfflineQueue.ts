import type { VehicleSessionPatch } from './vehicleSessionService';

const DATABASE_NAME = 'smart-guard-offline';
const STORE_NAME = 'vehicle-session-queue';

export interface OfflineVehicleSession {
  localId: string;
  cardValue: string;
  siteId: string;
  operatorName: string;
  actorRole: string;
  patch?: VehicleSessionPatch;
  platePhotoDataUrl?: string;
  vehiclePhotoDataUrl?: string;
  queuedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'localId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueOfflineVehicleSession(item: OfflineVehicleSession): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(item);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function listOfflineVehicleSessions(): Promise<OfflineVehicleSession[]> {
  const database = await openDatabase();
  const items = await new Promise<OfflineVehicleSession[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as OfflineVehicleSession[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return items.sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
}

export async function removeOfflineVehicleSession(localId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(localId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
