import type { ParkingCardStatus } from '../types';

export const normalizeParkingCardIdentifier = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim().normalize('NFKC').replace(/\s+/g, '').toLocaleUpperCase('en-US')
    : '';

const ALLOWED_TRANSITIONS: Readonly<Record<ParkingCardStatus, readonly ParkingCardStatus[]>> = {
  Available: ['InUse', 'Disabled', 'Suspended', 'Lost', 'VIP'],
  Reserved: ['Available', 'InUse'],
  InUse: ['Available'],
  Returned: ['Available'],
  Disabled: ['Available', 'Lost'],
  Suspended: ['Available'],
  Lost: ['ReplacementApproved'],
  Cancelled: [],
  Replaced: [],
  ReplacementApproved: ['Retired'],
  Retired: [],
  VIP: ['Available'],
};

export function isAllowedParkingCardTransition(previous: ParkingCardStatus, next: ParkingCardStatus): boolean {
  return ALLOWED_TRANSITIONS[previous].includes(next);
}

export function parkingCardHistoryEvent(action: string): string {
  if (action === 'CreateCard') return 'CARD_CREATED';
  if (action === 'EditCard' || action === 'RepairLegacyCard') return 'CARD_UPDATED';
  if (action === 'LockCard') return 'ENTRY';
  if (action === 'VehicleExitCompleted') return 'EXIT';
  if (action === 'VehicleExitCardLost' || action.includes('Lost')) return 'LOST';
  if (action === 'ReplaceCard' || action === 'ApproveReplacement') return 'REPLACEMENT_CREATED';
  if (action === 'VIPEntry') return 'VIP_SCAN';
  if (action === 'DeleteCard') return 'DELETED';
  if (action.includes('Scan') || action.includes('Lookup')) return 'CARD_SCANNED';
  if (action.startsWith('CardState:')) return 'STATUS_CHANGED';
  return 'CARD_UPDATED';
}
