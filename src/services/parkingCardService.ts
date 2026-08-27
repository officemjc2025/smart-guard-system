import {
  collection,
  doc,
  getDocs,
  getDoc,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { VIP_CARD_ENTRY_ENABLED } from '../config/features';
import type { ImportPreview } from './importExport/excelImportService';
import type { ParkingCardRecord, ParkingCardStatus, VehicleLogRecord } from '../types';
import { canonicalParkingCardStatus, normalizeParkingCardStatus } from './parkingCardStatus';
import { sanitizeAndValidateFirestoreData } from './firestoreData';
import { appendSessionActivityInTransaction } from './vehicleSessionActivityService';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FUNCTIONS_REGION } from '../config/firebaseFunctions';
import { createUuid } from '../utils/uuid';
import { toEpochMillis } from '../utils/dateTime';
import {
  isAllowedParkingCardTransition,
  normalizeParkingCardIdentifier,
  parkingCardHistoryEvent,
} from './parkingCardDomain';

export { normalizeParkingCardStatus } from './parkingCardStatus';

export { VIP_CARD_ENTRY_ENABLED };
export const DUPLICATE_CARD_MESSAGE = 'บัตรนี้กำลังใช้งานและมีรถอยู่ในพื้นที่ ไม่อนุญาตให้ลงทะเบียนรถเข้าซ้ำ';
export const LEGACY_CARD_MESSAGE = 'พบบัตรเดิมในระบบแต่ยังไม่ได้ผูกกับพื้นที่\nกรุณาให้ผู้ดูแลระบบตรวจสอบและ Migration ข้อมูลบัตร';

export class ParkingCardWorkflowError extends Error {
  constructor(message: string, readonly code: 'not-found' | 'legacy-unassigned' | 'in-use' | 'unavailable' | 'vip-disabled' | 'illegal-transition' | 'duplicate-log' | 'already-exited') {
    super(message);
    this.name = 'ParkingCardWorkflowError';
  }
}

export type VehicleExitWarningCode = 'CARD_NOT_FOUND' | 'CARD_DISABLED' | 'CARD_LOST' | 'CARD_CANCELLED' | 'NO_ACTIVE_VEHICLE' | 'MULTIPLE_ACTIVE_LOGS' | 'SITE_MISMATCH' | 'LEGACY_SITE_MISSING';
export interface VehicleExitAccountContext { operatorName: string; role: string; accountUid?: string }
export interface ActiveVehicleLookupResult {
  success: boolean;
  card?: ParkingCardRecord;
  vehicleLog?: VehicleLogRecord;
  reason?: string;
  warningCode?: VehicleExitWarningCode;
}
export interface VehicleExitInput {
  exitPlatePhotoUrl?: string;
  exitVehiclePhotoUrl?: string;
  exitNote?: string;
  abnormalNote?: string;
  lostCard?: boolean;
  lostCardReason?: string;
}

