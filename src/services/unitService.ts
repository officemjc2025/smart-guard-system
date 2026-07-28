import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { UnitRecord } from '../types';

export type UnitInput = Pick<UnitRecord, 'unit_id' | 'room_number' | 'building' | 'floor' | 'owner_name' | 'resident_name'> & {
  phone?: string;
  status: UnitRecord['status'];
};

const currentSiteId = () => sessionStorage.getItem('selected_site_id') || 'site-01';
const clean = (value: string | undefined) => (value || '').trim();

/** User-visible values remain intact; these helpers are only comparison/hash keys. */
export const normalizeUnitId = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
export const normalizeRoomNumber = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');

export async function createUnitDocumentId(siteId: string, unitId?: string, roomNumber?: string) {
  const normalizedSite = siteId.trim().normalize('NFKC').toLocaleLowerCase('en-US') || 'unknown-site';
  const identifier = normalizeUnitId(unitId || '') || normalizeRoomNumber(roomNumber || '') || crypto.randomUUID();
  const bytes = new TextEncoder().encode(`${normalizedSite}\u0000${identifier}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `unit_${hash}`;
}

function identity(operatorName: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated account is required for Unit operations.');
  return { uid, operatorName: clean(operatorName) || sessionStorage.getItem('selected_operator_name') || uid };
}

function auditData(operatorName: string, action: string, recordId: string, oldValue: string, newValue: string, result = 'Success') {
  const account = identity(operatorName);
  return {
    audit_id: `AUD_${crypto.randomUUID()}`,
    operator_id: account.uid,
    account_uid: account.uid,
    operator_name: account.operatorName,
    user_name: account.operatorName,
    site_id: currentSiteId(),
    action,
    module_name: 'units',
    record_id: recordId,
    old_value: oldValue,
    new_value: newValue,
    created_at: serverTimestamp(),
    action_result: result,
  };
}

export function sanitizeUnitInput(input: UnitInput, firestoreDocumentId: string, existing?: UnitRecord): UnitRecord {
  const now = new Date().toISOString();
  const roomNumber = clean(input.room_number).normalize('NFC');
  return {
    firestore_document_id: firestoreDocumentId,
    unit_id: clean(input.unit_id).normalize('NFC'),
    site_id: currentSiteId(),
    building: clean(input.building),
    room_number: roomNumber,
    floor: clean(input.floor),
    owner_name: clean(input.owner_name),
    resident_name: clean(input.resident_name),
    phone: clean(input.phone) || undefined,
    occupancy_status: input.status,
    status: input.status,
    searchable_text: [roomNumber, input.building, input.floor, input.owner_name, input.resident_name, input.phone].map(clean).join(' ').toLowerCase(),
    search_key: normalizeRoomNumber(roomNumber),
    is_active: input.status === 'Active',
    created_at: existing?.created_at || now,
    updated_at: now,
  };
}

async function assertUnique(unit: UnitRecord, ignoreId = '') {
  const siteId = currentSiteId();
  const snapshot = await getDocs(query(collection(db, 'units'), where('site_id', '==', siteId)));
  if (snapshot.docs.some(item => item.id !== ignoreId && normalizeUnitId(String(item.data().unit_id || '')) === normalizeUnitId(unit.unit_id))) throw new Error(`unit_id ${unit.unit_id} already exists in this site.`);
  if (snapshot.docs.some(item => item.id !== ignoreId && normalizeRoomNumber(String(item.data().room_number || '')) === normalizeRoomNumber(unit.room_number))) throw new Error(`Room ${unit.room_number} already exists in this site.`);
}

export async function createUnit(input: UnitInput, operatorName: string) {
  const documentId = await createUnitDocumentId(currentSiteId(), input.unit_id, input.room_number);
  const unit = sanitizeUnitInput({ ...input, status: input.status || 'Active' }, documentId);
  if (!unit.unit_id || !unit.room_number || !unit.building || !unit.floor) throw new Error('Unit ID, room number, building and floor are required.');
  await assertUnique(unit);
  const reference = doc(db, 'units', documentId);
  await runTransaction(db, async transaction => {
    if ((await transaction.get(reference)).exists()) throw new Error(`unit_id ${unit.unit_id} already exists.`);
    const audit = auditData(operatorName, 'UnitCreated', unit.unit_id, '', JSON.stringify(unit));
    transaction.set(reference, unit);
    transaction.set(doc(db, 'auditLogs', audit.audit_id), audit);
  });
  return unit;
}

export async function updateUnit(existing: UnitRecord, input: UnitInput, operatorName: string) {
  const documentId = existing.firestore_document_id || await createUnitDocumentId(existing.site_id, existing.unit_id, existing.room_number);
  const unit = sanitizeUnitInput(input, documentId, existing);
  if (unit.unit_id !== existing.unit_id) throw new Error('unit_id cannot be changed.');
  await assertUnique(unit, documentId);
  const reference = doc(db, 'units', documentId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Unit no longer exists.');
    const audit = auditData(operatorName, 'UnitUpdated', unit.unit_id, JSON.stringify(snapshot.data()), JSON.stringify(unit));
    transaction.set(reference, unit);
    transaction.set(doc(db, 'auditLogs', audit.audit_id), audit);
  });
  return unit;
}

export async function setUnitStatus(existing: UnitRecord, status: 'Active' | 'Inactive', operatorName: string) {
  const reference = doc(db, 'units', existing.firestore_document_id);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Unit no longer exists.');
    const updatedAt = new Date().toISOString();
    const audit = auditData(operatorName, status === 'Active' ? 'UnitActivated' : 'UnitSuspended', existing.unit_id, existing.status, status);
    transaction.update(reference, { firestore_document_id: existing.firestore_document_id, status, occupancy_status: status, is_active: status === 'Active', updated_at: updatedAt });
    transaction.set(doc(db, 'auditLogs', audit.audit_id), audit);
  });
}
