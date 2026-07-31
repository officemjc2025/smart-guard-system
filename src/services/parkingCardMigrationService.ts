import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { normalizeCardNumber, normalizeQrValue, parkingCardStatusOrNull } from './parkingCardService';
import { sanitizeAndValidateFirestoreData } from './firestoreData';
import type { ParkingCardStatus, ParkingCardType } from '../types';
import { createUuid } from '../utils/uuid';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const allowedTypes: readonly ParkingCardType[] = ['Temporary', 'VIP', 'Resident', 'Contractor', 'Staff', 'Other'];

export interface ParkingCardDuplicateGroup { normalizedValue: string; documentIds: string[]; values: string[] }
export interface ParkingCardMigrationCandidate {
  documentId: string;
  cardId: string;
  cardNumber: string;
  qrCodeValue: string;
  previousStatus: string;
  normalizedStatus: ParkingCardStatus | null;
  assignSiteId: boolean;
  hasCurrentVehicle: boolean;
  changes: Record<string, string>;
}
export interface ParkingCardAuditReport {
  totalDocuments: number; currentSiteDocuments: number; legacyMissingSiteId: number;
  duplicateCardNumbers: ParkingCardDuplicateGroup[]; duplicateQrValues: ParkingCardDuplicateGroup[];
  missingCardNumber: number; missingQrValue: number; invalidStatuses: number;
  activeCards: number; availableCards: number; suspendedCards: number; lostCards: number;
  recordsWithCurrentVehicle: number; recordsWithoutCurrentVehicle: number;
  migrationCandidates: ParkingCardMigrationCandidate[];
}
export interface ParkingCardMigrationResult { attempted: number; updated: number; failed: number; failures: string[] }

async function canonicalAdminContext() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('ต้องเข้าสู่ระบบก่อนตรวจสอบข้อมูลบัตร');
  const profile = await getDoc(doc(db, 'users', uid));
  const role = text(profile.data()?.role);
  const siteId = text(profile.data()?.site_id) || sessionStorage.getItem('selected_site_id') || 'site-01';
  if (role !== 'Admin') throw new Error('เฉพาะ Admin เท่านั้นที่สามารถ Migration ข้อมูลบัตรได้');
  return { uid, siteId, operatorName: text(profile.data()?.operator_name) || auth.currentUser?.displayName || uid };
}

async function writeMigrationAudit(context: Awaited<ReturnType<typeof canonicalAdminContext>>, action: string, recordId: string, reason: string, result = 'Success') {
  const auditId = `AUD_${createUuid()}`;
  const batch = writeBatch(db);
  batch.set(doc(db, 'auditLogs', auditId), {
    audit_id: auditId, operator_id: context.uid, account_uid: context.uid, operator_name: context.operatorName,
    user_name: context.operatorName, site_id: context.siteId, card_id: '', card_number: '', qr_code_value: '', vehicle_log_id: '',
    action, module_name: 'ParkingCards', record_id: recordId, previous_state: '', new_state: '', old_value: '', new_value: '',
    reason, action_result: result, timestamp: serverTimestamp(), created_at: new Date().toISOString(),
  });
  await batch.commit();
}

function duplicateGroups(records: Array<{ documentId: string; value: string }>, normalizer: (value: unknown) => string) {
  const groups = new Map<string, Array<{ documentId: string; value: string }>>();
  records.forEach(record => {
    const key = normalizer(record.value);
    if (key) groups.set(key, [...(groups.get(key) || []), record]);
  });
  return [...groups.entries()].filter(([, items]) => items.length > 1).map(([normalizedValue, items]) => ({ normalizedValue, documentIds: items.map(item => item.documentId), values: items.map(item => item.value) }));
}