export function parkingCardOperationError(operation: string, cardNumber: string, reason: unknown, role: string) {
  const data: Record<string, unknown> = typeof reason === 'object' && reason !== null ? Object.fromEntries(Object.entries(reason)) : {};
  const code = text(data.code) || 'unknown';
  const message = reason instanceof Error ? reason.message : String(reason);
  return `Operation: ${operation}\nCard Number: ${cardNumber || '-'}\nError Code: ${code}\nError Message: ${message}\nRequested site_id: ${currentSiteId()}\nCurrent account UID: ${auth.currentUser?.uid || 'not-authenticated'}\nCurrent role: ${role}`;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const dateText = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : text(value);
export const normalizeCardNumber = normalizeParkingCardIdentifier;
export const normalizeQrValue = normalizeParkingCardIdentifier;
export const isValidCardNumber = (value: unknown) => {
  const cardNumber = text(value);
  return cardNumber.length > 0 && cardNumber.length <= 64 && /^[A-Za-z0-9 /_-]+$/.test(cardNumber) && !/[\u0000-\u001F\u007F]/.test(cardNumber);
};
const currentSiteId = () => sessionStorage.getItem('selected_site_id') || 'site-01';
const currentIdentity = (operatorName: string) => {
  const accountUid = auth.currentUser?.uid || '';
  if (!accountUid) throw new Error('Authenticated account is required for parking-card operations.');
  return { accountUid, operatorId: accountUid, operatorName };
};

const activeVehicleStatus = (value: unknown) => ['กำลังจอด', 'active', 'parked', 'inuse', 'in_use', 'ใช้งานอยู่', 'vehicleinside'].includes(text(value).toLocaleLowerCase('en-US'));
const vehicleLogFromData = (id: string, value: unknown): VehicleLogRecord => {
  const data: Record<string, unknown> = typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  const vehicleTypes: VehicleLogRecord['vehicle_type'][] = ['รถยนต์', 'จักรยานยนต์', 'รถส่งของ', 'อื่นๆ'];
  const vehicleTypeValue = text(data.vehicle_type);
  return {
    log_id: text(data.log_id) || id,
    vehicle_session_id: text(data.vehicle_session_id) || undefined,
    site_id: text(data.site_id),
    card_number: text(data.card_number) || text(data.card_id) || text(data.parking_card_number),
    parking_card_id: text(data.parking_card_id) || undefined,
    vehicle_plate: text(data.vehicle_plate),
    vehicle_type: vehicleTypes.find(item => item === vehicleTypeValue) || 'อื่นๆ',
    visitor_name: text(data.visitor_name), visitor_phone: text(data.visitor_phone), target_room: text(data.target_room),
    target_unit_id: text(data.target_unit_id) || undefined, target_building: text(data.target_building) || undefined,
    unit_lookup_status: data.unit_lookup_status === 'matched' ? 'matched' : data.unit_lookup_status === 'manual' ? 'manual' : undefined,
    purpose: text(data.purpose), entry_time: dateText(data.entry_time), exit_time: dateText(data.exit_time) || undefined,
    entry_plate_photo_url: text(data.entry_plate_photo_url) || undefined, entry_vehicle_photo_url: text(data.entry_vehicle_photo_url) || undefined,
    exit_plate_photo_url: text(data.exit_plate_photo_url) || undefined, exit_vehicle_photo_url: text(data.exit_vehicle_photo_url) || undefined,
    workflow_status: data.workflow_status === 'completed' ? 'completed' : data.workflow_status === 'active' ? 'active' : undefined,
    status: activeVehicleStatus(data.status) ? 'กำลังจอด' : 'ออกแล้ว', recorded_by: text(data.recorded_by), note: text(data.note) || undefined,
    created_at: dateText(data.created_at), updated_at: dateText(data.updated_at), login_email: text(data.login_email) || undefined,
    operator_name: text(data.operator_name) || undefined,
  };
};

export const parkingCardStatusOrNull = canonicalParkingCardStatus;

export function normalizeParkingCardData(id: string, value: unknown): ParkingCardRecord {
  const data: Record<string, unknown> = typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  const originalStatus = text(data.status);
  const status = normalizeParkingCardStatus(text(data.status_normalized) || originalStatus);
  const allowedTypes: ParkingCardRecord['card_type'][] = ['Temporary', 'VIP', 'Resident', 'Contractor', 'Staff', 'Other'];
  const rawType = text(data.card_type) === 'Normal' ? 'Temporary' : text(data.card_type);
  const cardType = allowedTypes.includes(rawType as ParkingCardRecord['card_type']) ? rawType as ParkingCardRecord['card_type'] : 'Temporary';
  const cardNumber = text(data.card_number);
  const qrValue = text(data.qr_code_value);
  return {
    firestore_document_id: text(data.firestore_document_id) || id,
    card_id: text(data.card_id) || id,
    site_id: text(data.site_id),
    card_number: cardNumber,
    card_number_normalized: text(data.card_number_normalized) || normalizeCardNumber(cardNumber),
    qr_code_value: qrValue,
    qr_code_normalized: text(data.qr_code_normalized) || normalizeQrValue(qrValue),
    card_type: cardType,
    status,
    status_normalized: status,
    status_original: originalStatus || undefined,
    current_vehicle_plate: text(data.current_vehicle_plate) || undefined,
    current_vehicle_log_id: text(data.current_vehicle_log_id) || undefined,
    current_vehicle_session_id: text(data.current_vehicle_session_id) || undefined,
    last_activity_at: dateText(data.last_activity_at) || undefined,
    member_id: text(data.member_id) || undefined,
    lost_reason: text(data.lost_reason) || undefined,
    lost_at: dateText(data.lost_at) || undefined,
    reported_by: text(data.reported_by) || undefined,
    reported_by_account_uid: text(data.reported_by_account_uid) || undefined,
    related_vehicle_log_id: text(data.related_vehicle_log_id) || undefined,
    replacement_card_id: text(data.replacement_card_id) || undefined,
    replaced_by_card_id: text(data.replaced_by_card_id) || undefined,
    replaced_by_document_id: text(data.replaced_by_document_id) || undefined,
    replacement_for_card_id: text(data.replacement_for_card_id) || undefined,
    replacement_for_document_id: text(data.replacement_for_document_id) || undefined,
    replacement_reason: text(data.replacement_reason) || undefined,
    replacement_at: dateText(data.replacement_at) || undefined,
    replacement_by: text(data.replacement_by) || undefined,
    created_by: text(data.created_by) || undefined,
    replacement_approved: data.replacement_approved === true,
    replacement_approved_by: text(data.replacement_approved_by) || undefined,
    replacement_approved_at: dateText(data.replacement_approved_at) || undefined,
    note: text(data.note) || undefined,
    created_at: dateText(data.created_at),
    updated_at: dateText(data.updated_at),
  };
}

export function normalizeParkingCard(snapshot: QueryDocumentSnapshot<DocumentData>): ParkingCardRecord {
  return normalizeParkingCardData(snapshot.id, snapshot.data());
}

export async function listParkingCards() {
  const snapshot = await getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', currentSiteId())));
  return snapshot.docs.map(normalizeParkingCard);
}

export async function listParkingCardsForManagement(includeLegacy: boolean) {
  const snapshot = includeLegacy
    ? await getDocs(collection(db, 'parkingCards'))
    : await getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', currentSiteId())));
  return snapshot.docs.map(normalizeParkingCard).filter(card => includeLegacy ? (!card.site_id || card.site_id === currentSiteId()) : card.site_id === currentSiteId());
}

export async function repairLegacyParkingCard(documentId: string, operatorName: string) {
  const identity = currentIdentity(operatorName);
  const targetSite = currentSiteId();
  const reference = doc(db, 'parkingCards', documentId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Legacy parking card was not found.');
    const card = normalizeParkingCardData(snapshot.id, snapshot.data());
    if (card.site_id) throw new Error(`Card is already assigned to site ${card.site_id}.`);
    const changes = {
      firestore_document_id: snapshot.id, site_id: targetSite, card_number_normalized: normalizeCardNumber(card.card_number), qr_code_value: card.qr_code_value || card.card_number,
      qr_code_normalized: normalizeQrValue(card.qr_code_value || card.card_number), status_normalized: card.status,
      card_type: card.card_type, created_at: card.created_at || new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    transaction.update(reference, changes);
    const audit = auditRecord(operatorName, { ...card, site_id: targetSite }, card.current_vehicle_log_id || '', 'RepairLegacyCard', card.status, card.status, `Assigned missing site to ${targetSite}`);
    writeAuditWithCardHistory(transaction, audit, { account_uid: identity.accountUid });
  });
  const verified = await getDoc(reference);
  if (!verified.exists() || text(verified.data().site_id) !== targetSite) throw new Error('Legacy repair verification failed.');
  return normalizeParkingCardData(verified.id, verified.data());
}

async function cardSnapshotByNumber(scannedValue: string) {
  const siteId = currentSiteId();
  const normalizedQr = normalizeQrValue(scannedValue);
  const normalizedCard = normalizeCardNumber(scannedValue);
  const lookups = [
    query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('qr_code_normalized', '==', normalizedQr), limit(2)),
    query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('card_number_normalized', '==', normalizedCard), limit(2)),
    query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('qr_code_value', '==', text(scannedValue)), limit(2)),
    query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('card_number', '==', text(scannedValue)), limit(2)),
  ];
  for (const lookup of lookups) {
    const result = await getDocs(lookup);
    if (result.size > 1) throw new Error(`Duplicate parking-card master records found for ${text(scannedValue)}.`);
    if (result.docs[0]) return result.docs[0];
  }
  if (text(scannedValue) && !text(scannedValue).includes('/')) {
    const direct = await getDoc(doc(db, 'parkingCards', text(scannedValue)));
    if (direct.exists() && text(direct.data().site_id) === siteId) return direct;
  }
  try {
    const legacy = await getDocs(collection(db, 'parkingCards'));
    const match = legacy.docs.find(item => !text(item.data().site_id)
      && (normalizeQrValue(item.data().qr_code_value) === normalizedQr || normalizeCardNumber(item.data().card_number) === normalizedCard));
    if (match) throw new ParkingCardWorkflowError(LEGACY_CARD_MESSAGE, 'legacy-unassigned');
  } catch (reason) {
    if (reason instanceof ParkingCardWorkflowError) throw reason;
  }
  return null;
}

function auditRecord(operatorName: string, card: Pick<ParkingCardRecord, 'card_id' | 'card_number' | 'site_id'> | null, vehicleLogId: string, action: string, previousState: string, newState: string, reason = '', result = 'Success') {
  const identity = currentIdentity(operatorName);
  const auditId = `AUD_${createUuid()}`;
  return {
    auditId,
    data: {
      audit_id: auditId,
      operator_id: identity.operatorId,
      account_uid: identity.accountUid,
      operator_name: identity.operatorName,
      user_name: identity.operatorName,
      site_id: card?.site_id || currentSiteId(),
      card_number: card?.card_number || '',
      vehicle_log_id: vehicleLogId,
      action,
      module_name: 'ParkingCards',
      record_id: card?.card_id || card?.card_number || '',
      previous_state: previousState,
      new_state: newState,
      old_value: previousState,
      new_value: newState,
      reason,
      action_result: result,
      timestamp: serverTimestamp(),
      created_at: new Date().toISOString(),
    },
  };
}

