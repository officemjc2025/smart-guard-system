export interface VehicleEntryFormState {
  card_number: string;
  vehicle_plate: string;
  vehicle_type: string;
  visitor_name: string;
  visitor_phone: string;
  target_room: string;
  target_unit_id: string;
  target_building: string;
  unit_lookup_status: 'matched' | 'manual' | undefined;
  purpose: string;
  note: string;
}

export interface VehicleEntryWorkspaceResetState {
  workspace: VehicleEntryWorkspaceState;
  entryForm: VehicleEntryFormState;
  entryPlatePhoto: '';
  entryVehiclePhoto: '';
  blacklistWarning: null;
  showQRScanner: false;
}

export function createInitialEntryForm(): VehicleEntryFormState {
  return {
    card_number: '',
    vehicle_plate: '',
    vehicle_type: 'รถยนต์',
    visitor_name: '',
    visitor_phone: '',
    target_room: '',
    target_unit_id: '',
    target_building: '',
    unit_lookup_status: undefined,
    purpose: 'เยี่ยมญาติ',
    note: '',
  };
}

export function createEntryWorkspaceResetState(): VehicleEntryWorkspaceResetState {
  return {
    workspace: createIdleVehicleEntryWorkspace(),
    entryForm: createInitialEntryForm(),
    entryPlatePhoto: '',
    entryVehiclePhoto: '',
    blacklistWarning: null,
    showQRScanner: false,
  };
}

export function createIdleVehicleEntryWorkspace(): VehicleEntryWorkspaceState {
  return createIdleWorkspace<VehicleSessionRecord>();
}

export function activateVehicleEntryWorkspace(
  session: VehicleSessionRecord,
): VehicleEntryWorkspaceState {
  return activateWorkspace({
    resourceId: session.session_id,
    resourceIdentity: normalizeEntryCardNumber(session.card_number),
    context: session,
  });
}

export function createEntryFormFromSession(session: Partial<VehicleEntryFormState> & {
  card_number: string;
}): VehicleEntryFormState {
  return {
    card_number: session.card_number,
    vehicle_plate: session.vehicle_plate || '',
    vehicle_type: session.vehicle_type || 'รถยนต์',
    visitor_name: session.visitor_name || '',
    visitor_phone: session.visitor_phone || '',
    target_room: session.target_room || '',
    target_unit_id: session.target_unit_id || '',
    target_building: session.target_building || '',
    unit_lookup_status: session.unit_lookup_status,
    purpose: session.purpose || 'เยี่ยมญาติ',
    note: session.note || '',
  };
}

export function normalizeEntryCardNumber(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, '').toLocaleUpperCase('en-US')
    : '';
}

export function entrySessionCardMatches(
  formCardNumber: string,
  sessionCardNumber: string,
): boolean {
  const formCard = normalizeEntryCardNumber(formCardNumber);
  const sessionCard = normalizeEntryCardNumber(sessionCardNumber);
  return Boolean(formCard && sessionCard && formCard === sessionCard);
}

export function assertEntrySessionCardIdentity(input: {
  activeSessionId: string;
  formCardNumber: string;
  sessionCardNumber: string;
}): void {
  if (!input.activeSessionId) return;
  if (!entrySessionCardMatches(input.formCardNumber, input.sessionCardNumber)) {
    throw new Error('เลขบัตรไม่ตรงกับ Vehicle Session ที่เลือก กรุณาพักรายการเดิมหรือเลือก Session ใหม่จากคิว');
  }
}
import type { VehicleSessionRecord } from '../types';
import {
  activateWorkspace,
  createIdleWorkspace,
  type WorkspaceState,
} from './workspaceEngine';

export type VehicleEntryWorkspaceState = WorkspaceState<VehicleSessionRecord>;