/** Read-only: inspects cards without changing Firestore. */
export async function auditExistingParkingCards(siteId: string): Promise<ParkingCardAuditReport> {
  const snapshot = await getDocs(collection(db, 'parkingCards'));
  const records = snapshot.docs.map(item => ({ documentId: item.id, data: item.data() }));
  const migrationCandidates: ParkingCardMigrationCandidate[] = [];
  let currentSiteDocuments = 0, legacyMissingSiteId = 0, missingCardNumber = 0, missingQrValue = 0;
  let invalidStatuses = 0, activeCards = 0, availableCards = 0, suspendedCards = 0, lostCards = 0, recordsWithCurrentVehicle = 0;
  records.forEach(({ documentId, data }) => {
    const existingSite = text(data.site_id);
    if (existingSite === siteId) currentSiteDocuments += 1;
    if (!existingSite) legacyMissingSiteId += 1;
    const cardNumber = text(data.card_number);
    const qrValue = text(data.qr_code_value);
    const effectiveQrValue = qrValue || cardNumber;
    if (!cardNumber) missingCardNumber += 1;
    if (!qrValue) missingQrValue += 1;
    const normalizedStatus = parkingCardStatusOrNull(data.status_normalized || data.status);
    if (!normalizedStatus) invalidStatuses += 1;
    if (normalizedStatus === 'InUse') activeCards += 1;
    if (normalizedStatus === 'Available') availableCards += 1;
    if (normalizedStatus === 'Suspended') suspendedCards += 1;
    if (normalizedStatus === 'Lost') lostCards += 1;
    const hasCurrentVehicle = Boolean(text(data.current_vehicle_plate) || text(data.current_vehicle_log_id));
    if (hasCurrentVehicle) recordsWithCurrentVehicle += 1;
    if (existingSite && existingSite !== siteId) return;
    const rawType = text(data.card_type) === 'Normal' ? 'Temporary' : text(data.card_type);
    const cardType = allowedTypes.includes(rawType as ParkingCardType) ? rawType : 'Temporary';
    const changes: Record<string, string> = {};
    if (!existingSite) changes.site_id = siteId;
    if (text(data.card_type) !== cardType) changes.card_type = cardType;
    if (text(data.card_number_normalized) !== normalizeCardNumber(cardNumber)) changes.card_number_normalized = normalizeCardNumber(cardNumber);
    if (!qrValue && cardNumber) changes.qr_code_value = cardNumber;
    if (text(data.qr_code_normalized) !== normalizeQrValue(effectiveQrValue)) changes.qr_code_normalized = normalizeQrValue(effectiveQrValue);
    if (normalizedStatus && text(data.status_normalized) !== normalizedStatus) changes.status_normalized = normalizedStatus;
    if (!text(data.firestore_document_id)) changes.firestore_document_id = documentId;
    if (!text(data.created_at)) changes.created_at = text(data.updated_at) || new Date().toISOString();
    if (Object.keys(changes).length) migrationCandidates.push({ documentId, cardId: text(data.card_id) || documentId, cardNumber, qrCodeValue: qrValue, previousStatus: text(data.status), normalizedStatus, assignSiteId: !existingSite, hasCurrentVehicle, changes });
  });
  return {
    totalDocuments: records.length, currentSiteDocuments, legacyMissingSiteId,
    duplicateCardNumbers: duplicateGroups(records.map(record => ({ documentId: record.documentId, value: text(record.data.card_number) })), normalizeCardNumber),
    duplicateQrValues: duplicateGroups(records.map(record => ({ documentId: record.documentId, value: text(record.data.qr_code_value) })), normalizeQrValue),
    missingCardNumber, missingQrValue, invalidStatuses, activeCards, availableCards, suspendedCards, lostCards,
    recordsWithCurrentVehicle, recordsWithoutCurrentVehicle: records.length - recordsWithCurrentVehicle, migrationCandidates,
  };
}

export async function auditParkingCards() {
  const context = await canonicalAdminContext();
  const report = await auditExistingParkingCards(context.siteId);
  await writeMigrationAudit(context, 'LegacyAuditExecuted', 'parkingCards', JSON.stringify({ total: report.totalDocuments, legacy: report.legacyMissingSiteId, candidates: report.migrationCandidates.length }));
  for (const group of report.duplicateCardNumbers) await writeMigrationAudit(context, 'DuplicateCardNumberDetected', group.documentIds.join(','), group.values.join(' | '), 'ReviewRequired');
  for (const group of report.duplicateQrValues) await writeMigrationAudit(context, 'DuplicateQrDetected', group.documentIds.join(','), group.values.join(' | '), 'ReviewRequired');
  return report;
}