function writeAuditWithCardHistory(
  transaction: Transaction,
  audit: ReturnType<typeof auditRecord>,
  overrides: Record<string, unknown> = {},
) {
  const auditData = { ...audit.data, ...overrides };
  transaction.set(doc(db, 'auditLogs', audit.auditId), auditData);
  if (!text(auditData.record_id)) return;
  const historyId = `PCH_${createUuid()}`;
  transaction.set(doc(db, 'parkingCardHistory', historyId), {
    history_id: historyId,
    event_type: parkingCardHistoryEvent(text(auditData.action)),
    parking_card_id: text(auditData.record_id),
    card_number: text(auditData.card_number),
    site_id: text(auditData.site_id),
    vehicle_log_id: text(auditData.vehicle_log_id),
    operator_id: text(auditData.operator_id),
    operator_name: text(auditData.operator_name),
    previous_state: text(auditData.previous_state),
    new_state: text(auditData.new_state),
    reason: text(auditData.reason),
    action_result: text(auditData.action_result),
    occurred_at: serverTimestamp(),
    created_at: serverTimestamp(),
  });
}

function assertTransition(previous: ParkingCardStatus, next: ParkingCardStatus) {
  if (previous === 'InUse' && next === 'Lost') throw new ParkingCardWorkflowError('This card is linked to an active vehicle. Close the vehicle exit or use the Card Not Returned workflow first.', 'illegal-transition');
  if (!isAllowedParkingCardTransition(previous, next)) throw new ParkingCardWorkflowError(`Illegal parking-card transition: ${previous} → ${next}.`, 'illegal-transition');
}

export async function validateCard(cardNumber: string) {
  const snapshot = await cardSnapshotByNumber(cardNumber);
  if (!snapshot) throw new ParkingCardWorkflowError('ไม่พบข้อมูลบัตรจอดรถ', 'not-found');
  return normalizeParkingCard(snapshot);
}

export async function inspectParkingCardForEntry(cardNumber: string, operatorName: string) {
  let card: ParkingCardRecord;
  try { card = await validateCard(cardNumber); }
  catch (reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    const audit = auditRecord(operatorName, null, '', reason instanceof ParkingCardWorkflowError && reason.code === 'legacy-unassigned' ? 'LegacyCardScannedBeforeMigration' : 'CardLookupFailed', '', '', error.message, 'Blocked');
    await runTransaction(db, async transaction => { writeAuditWithCardHistory(transaction, audit); });
    throw reason;
  }
  let error: ParkingCardWorkflowError | null = null;
  if (card.status === 'InUse') error = new ParkingCardWorkflowError(DUPLICATE_CARD_MESSAGE, 'in-use');
  else if (card.replaced_by_card_id) error = new ParkingCardWorkflowError('This card has been cancelled. Replacement card has already been issued.', 'unavailable');
  else if (card.status === 'Disabled' || card.status === 'Suspended') error = new ParkingCardWorkflowError('This parking card is disabled.', 'unavailable');
  else if (card.status === 'Lost') error = new ParkingCardWorkflowError('This parking card was reported lost.', 'unavailable');
  else if (card.status === 'Cancelled' || card.status === 'Replaced') error = new ParkingCardWorkflowError('This parking card was cancelled and replaced.', 'unavailable');
  else if (card.status === 'Retired') error = new ParkingCardWorkflowError('This parking card has been retired.', 'unavailable');
  else if (card.card_type === 'VIP' && !VIP_CARD_ENTRY_ENABLED) error = new ParkingCardWorkflowError('VIP parking-card entry is disabled by configuration.', 'vip-disabled');
  else if (card.status !== 'Available' && card.status !== 'VIP') error = new ParkingCardWorkflowError(`Parking card is ${card.status} and cannot be used.`, 'unavailable');
  if (error) {
    const audit = auditRecord(operatorName, card, card.current_vehicle_log_id || '', 'EntryBlocked', card.status, card.status, error.message, 'Blocked');
    await runTransaction(db, async transaction => { writeAuditWithCardHistory(transaction, audit); });
    throw error;
  }
  return card;
}

export async function lockCard(log: VehicleLogRecord, operatorName: string) {
  const identity = currentIdentity(operatorName);
  const cardSnapshot = await cardSnapshotByNumber(log.card_number);
  const cardReference = cardSnapshot?.ref || null;
  const logReference = doc(db, 'vehicleLogs', log.log_id);
  const result = await runTransaction(db, async transaction => {
    const [currentCardSnapshot, existingLog] = await Promise.all([
      cardReference ? transaction.get(cardReference) : Promise.resolve(null),
      transaction.get(logReference),
    ]);
    const card = currentCardSnapshot?.exists() ? normalizeParkingCard(currentCardSnapshot) : null;
    if (existingLog.exists()) {
      const existing = existingLog.data();
      if (card?.status === 'InUse' && card.current_vehicle_log_id === log.log_id && existing.card_number === log.card_number && existing.vehicle_plate === log.vehicle_plate) return null;
      return new ParkingCardWorkflowError('Vehicle entry request conflicts with an existing log ID.', 'duplicate-log');
    }

    let blocked: ParkingCardWorkflowError | null = null;
    if (!card) blocked = new ParkingCardWorkflowError('Parking card not found.', 'not-found');
    else if (card.site_id !== log.site_id) blocked = new ParkingCardWorkflowError('Parking card belongs to another site.', 'unavailable');
    else if (card.status === 'InUse') blocked = new ParkingCardWorkflowError(DUPLICATE_CARD_MESSAGE, 'in-use');
    else if (card.card_type === 'VIP' && !VIP_CARD_ENTRY_ENABLED) blocked = new ParkingCardWorkflowError('VIP parking-card entry is disabled by configuration.', 'vip-disabled');
    else if (card.status !== 'Available' && card.status !== 'VIP') blocked = new ParkingCardWorkflowError(`Parking card is ${card.status} and cannot be used.`, 'unavailable');
    if (blocked) {
      const audit = auditRecord(operatorName, card, log.log_id, 'EntryBlocked', card?.status || 'NotFound', card?.status || 'NotFound', blocked.message, 'Blocked');
      writeAuditWithCardHistory(transaction, audit);
      return blocked;
    }

    const now = new Date().toISOString();
    const vipEntry = card?.card_type === 'VIP';
    transaction.set(logReference, {
      ...log,
      parking_card_id: card?.firestore_document_id,
      account_uid: identity.accountUid,
      operator_id: identity.operatorId,
      ...(vipEntry ? { status: 'ออกแล้ว', exit_time: now, note: [log.note, 'VIP entry event'].filter(Boolean).join(' • ') } : {}),
    });
    if (cardReference && !vipEntry) {
      assertTransition(card.status, 'InUse');
      transaction.update(cardReference, { card_type: 'Temporary', status: 'InUse', status_normalized: 'InUse', current_vehicle_plate: log.vehicle_plate, current_vehicle_log_id: log.log_id, last_activity_at: now, updated_at: now });
    }
    if (cardReference && vipEntry) transaction.update(cardReference, { last_activity_at: now, updated_at: now });
    const audit = auditRecord(operatorName, card, log.log_id, vipEntry ? 'VIPEntry' : 'LockCard', card?.status || '', vipEntry ? 'VIP' : 'InUse');
    writeAuditWithCardHistory(transaction, audit);
    return null;
  });
  if (result) throw result;
}

export const createVehicleEntryWithCard = lockCard;

