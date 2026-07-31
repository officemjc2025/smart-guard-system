import type { ContractorFormState } from './contractorWorkspace';

const STORAGE_KEY = 'smart_guard_contractor_offline_queue_v1';

export interface OfflineContractorEntry {
  localId: string;
  siteId: string;
  guardName: string;
  entryTime: string;
  form: ContractorFormState;
  idCardPhotoDataUrl: string;
  facePhotoDataUrl: string;
}

const readQueue = (): OfflineContractorEntry[] => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export function listOfflineContractors(): OfflineContractorEntry[] {
  return readQueue();
}

export function queueOfflineContractor(entry: OfflineContractorEntry): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...readQueue(), entry]));
}

export function removeOfflineContractor(localId: string): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(readQueue().filter(entry => entry.localId !== localId)),
  );
}