export async function dryRunParkingCardMigration() {
  const context = await canonicalAdminContext();
  const report = await auditExistingParkingCards(context.siteId);
  await writeMigrationAudit(context, 'MigrationDryRun', 'parkingCards', JSON.stringify({ candidates: report.migrationCandidates.length }));
  return { siteId: context.siteId, generatedAt: new Date().toISOString(), candidates: report.migrationCandidates, report };
}

export async function executeParkingCardMigration(dryRun: Awaited<ReturnType<typeof dryRunParkingCardMigration>>): Promise<ParkingCardMigrationResult> {
  const context = await canonicalAdminContext();
  if (dryRun.siteId !== context.siteId) throw new Error('Site ของ Dry Run ไม่ตรงกับบัญชี Admin ปัจจุบัน');
  let updated = 0;
  const failures: string[] = [];
  for (let start = 0; start < dryRun.candidates.length; start += 190) {
    const chunk = dryRun.candidates.slice(start, start + 190);
    const batch = writeBatch(db);
    chunk.forEach((candidate, index) => {
      batch.update(doc(db, 'parkingCards', candidate.documentId), sanitizeAndValidateFirestoreData({ ...candidate.changes, updated_at: serverTimestamp() }, start + index + 1));
      const auditId = `AUD_${createUuid()}`;
      batch.set(doc(db, 'auditLogs', auditId), {
        audit_id: auditId, operator_id: context.uid, account_uid: context.uid, operator_name: context.operatorName,
        user_name: context.operatorName, site_id: context.siteId, card_id: candidate.cardId, card_number: candidate.cardNumber,
        qr_code_value: candidate.qrCodeValue, vehicle_log_id: '', action: 'CardUpdatedByMigration', module_name: 'ParkingCards',
        record_id: candidate.cardId, previous_state: candidate.previousStatus, new_state: candidate.normalizedStatus || candidate.previousStatus,
        old_value: JSON.stringify({ documentId: candidate.documentId }), new_value: JSON.stringify(candidate.changes), reason: candidate.hasCurrentVehicle ? 'Active vehicle preserved; integrity review required' : 'Legacy compatibility normalization',
        action_result: 'Success', timestamp: serverTimestamp(), created_at: new Date().toISOString(),
      });
    });
    try { await batch.commit(); updated += chunk.length; }
    catch (reason) { console.error('Parking-card migration batch failed.', { start, reason }); failures.push(`รายการ ${start + 1}-${start + chunk.length}: Migration ไม่สำเร็จ`); }
  }
  await writeMigrationAudit(context, 'MigrationExecuted', 'parkingCards', JSON.stringify({ attempted: dryRun.candidates.length, updated, failed: dryRun.candidates.length - updated }), failures.length ? 'PartialFailure' : 'Success');
  return { attempted: dryRun.candidates.length, updated, failed: dryRun.candidates.length - updated, failures };
}

export function downloadParkingCardAuditCsv(report: ParkingCardAuditReport) {
  const header = ['document_id', 'card_id', 'card_number', 'qr_code_value', 'previous_status', 'normalized_status', 'assign_site_id', 'has_current_vehicle', 'changes'];
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = report.migrationCandidates.map(item => [item.documentId, item.cardId, item.cardNumber, item.qrCodeValue, item.previousStatus, item.normalizedStatus, item.assignSiteId, item.hasCurrentVehicle, JSON.stringify(item.changes)].map(escape).join(','));
  const url = URL.createObjectURL(new Blob(['\uFEFF', [header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `parking-card-audit-${Date.now()}.csv`; link.click(); URL.revokeObjectURL(url);
}