async function returnedCardSnapshot(rawValue: string, siteId: string, includeLegacy: boolean) {
  const raw = text(rawValue);
  const lookups = [
    query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('qr_code_value', '==', raw), limit(2)),
    query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('card_number', '==', raw), limit(2)),
    query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('qr_code_normalized', '==', normalizeQrValue(raw)), limit(2)),
    query(collection(db, 'parkingCards'), where('site_id', '==', siteId), where('card_number_normalized', '==', normalizeCardNumber(raw)), limit(2)),
  ];
  for (const lookup of lookups) {
    const snapshot = await getDocs(lookup);
    if (snapshot.size > 1) return { duplicate: true as const };
    if (snapshot.docs[0]) return { duplicate: false as const, snapshot: snapshot.docs[0] };
  }
  if (includeLegacy) {
    const snapshot = await getDocs(collection(db, 'parkingCards'));
    const matches = snapshot.docs.filter(item => !text(item.data().site_id) && (
      text(item.data().qr_code_value) === raw || text(item.data().card_number) === raw ||
      normalizeQrValue(item.data().qr_code_value) === normalizeQrValue(raw) || normalizeCardNumber(item.data().card_number) === normalizeCardNumber(raw)
    ));
    if (matches.length > 1) return { duplicate: true as const };
    if (matches[0]) return { duplicate: false as const, snapshot: matches[0] };
  }
  return { duplicate: false as const };
}

export async function searchActiveVehicles(siteId: string, context: VehicleExitAccountContext): Promise<VehicleLogRecord[]> {
  const snapshot = context.role === 'Admin'
    ? await getDocs(collection(db, 'vehicleLogs'))
    : await getDocs(query(collection(db, 'vehicleLogs'), where('site_id', '==', siteId)));
  return snapshot.docs
    .map(item => vehicleLogFromData(item.id, item.data()))
    .filter(log => activeVehicleStatus(log.status) && !log.exit_time && log.workflow_status !== 'completed')
    .filter(log => log.site_id === siteId || (context.role === 'Admin' && !log.site_id));
}

async function resolveActiveVehicleByCard(rawValue: string, siteId: string, context: VehicleExitAccountContext): Promise<ActiveVehicleLookupResult> {
  const raw = text(rawValue);
  if (!raw) return { success: false, reason: 'Enter a Card Number or QR Code.', warningCode: 'CARD_NOT_FOUND' };
  let found = await returnedCardSnapshot(raw, siteId, context.role === 'Admin');
  if (found.duplicate) return { success: false, reason: 'Multiple parking-card master records match this value. Run data integrity review.', warningCode: 'MULTIPLE_ACTIVE_LOGS' };
  if (!found.snapshot) {
    const activeLogs = await searchActiveVehicles(siteId, context);
    const compactRaw = raw.toLocaleLowerCase().replace(/\s+/g, '');
    const plateMatches = activeLogs.filter(log => log.vehicle_plate.toLocaleLowerCase().replace(/\s+/g, '') === compactRaw);
    if (plateMatches.length > 1) return { success: false, reason: 'Multiple active vehicle logs match this plate. Run data integrity review.', warningCode: 'MULTIPLE_ACTIVE_LOGS' };
    if (plateMatches[0]) found = await returnedCardSnapshot(plateMatches[0].card_number, siteId, context.role === 'Admin');
  }
  if (!found.snapshot) return { success: false, reason: 'Parking card not found.', warningCode: 'CARD_NOT_FOUND' };
  const card = normalizeParkingCard(found.snapshot);
  if (card.site_id && card.site_id !== siteId) return { success: false, card, reason: 'Parking card belongs to another site.', warningCode: 'SITE_MISMATCH' };
  if (!card.site_id && context.role !== 'Admin') return { success: false, card, reason: LEGACY_CARD_MESSAGE, warningCode: 'LEGACY_SITE_MISSING' };
  const blocked: Partial<Record<ParkingCardStatus, [VehicleExitWarningCode, string]>> = {
    Disabled: ['CARD_DISABLED', 'This parking card is disabled and cannot be processed for normal exit.'],
    Cancelled: ['CARD_CANCELLED', 'This parking card is cancelled.'], Replaced: ['CARD_CANCELLED', 'This parking card has been replaced.'],
    Retired: ['CARD_CANCELLED', 'This parking card is retired.'],
  };
  const blockedStatus = blocked[card.status];
  if (blockedStatus) return { success: false, card, warningCode: blockedStatus[0], reason: blockedStatus[1] };
  const activeLogs = await searchActiveVehicles(siteId, context);
  const matches = activeLogs.filter(log => log.card_number === card.card_number || normalizeCardNumber(log.card_number) === normalizeCardNumber(card.card_number) || log.parking_card_id === card.firestore_document_id);
  if (matches.length > 1) return { success: false, card, reason: 'Cannot close this card because the active vehicle record is ambiguous. Run data integrity review.', warningCode: 'MULTIPLE_ACTIVE_LOGS' };
  if (!matches[0]) return { success: false, card, reason: 'No active vehicle linked to this card.', warningCode: 'NO_ACTIVE_VEHICLE' };
  if (card.status === 'Lost') return { success: false, card, vehicleLog: matches[0], reason: 'This card is already Lost. Use an authorized integrity-resolution path; it will not be released automatically.', warningCode: 'CARD_LOST' };
  return { success: true, card, vehicleLog: matches[0], warningCode: !card.site_id || !matches[0].site_id ? 'LEGACY_SITE_MISSING' : undefined };
}

async function auditVehicleLookup(result: ActiveVehicleLookupResult, context: VehicleExitAccountContext, action: string) {
  const audit = auditRecord(context.operatorName, result.card || null, result.vehicleLog?.log_id || '', action, '', result.warningCode || 'FOUND', result.reason || '', result.success ? 'Success' : 'Blocked');
  await runTransaction(db, async transaction => writeAuditWithCardHistory(transaction, audit));
}

export async function findActiveVehicleByCard(rawValue: string, siteId: string, context: VehicleExitAccountContext) {
  const result = await resolveActiveVehicleByCard(rawValue, siteId, context);
  await auditVehicleLookup(result, context, 'ManualActiveVehicleLookup');
  return result;
}

export async function scanReturnedParkingCard(rawValue: string, siteId: string, context: VehicleExitAccountContext) {
  const result = await resolveActiveVehicleByCard(rawValue, siteId, context);
  await auditVehicleLookup(result, context, 'ReturnedCardScan');
  return result;
}
export const getActiveVehicleExitDetails = findActiveVehicleByCard;

export function validateVehicleExitIntegrity(card: ParkingCardRecord, log: VehicleLogRecord, siteId: string) {
  if ((card.site_id && card.site_id !== siteId) || (log.site_id && log.site_id !== siteId)) throw new Error('SITE_MISMATCH: Card or vehicle belongs to another site.');
  if (log.status !== 'กำลังจอด' || log.exit_time || log.workflow_status === 'completed') {
    throw new ParkingCardWorkflowError('รถรายการนี้ออกจากพื้นที่แล้ว', 'already-exited');
  }
  if (!['InUse'].includes(card.status)) throw new Error(`Parking card is ${card.status}; exit transaction was blocked.`);
  if (card.current_vehicle_log_id && card.current_vehicle_log_id !== log.log_id) throw new Error('Parking card points to a different active vehicle log.');
}

