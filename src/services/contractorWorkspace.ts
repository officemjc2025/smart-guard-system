import type { ContractorLogRecord } from '../types';

export type ContractorWorkspaceLifecycle =
  | 'idle'
  | 'opening'
  | 'active'
  | 'releasing'
  | 'release-failed';

export interface ContractorFormState {
  contractor_name: string;
  id_card_number: string;
  phone: string;
  company: string;
  target_room: string;
  target_unit_id: string;
  unit_lookup_status: 'matched' | 'manual' | undefined;
  owner_name: string;
  work_type: string;
  note: string;
}

export interface ContractorWorkspaceState {
  lifecycle: ContractorWorkspaceLifecycle;
  contractorId: string;
  record: ContractorLogRecord | null;
  releaseError: string;
}

export const CONTRACTOR_ACTIVITY_LABELS = {
  entered: 'เข้าพื้นที่',
  warning: 'ตักเตือน',
  violation: 'การฝ่าฝืน',
  remark: 'หมายเหตุ',
  exit: 'ออกจากพื้นที่',
  custom: 'กำหนดเอง',
} as const;

export function createInitialContractorForm(): ContractorFormState {
  return {
    contractor_name: '',
    id_card_number: '',
    phone: '',
    company: '',
    target_room: '',
    target_unit_id: '',
    unit_lookup_status: undefined,
    owner_name: '',
    work_type: 'ซ่อมระบบแสงสว่าง',
    note: '',
  };
}

export function createIdleContractorWorkspace(): ContractorWorkspaceState {
  return {
    lifecycle: 'idle',
    contractorId: '',
    record: null,
    releaseError: '',
  };
}

export function activateContractorWorkspace(
  record: ContractorLogRecord,
): ContractorWorkspaceState {
  return {
    lifecycle: 'active',
    contractorId: record.contractor_log_id,
    record,
    releaseError: '',
  };
}

export function beginContractorWorkspaceRelease(
  workspace: ContractorWorkspaceState,
): ContractorWorkspaceState {
  if (!workspace.contractorId || !workspace.record) {
    throw new Error('Cannot release an inactive Contractor Workspace.');
  }
  return { ...workspace, lifecycle: 'releasing', releaseError: '' };
}

export function failContractorWorkspaceRelease(
  workspace: ContractorWorkspaceState,
  reason: unknown,
): ContractorWorkspaceState {
  if (!workspace.contractorId || !workspace.record) {
    throw new Error('Cannot preserve an inactive Contractor Workspace.');
  }
  return {
    ...workspace,
    lifecycle: 'release-failed',
    releaseError: reason instanceof Error ? reason.message : String(reason),
  };
}

export function contractorFormFromRecord(record: ContractorLogRecord): ContractorFormState {
  return {
    contractor_name: record.contractor_name || '',
    id_card_number: record.id_card_number || '',
    phone: record.phone || '',
    company: record.company || '',
    target_room: record.target_room || '',
    target_unit_id: record.target_unit_id || '',
    unit_lookup_status: record.unit_lookup_status,
    owner_name: record.owner_name || '',
    work_type: record.work_type || 'ซ่อมระบบแสงสว่าง',
    note: record.note || '',
  };
}

export function validateOptionalNationalId(value: string): string {
  const normalized = value.replace(/\s+/g, '');
  if (normalized && !/^\d{13}$/.test(normalized)) {
    throw new Error('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก หรือเว้นว่างได้');
  }
  return normalized;
}