async function applyVehicleSessionAnalytics(sessionId: string, siteId: string, workflow: string) {
  try {
    const callable = httpsCallable<Record<string, unknown>, unknown>(
      getFunctions(undefined, FUNCTIONS_REGION),
      'applyVehicleSessionAnalyticsUpdate',
    );
    await callable({ sessionId, siteId, workflow });
  } catch (error) {
    console.warn('[Vehicle Analytics Best-Effort Failure]', {
      sessionId,
      siteId,
      workflow,
      code:
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'unknown',
    });
  }
}

export async function completeVehicleExit(log: VehicleLogRecord, input: VehicleExitInput, context: VehicleExitAccountContext) {
  const operatorName = context.operatorName;
  const identity = currentIdentity(operatorName);
  const siteId = currentSiteId();
  const cardResult = await returnedCardSnapshot(log.card_number, siteId, context.role === 'Admin');
  if (cardResult.duplicate) throw new Error('Multiple parking-card master records match this vehicle log. Run data integrity review.');
  const cardSnapshot = cardResult.snapshot;
  if (!cardSnapshot) throw new ParkingCardWorkflowError('Parking card not found.', 'not-found');
  if (input.lostCard && !text(input.lostCardReason)) throw new Error('Lost Card Note is required.');
  let completedSessionId = '';
  try {
    await runTransaction(db, async transaction => {
    const sessionReference = log.vehicle_session_id ? doc(db, 'vehicleSessions', log.vehicle_session_id) : null;
    const [vehicleSnapshot, currentCardSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(doc(db, 'vehicleLogs', log.log_id)),
      transaction.get(cardSnapshot.ref),
      sessionReference ? transaction.get(sessionReference) : Promise.resolve(null),
    ]);
    if (!vehicleSnapshot.exists()) throw new Error('Active vehicle log no longer exists.');
    const vehicle = vehicleLogFromData(vehicleSnapshot.id, vehicleSnapshot.data());
    const card = normalizeParkingCard(currentCardSnapshot);
    validateVehicleExitIntegrity(card, vehicle, siteId);
    const nextStatus: ParkingCardStatus = input.lostCard ? 'Lost' : 'Available';
    transaction.update(vehicleSnapshot.ref, {
      site_id: vehicle.site_id || siteId, parking_card_id: card.firestore_document_id, status: 'ออกแล้ว', workflow_status: 'completed',
      exit_time: serverTimestamp(), updated_at: serverTimestamp(), exit_recorded_by: operatorName, exit_account_uid: identity.accountUid,
      exit_operator_id: identity.operatorId, exit_operator_name: operatorName, exit_role: context.role, exit_site_id: siteId,
      exit_note: text(input.exitNote), abnormal_note: text(input.abnormalNote), exit_plate_photo_url: text(input.exitPlatePhotoUrl), exit_vehicle_photo_url: text(input.exitVehiclePhotoUrl),
    });
    transaction.update(cardSnapshot.ref, {
      site_id: card.site_id || siteId, status: nextStatus, status_normalized: nextStatus, current_vehicle_plate: '', current_vehicle_log_id: '', last_activity_at: serverTimestamp(), updated_at: serverTimestamp(),
      related_vehicle_log_id: log.log_id,
      ...(input.lostCard ? { lost_at: serverTimestamp(), lost_reason: text(input.lostCardReason), reported_by: operatorName, reported_by_account_uid: identity.accountUid } : {}),
    });
    const audit = auditRecord(operatorName, card, log.log_id, input.lostCard ? 'VehicleExitCardLost' : 'VehicleExitCompleted', 'InUse', nextStatus, text(input.lostCardReason));
    writeAuditWithCardHistory(transaction, audit);
    if (sessionReference && sessionSnapshot?.exists()) {
      const sessionData = sessionSnapshot.data();
      const sessionVersion = typeof sessionData.sessionVersion === 'number' ? sessionData.sessionVersion : 0;
      const eventId = `SESSION_${createUuid()}`;
      transaction.update(sessionReference, {
        stage: 'Completed', status: 'Completed', queueStatus: 'Completed', current_owner: identity.accountUid,
        sessionVersion: sessionVersion + 1,
        last_updated_by: identity.accountUid, last_activity_at: serverTimestamp(),
        updated_at: serverTimestamp(), 'stage_updates.Completed': {
          updatedBy: identity.accountUid, updatedAt: serverTimestamp(),
        },
      });
      appendSessionActivityInTransaction(transaction, {
        sessionId: log.vehicle_session_id || '', siteId,
        action: 'VehicleExitCompleted', fromStage: sessionSnapshot.get('stage'),
        toStage: 'Completed', fromStatus: sessionSnapshot.get('status'), toStatus: 'Completed',
        actorName: operatorName, actorRole: context.role,
        details: { vehicle_log_id: log.log_id }, clientEventId: eventId,
      }, identity.accountUid);
      completedSessionId = log.vehicle_session_id || '';
    }
    });
  } catch (reason) {
    if (reason instanceof ParkingCardWorkflowError && reason.code === 'already-exited') throw reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const failureAudit = auditRecord(operatorName, normalizeParkingCard(cardSnapshot), log.log_id, 'VehicleExitTransactionFailure', 'InUse', 'InUse', message, 'Failed');
    try {
      await runTransaction(db, async transaction => writeAuditWithCardHistory(transaction, failureAudit));
    } catch (auditReason) {
      console.error('Vehicle exit failure audit could not be written:', auditReason);
    }
    throw reason;
  }
  if (completedSessionId) await applyVehicleSessionAnalytics(completedSessionId, siteId, 'Vehicle Exit');
  const completedSnapshot = await getDoc(doc(db, 'vehicleLogs', log.log_id));
  if (!completedSnapshot.exists()) throw new Error('Completed vehicle log could not be reloaded.');
  return vehicleLogFromData(completedSnapshot.id, completedSnapshot.data());
}

export const completeVehicleExitWithLostCard = (log: VehicleLogRecord, input: VehicleExitInput, context: VehicleExitAccountContext) => completeVehicleExit(log, { ...input, lostCard: true }, context);
export async function releaseCard(log: VehicleLogRecord, updates: Partial<VehicleLogRecord>, operatorName: string) {
  await completeVehicleExit(log, { exitPlatePhotoUrl: updates.exit_plate_photo_url, exitVehiclePhotoUrl: updates.exit_vehicle_photo_url, exitNote: updates.exit_note }, { operatorName, role: 'Guard' });
}
export const completeVehicleExitWithCard = releaseCard;

async function transitionCard(cardId: string, next: ParkingCardStatus, operatorName: string, reason = '', extra: Record<string, unknown> = {}) {
  const reference = doc(db, 'parkingCards', cardId);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new ParkingCardWorkflowError('Parking card not found.', 'not-found');
    const card = normalizeParkingCardData(snapshot.id, snapshot.data());
    if (card.site_id !== currentSiteId()) throw new Error('Parking card belongs to another site.');
    assertTransition(card.status, next);
    const now = new Date().toISOString();
    transaction.update(reference, { ...extra, status: next, status_normalized: next, card_type: next === 'VIP' ? 'VIP' : (card.card_type === 'VIP' ? 'Temporary' : card.card_type), last_activity_at: now, updated_at: now });
    const audit = auditRecord(operatorName, card, card.current_vehicle_log_id || '', `CardState:${card.status}->${next}`, card.status, next, reason);
    writeAuditWithCardHistory(transaction, audit);
    return { ...card, ...extra, status: next };
  });
}

export const suspendCard = (cardId: string, operatorName: string, reason: string) => transitionCard(cardId, 'Suspended', operatorName, reason);
export const disableParkingCard = (cardId: string, operatorName: string, reason: string) => transitionCard(cardId, 'Disabled', operatorName, reason);
export const activateCard = (cardId: string, operatorName: string, reason: string) => transitionCard(cardId, 'Available', operatorName, reason, { current_vehicle_plate: '' });
export const reportParkingCardLost = (cardId: string, operatorName: string, reason: string) => {
  const identity = currentIdentity(operatorName);
  return transitionCard(cardId, 'Lost', operatorName, reason, { lost_reason: reason, lost_at: new Date().toISOString(), reported_by: identity.operatorName, reported_by_account_uid: identity.accountUid });
};
export const markLost = reportParkingCardLost;
export const activateVIP = (cardId: string, operatorName: string, memberId: string, reason: string) => transitionCard(cardId, 'VIP', operatorName, reason, { member_id: memberId });
export const deactivateVIP = (cardId: string, operatorName: string, reason: string) => transitionCard(cardId, 'Available', operatorName, reason, { member_id: '' });

export async function approveReplacement(lostCardId: string, replacementCardId: string, operatorName: string, reason: string) {
  const lostRef = doc(db, 'parkingCards', lostCardId);
  const replacementRef = doc(db, 'parkingCards', replacementCardId);
  await runTransaction(db, async transaction => {
    const [lostSnapshot, replacementSnapshot] = await Promise.all([transaction.get(lostRef), transaction.get(replacementRef)]);
    if (!lostSnapshot.exists() || !replacementSnapshot.exists()) throw new Error('Lost or replacement parking card was not found.');
    const lost = normalizeParkingCardData(lostSnapshot.id, lostSnapshot.data());
    const replacement = normalizeParkingCardData(replacementSnapshot.id, replacementSnapshot.data());
    if (lost.site_id !== currentSiteId() || replacement.site_id !== lost.site_id) throw new Error('Replacement cards must belong to the same site.');
    assertTransition(lost.status, 'ReplacementApproved');
    if (replacement.status !== 'Available') throw new ParkingCardWorkflowError('Replacement card must be Available.', 'unavailable');
    const identity = currentIdentity(operatorName);
    const now = new Date().toISOString();
    transaction.update(lostRef, { status: 'ReplacementApproved', replacement_card_id: replacement.card_id, replacement_approved: true, replacement_approved_by: identity.operatorId, replacement_approved_at: now, updated_at: now });
    const audit = auditRecord(operatorName, lost, '', 'ApproveReplacement', 'Lost', 'ReplacementApproved', reason);
    writeAuditWithCardHistory(transaction, audit);
  });
}

export const retireCard = (cardId: string, operatorName: string, reason: string) => transitionCard(cardId, 'Retired', operatorName, reason);

export async function createParkingCard(card: ParkingCardRecord, operatorName: string, rowNumber?: number) {
  const identity = currentIdentity(operatorName);
  if (!isValidCardNumber(card.card_number)) throw new Error('หมายเลขบัตรไม่ถูกต้อง รองรับตัวอักษร ตัวเลข ช่องว่าง / - และ _ สูงสุด 64 ตัวอักษร');
  const normalizedCard = normalizeCardNumber(card.card_number);
  const qrValue = text(card.qr_code_value) || text(card.card_number);
  const normalizedQr = normalizeQrValue(qrValue);
  const duplicates = await getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', currentSiteId())));
  if (duplicates.docs.some(item => normalizeCardNumber(item.data().card_number) === normalizedCard)) throw new Error(`หมายเลขบัตร ${card.card_number} มีอยู่แล้ว`);
  if (duplicates.docs.some(item => normalizedQr && normalizeQrValue(item.data().qr_code_value) === normalizedQr)) throw new Error(`ค่า QR ${card.qr_code_value} มีอยู่แล้ว`);
  const reference = card.firestore_document_id ? doc(db, 'parkingCards', card.firestore_document_id) : doc(collection(db, 'parkingCards'));
  const prepared = sanitizeAndValidateFirestoreData({
    ...card,
    firestore_document_id: reference.id,
    site_id: currentSiteId(),
    card_number: text(card.card_number),
    card_number_normalized: normalizedCard,
    qr_code_value: qrValue,
    qr_code_normalized: normalizedQr,
    status_normalized: card.status,
    created_by: identity.accountUid,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }, rowNumber);
  await runTransaction(db, async transaction => {
    if ((await transaction.get(reference)).exists()) throw new Error('Parking card ID already exists.');
    if (!['Available', 'Suspended'].includes(card.status)) throw new ParkingCardWorkflowError('New parking card has an invalid initial state.', 'illegal-transition');
    transaction.set(reference, prepared);
    const audit = auditRecord(operatorName, { card_id: text(prepared.card_id), card_number: text(prepared.card_number), site_id: text(prepared.site_id) }, '', 'CreateCard', '', text(prepared.status));
    writeAuditWithCardHistory(transaction, audit);
  });
  const verified = await getDoc(reference);
  if (!verified.exists()) throw new Error('Card create was acknowledged but the Firestore document could not be re-read.');
  const result = normalizeParkingCardData(verified.id, verified.data());
  if (result.card_number !== text(prepared.card_number) || result.qr_code_value !== text(prepared.qr_code_value) || result.site_id !== text(prepared.site_id) || result.status !== normalizeParkingCardStatus(prepared.status)) {
    throw new Error('Card create verification failed because persisted values do not match the request.');
  }
  return result;
}

export async function updateParkingCardMetadata(cardId: string, fields: Pick<ParkingCardRecord, 'note'>, operatorName: string) {
  const reference = doc(db, 'parkingCards', cardId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Parking card not found.');
    const card = normalizeParkingCardData(snapshot.id, snapshot.data());
    transaction.update(reference, sanitizeAndValidateFirestoreData({ note: fields.note || '', updated_at: serverTimestamp() }));
    const audit = auditRecord(operatorName, card, card.current_vehicle_log_id || '', 'EditCard', card.note || '', fields.note || '');
    writeAuditWithCardHistory(transaction, audit);
  });
}

export interface ParkingCardEditInput {
  card_number: string;
  qr_code_value: string;
  card_type: ParkingCardRecord['card_type'];
  note?: string;
}

export async function updateParkingCard(documentId: string, fields: ParkingCardEditInput, operatorName: string) {
  if (!isValidCardNumber(fields.card_number)) throw new Error('หมายเลขบัตรไม่ถูกต้อง');
  const cardNumber = text(fields.card_number);
  const qrValue = text(fields.qr_code_value) || cardNumber;
  const cardNumberNormalized = normalizeCardNumber(cardNumber);
  const qrNormalized = normalizeQrValue(qrValue);
  const duplicates = await getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', currentSiteId())));
  if (duplicates.docs.some(item => item.id !== documentId && normalizeCardNumber(item.data().card_number) === cardNumberNormalized)) throw new Error(`หมายเลขบัตร ${cardNumber} มีอยู่แล้ว`);
  if (duplicates.docs.some(item => item.id !== documentId && normalizeQrValue(item.data().qr_code_value) === qrNormalized)) throw new Error(`ค่า QR ${qrValue} มีอยู่แล้ว`);
  const reference = doc(db, 'parkingCards', documentId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Parking card not found.');
    const card = normalizeParkingCard(snapshot);
    if (card.status === 'InUse' && cardNumber !== card.card_number) throw new Error('Cannot change Card Number while card is in use.');
    if (card.status === 'InUse' && qrValue !== card.qr_code_value) throw new Error('Cannot change QR Code while card is in use.');
    if (fields.card_type === 'VIP' && card.status !== 'VIP') throw new Error('VIP workflow is disabled and cannot be activated from Edit Card.');
    const updated = sanitizeAndValidateFirestoreData({ card_number: cardNumber, card_number_normalized: cardNumberNormalized, qr_code_value: qrValue, qr_code_normalized: qrNormalized, card_type: fields.card_type, note: text(fields.note), updated_at: serverTimestamp() });
    transaction.update(reference, updated);
    const audit = auditRecord(operatorName, card, card.current_vehicle_log_id || '', 'EditCard', JSON.stringify({ card_number: card.card_number, qr_code_value: card.qr_code_value, card_type: card.card_type, note: card.note }), JSON.stringify(updated));
    writeAuditWithCardHistory(transaction, audit);
  });
}

export async function deleteParkingCard(cardId: string, operatorName: string) {
  const reference = doc(db, 'parkingCards', cardId);
  const activeCheck = await checkParkingCardActiveReferences(cardId);
  if (!activeCheck.safe) throw new ParkingCardWorkflowError(activeCheck.reason || 'This card is currently in use and cannot be deleted.', 'in-use');
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) return;
    const card = normalizeParkingCardData(snapshot.id, snapshot.data());
    if (card.status === 'InUse' || card.current_vehicle_plate) throw new ParkingCardWorkflowError('This card is currently in use and cannot be deleted.', 'in-use');
    if (['Lost', 'Cancelled', 'Retired', 'Replaced'].includes(card.status) || card.replaced_by_card_id || card.replacement_for_card_id) throw new Error('Lost, retired, cancelled, or replacement-linked cards must remain in history and cannot be deleted.');
    transaction.delete(reference);
    const audit = auditRecord(operatorName, card, card.current_vehicle_log_id || '', 'DeleteCard', card.status, 'Deleted');
    writeAuditWithCardHistory(transaction, audit);
  });
  if ((await getDoc(reference)).exists()) throw new Error('Delete verification failed: Firestore document still exists.');
}

export async function checkParkingCardActiveReferences(documentId: string) {
  const [cardSnapshot, activeTransactions] = await Promise.all([
    getDoc(doc(db, 'parkingCards', documentId)),
    getDocs(query(collection(db, 'vehicleLogs'), where('site_id', '==', currentSiteId()), where('parking_card_id', '==', documentId), where('status', '==', 'กำลังจอด'), limit(1))),
  ]);
  if (!cardSnapshot.exists()) return { safe: false, reason: 'Parking card not found.', errorCode: 'not-found' };
  const card = normalizeParkingCard(cardSnapshot);
  if (card.status === 'InUse' || card.current_vehicle_plate) return { safe: false, reason: `Cannot delete ${card.card_number} because this card currently has an active vehicle.`, errorCode: 'active-vehicle' };
  if (!activeTransactions.empty) return { safe: false, reason: `Cannot delete ${card.card_number} because an active vehicle transaction references it.`, errorCode: 'active-transaction' };
  if (['Lost', 'Cancelled', 'Retired', 'Replaced'].includes(card.status)) return { safe: false, reason: `Cannot delete ${card.card_number} because ${card.status} cards must remain in history.`, errorCode: 'historical-status' };
  if (card.replaced_by_card_id || card.replacement_for_card_id) return { safe: false, reason: `Cannot delete ${card.card_number} because it is referenced by a replacement relationship.`, errorCode: 'replacement-reference' };
  return { safe: true as const, card };
}

export interface ParkingCardReplacementInput { card_number: string; qr_code_value: string; card_type: ParkingCardRecord['card_type']; note?: string; reason: string }
export async function replaceParkingCard(oldDocumentId: string, input: ParkingCardReplacementInput, operatorName: string) {
  if (!isValidCardNumber(input.card_number)) throw new Error('New Card Number is invalid.');
  if (!text(input.reason)) throw new Error('Replacement Reason is required.');
  if (input.card_type === 'VIP') throw new Error('VIP activation remains disabled.');
  const qrValue = text(input.qr_code_value) || text(input.card_number);
  const allCards = await getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', currentSiteId())));
  if (allCards.docs.some(item => normalizeCardNumber(item.data().card_number) === normalizeCardNumber(input.card_number))) throw new Error('New Card Number has already been used.');
  if (allCards.docs.some(item => normalizeQrValue(item.data().qr_code_value) === normalizeQrValue(qrValue))) throw new Error('New QR Code has already been used.');
  const oldReference = doc(db, 'parkingCards', oldDocumentId);
  const newReference = doc(collection(db, 'parkingCards'));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(oldReference);
    if (!snapshot.exists()) throw new Error('Original card not found.');
    const oldCard = normalizeParkingCard(snapshot);
    if (oldCard.status === 'InUse' || oldCard.current_vehicle_plate) throw new Error('Active cards must be exited before replacement.');
    if (oldCard.replaced_by_card_id) throw new Error('A replacement card has already been issued.');
    const identity = currentIdentity(operatorName);
    const newCard = sanitizeAndValidateFirestoreData({
      firestore_document_id: newReference.id, card_id: `C_${createUuid()}`, site_id: oldCard.site_id,
      card_number: text(input.card_number), card_number_normalized: normalizeCardNumber(input.card_number), qr_code_value: qrValue,
      qr_code_normalized: normalizeQrValue(qrValue), card_type: input.card_type,
      status: 'Available', status_normalized: 'Available', replacement_for_card_id: oldCard.card_id,
      replacement_for_document_id: oldCard.firestore_document_id,
      replacement_reason: text(input.reason), replacement_at: serverTimestamp(), replacement_by: identity.operatorId,
      note: text(input.note) || `Replacement for ${oldCard.card_number}`, created_at: serverTimestamp(), created_by: identity.operatorId, updated_at: serverTimestamp(),
    });
    transaction.set(newReference, newCard);
    const oldUpdate = sanitizeAndValidateFirestoreData({ status: oldCard.status === 'Cancelled' ? 'Cancelled' : 'Lost', status_normalized: oldCard.status === 'Cancelled' ? 'Cancelled' : 'Lost', ...(oldCard.status === 'Lost' || oldCard.status === 'Cancelled' ? {} : { lost_reason: text(input.reason), lost_at: serverTimestamp(), reported_by: identity.operatorName, reported_by_account_uid: identity.accountUid }), replaced_by_card_id: text(newCard.card_id), replaced_by_document_id: newReference.id, replacement_card_id: text(newCard.card_id), replacement_reason: text(input.reason), replacement_at: serverTimestamp(), replacement_by: identity.operatorId, updated_at: serverTimestamp() });
    transaction.update(oldReference, oldUpdate);
    const audit = auditRecord(operatorName, oldCard, '', 'ReplaceCard', oldCard.status, oldCard.status === 'Cancelled' ? 'Cancelled' : 'Lost', `Replacement issued: ${text(newCard.card_number)}. ${text(input.reason)}`);
    writeAuditWithCardHistory(transaction, audit, { new_value: JSON.stringify({ old_card_id: oldCard.card_id, new_card_id: text(newCard.card_id) }) });
  });
}

export async function getParkingCardHistory(card: ParkingCardRecord) {
  const [history, audits, vehicles] = await Promise.all([
    getDocs(query(collection(db, 'parkingCardHistory'), where('site_id', '==', currentSiteId()), where('parking_card_id', '==', card.card_id))),
    getDocs(query(collection(db, 'auditLogs'), where('site_id', '==', currentSiteId()), where('module_name', '==', 'ParkingCards'), where('record_id', '==', card.card_id))),
    getDocs(query(collection(db, 'vehicleLogs'), where('site_id', '==', currentSiteId()), where('parking_card_id', '==', card.firestore_document_id))),
  ]);
  return [
    ...history.docs.map(item => ({ id: item.id, kind: 'History', date: String(item.data().occurred_at?.toDate?.()?.toISOString?.() || item.data().created_at?.toDate?.()?.toISOString?.() || ''), action: text(item.data().event_type), operator: text(item.data().operator_name), oldValue: text(item.data().previous_state), newValue: text(item.data().new_state), relatedVehicleLog: text(item.data().vehicle_log_id), relatedReplacementCard: text(item.data().replacement_card_id), detail: text(item.data().reason) })),
    ...audits.docs.map(item => ({ id: item.id, kind: 'Audit', date: text(item.data().created_at) || String(item.data().timestamp?.toDate?.()?.toISOString?.() || ''), action: text(item.data().action), operator: text(item.data().operator_name) || text(item.data().user_name), oldValue: text(item.data().old_value), newValue: text(item.data().new_value), relatedVehicleLog: text(item.data().vehicle_log_id), relatedReplacementCard: text(item.data().replacement_card_id), detail: text(item.data().reason) })),
    ...vehicles.docs.map(item => ({ id: item.id, kind: 'Vehicle', date: text(item.data().entry_time), action: `Vehicle ${text(item.data().status)}`, operator: text(item.data().operator_name) || text(item.data().recorded_by), oldValue: '', newValue: text(item.data().status), relatedVehicleLog: text(item.data().log_id) || item.id, relatedReplacementCard: '', detail: `${text(item.data().vehicle_plate)} • ${text(item.data().entry_time)}` })),
  ].sort((left, right) => toEpochMillis(right.date) - toEpochMillis(left.date));
}

export async function bulkDisableParkingCards(cards: readonly ParkingCardRecord[], operatorName: string) {
  let disabled = 0;
  const skipped: Array<{ cardNumber: string; reason: string }> = [], failed: Array<{ cardNumber: string; reason: string }> = [];
  for (const card of cards) {
    if (card.status === 'InUse' || card.current_vehicle_plate || card.status !== 'Available') { skipped.push({ cardNumber: card.card_number, reason: `Status ${card.status} is not eligible` }); continue; }
    try { await disableParkingCard(card.firestore_document_id, operatorName, 'Bulk disable'); disabled += 1; } catch (reason) { failed.push({ cardNumber: card.card_number, reason: reason instanceof Error ? reason.message : String(reason) }); }
  }
  return { disabled, skipped, failed };
}

export async function bulkDeleteParkingCards(cards: readonly ParkingCardRecord[], operatorName: string) {
  let deleted = 0;
  const skipped: Array<{ cardNumber: string; reason: string }> = [], failed: Array<{ cardNumber: string; reason: string }> = [];
  for (const card of cards) {
    const check = await checkParkingCardActiveReferences(card.firestore_document_id);
    if (!check.safe) { skipped.push({ cardNumber: card.card_number, reason: check.reason || 'Not eligible' }); continue; }
    try { await deleteParkingCard(card.firestore_document_id, operatorName); deleted += 1; } catch (reason) { failed.push({ cardNumber: card.card_number, reason: reason instanceof Error ? reason.message : String(reason) }); }
  }
  return { deleted, skipped, failed };
}

export function exportSelectedParkingCards(cards: readonly ParkingCardRecord[]) {
  return cards.map(card => ({ ...card }));
}

export async function logParkingCardExport(operatorName: string, format: string, count: number) {
  const audit = auditRecord(operatorName, null, '', 'ExportCards', '', '', `${format}: ${count} cards`);
  await runTransaction(db, async transaction => { transaction.set(doc(db, 'auditLogs', audit.auditId), audit.data); });
}

export async function importParkingCards(preview: ImportPreview, operatorName: string) {
  let committed = 0;
  for (const row of preview.validRows) {
    const sanitizedRow = sanitizeAndValidateFirestoreData(row.data, row.rowNumber);
    const rawCardNumber = text(sanitizedRow.card_number);
    const rawQr = text(sanitizedRow.qr_code_value);
    const allCards = await getDocs(collection(db, 'parkingCards'));
    const match = allCards.docs.find(item => text(item.data().card_id) === row.id
      || normalizeCardNumber(item.data().card_number) === normalizeCardNumber(rawCardNumber)
      || (rawQr && normalizeQrValue(item.data().qr_code_value) === normalizeQrValue(rawQr)));
    if (match) {
      const existing = normalizeParkingCard(match);
      if (!existing.site_id) throw new Error(`บัตร ${rawCardNumber} ตรงกับข้อมูล Legacy กรุณา Migration ก่อน Import`);
      if (existing.site_id !== currentSiteId()) throw new Error(`บัตร ${rawCardNumber} อยู่ใน Site อื่น`);
      await updateParkingCardMetadata(existing.firestore_document_id, { note: text(sanitizedRow.note) || existing.note }, operatorName);
    } else {
      const explicitType = text(sanitizedRow.card_type);
      const cardType: ParkingCardRecord['card_type'] = ['Temporary', 'VIP', 'Resident', 'Contractor', 'Staff', 'Other'].includes(explicitType) ? explicitType as ParkingCardRecord['card_type'] : 'Temporary';
      const explicitStatus = parkingCardStatusOrNull(sanitizedRow.status);
      const status = explicitStatus || (cardType === 'VIP' ? 'VIP' : 'Available');
      const card = normalizeParkingCardData('', { ...sanitizedRow, card_id: row.id, qr_code_value: rawQr || rawCardNumber, card_type: cardType, status, status_normalized: status, site_id: currentSiteId(), created_at: '', updated_at: '' });
      await createParkingCard(card, operatorName, row.rowNumber);
    }
    committed += 1;
  }
  const audit = auditRecord(operatorName, null, '', 'ImportCards', '', '', `${preview.fileName}: ${committed} cards`);
  await runTransaction(db, async transaction => { transaction.set(doc(db, 'auditLogs', audit.auditId), audit.data); });
  return committed;
}
