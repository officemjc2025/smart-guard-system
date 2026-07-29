import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { UserRecord } from '../types';
import { listParkingCards } from './parkingCardService';
import { createPatrolPoint, listPatrolPoints } from './patrolService';
import { createKey, listKeys } from './keyService';
import { createSystemSetting, listSystemSettings } from './systemSettingsService';
import { writeAuditLog } from './auditService';
import { sanitizeAndValidateFirestoreData } from './firestoreData';

const timestampText = (value: unknown) =>
  value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : String(value || '');

const userRecord = (id: string, data: Record<string, unknown>): UserRecord => ({
  ...data,
  user_id: String(data.user_id || id),
  created_at: timestampText(data.created_at),
  updated_at: timestampText(data.updated_at),
} as UserRecord);

export async function listSystemUsers(): Promise<UserRecord[]> {
  const snapshot = await getDocs(collection(db, 'users'));
  return snapshot.docs.map(item => userRecord(item.id, item.data()));
}

export async function createSystemUser(user: UserRecord): Promise<void> {
  if (!user.user_id.trim()) throw new Error('user_id is required.');
  await setDoc(doc(db, 'users', user.user_id), sanitizeAndValidateFirestoreData({
    ...user,
    created_at: user.created_at || serverTimestamp(),
    updated_at: serverTimestamp(),
  }));
}

export async function deleteSystemUser(userId: string): Promise<void> {
  if (!userId.trim()) throw new Error('userId is required.');
  await deleteDoc(doc(db, 'users', userId));
}

export async function initializeSystemData(operatorName: string, loginEmail: string): Promise<void> {
  const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';
  const now = new Date().toISOString();

  if ((await listSystemUsers()).length === 0) {
    const users: UserRecord[] = [
      { user_id: 'U001', login_email: 'office.mjc2025@gmail.com', operator_name: 'แอดมิน สูงสุด', role: 'Admin', shift: 'ทั่วไป', phone: '0899999999', status: 'Active', created_at: now, updated_at: now },
      { user_id: 'U002', login_email: 'guard@example.com', operator_name: 'สมชาย แสนดี', role: 'Guard', shift: 'กะเช้า (06:00 - 18:00)', phone: '0812345678', status: 'Active', created_at: now, updated_at: now },
      { user_id: 'U003', login_email: 'guard@example.com', operator_name: 'วิชัย มีทอง', role: 'Guard', shift: 'กะเช้า (06:00 - 18:00)', phone: '0823456789', status: 'Active', created_at: now, updated_at: now },
      { user_id: 'U004', login_email: 'leader@example.com', operator_name: 'ประเสริฐ สิงห์โต', role: 'ShiftHead', shift: 'กะเช้า (06:00 - 18:00)', phone: '0856789012', status: 'Active', created_at: now, updated_at: now },
      { user_id: 'U005', login_email: 'manager@example.com', operator_name: 'จารุวรรณ ณ นคร', role: 'Manager', shift: 'ทั่วไป', phone: '0878901234', status: 'Active', created_at: now, updated_at: now },
      { user_id: 'U101', login_email: 'sandbox@example.com', operator_name: 'สมชาย แสนดี (รปภ.)', role: 'Guard', shift: 'กะเช้า (06:00 - 18:00)', phone: '0812345678', status: 'Active', created_at: now, updated_at: now },
      { user_id: 'U102', login_email: 'sandbox@example.com', operator_name: 'ประเสริฐ สิงห์โต (หัวหน้ากะ)', role: 'ShiftHead', shift: 'กะกลางวัน (06:00 - 18:00)', phone: '0856789012', status: 'Active', created_at: now, updated_at: now },
      { user_id: 'U103', login_email: 'sandbox@example.com', operator_name: 'แอดมิน สูงสุด (แอดมิน)', role: 'Admin', shift: 'ทั่วไป', phone: '0899999999', status: 'Active', created_at: now, updated_at: now },
    ];
    for (const user of users) await createSystemUser(user);
  }

  if ((await listParkingCards()).length === 0) {
    const cards = [
      { card_id: 'C001', card_number: 'P001', qr_code_value: 'P001_QR', status: 'InUse' as const, current_vehicle_plate: 'กข 1234', note: 'บัตรจอดรถชั่วคราวทั่วไป' },
      { card_id: 'C002', card_number: 'P002', qr_code_value: 'P002_QR', status: 'Available' as const, current_vehicle_plate: '', note: 'บัตรจอดรถชั่วคราวทั่วไป' },
      { card_id: 'C003', card_number: 'P003', qr_code_value: 'P003_QR', status: 'InUse' as const, current_vehicle_plate: '3กข 5678', note: 'บัตรจอดรถผู้รับเหมา' },
      { card_id: 'C004', card_number: 'P004', qr_code_value: 'P004_QR', status: 'Available' as const, current_vehicle_plate: '', note: 'บัตรจอดรถชั่วคราวทั่วไป' },
      { card_id: 'C005', card_number: 'P005', qr_code_value: 'P005_QR', status: 'Available' as const, current_vehicle_plate: '', note: 'บัตรจอดรถชั่วคราวทั่วไป' },
    ];
    for (const card of cards) {
      await setDoc(doc(db, 'parkingCards', card.card_id), sanitizeAndValidateFirestoreData({
        ...card,
        firestore_document_id: card.card_id,
        site_id: siteId,
        card_number_normalized: card.card_number.toLocaleUpperCase('en-US'),
        qr_code_normalized: card.qr_code_value.toLocaleUpperCase('en-US'),
        card_type: 'Temporary',
        status_normalized: card.status,
        current_vehicle_log_id: '',
        last_activity_at: serverTimestamp(),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      }));
    }
  }

  if ((await listPatrolPoints(siteId)).length === 0) {
    const points = [
      { patrol_point_id: 'PP001', point_name: 'จุดตรวจ Lobby ชั้น 1', location_detail: 'เสาด้านหน้าทางเข้าหลักหน้าเคาน์เตอร์นิติ', qr_code_value: 'PP001_QR', required_interval_minutes: 60, status: 'Active' as const },
      { patrol_point_id: 'PP002', point_name: 'จุดตรวจ ลานจอดรถ B1 เสา B12', location_detail: 'เสาโครงสร้างใกล้พัดลมดูดอากาศตัวใหญ่', qr_code_value: 'PP002_QR', required_interval_minutes: 120, status: 'Active' as const },
      { patrol_point_id: 'PP003', point_name: 'จุดตรวจ ห้องควบคุมไฟฟ้าชั้น M', location_detail: 'หน้าประตูห้องควบคุมควบคุมไฟฟ้าประธาน', qr_code_value: 'PP003_QR', required_interval_minutes: 120, status: 'Active' as const },
    ];
    for (const point of points) await createPatrolPoint(siteId, point);
  }

  if ((await listKeys(siteId)).length === 0) {
    const keys = [
      { key_id: 'KEY_R001', room_number: '101', key_type: 'ห้องพัก', key_label: 'กุญแจห้องพักสำรอง', status: 'Available', current_borrower_name: '', current_checkout_log_id: '', note: 'ตรวจสอบความปลอดภัยแล้ว' },
      { key_id: 'KEY_R002', room_number: 'EE01', key_type: 'ห้องไฟฟ้า', key_label: 'กุญแจห้องไฟฟ้าชั้น M', status: 'Checked Out', current_borrower_name: 'นายสมคิด ช่างไฟฟ้า', current_checkout_log_id: 'CON001', note: 'สำหรับเข้าปฏิบัติงานซ่อมบำรุง' },
      { key_id: 'KEY_R003', room_number: 'ME01', key_type: 'ห้องเครื่องจักร', key_label: 'กุญแจห้องควบคุมระบบปั๊มน้ำ', status: 'Available', current_borrower_name: '', current_checkout_log_id: '', note: 'กรุณาคืนหลังกะปฏิบัติการ' },
    ];
    for (const key of keys) await createKey(siteId, key);
  }

  if ((await listSystemSettings(siteId)).length === 0) {
    const settings = [
      { setting_key: 'building_name', setting_value: 'วิจิตรบรรจง คอนโดมิเนียม', setting_type: 'text', description: 'ชื่อของโครงการหรืออาคารในระบบ' },
      { setting_key: 'condo_name', setting_value: 'Vichitbanjong Condominium', setting_type: 'text', description: 'ชื่อคอนโดภาษาอังกฤษ' },
      { setting_key: 'default_shift_times', setting_value: '06:00 - 18:00 / 18:00 - 06:00', setting_type: 'text', description: 'เวลาเปลี่ยนกะมาตรฐานในระบบ' },
      { setting_key: 'patrol_interval_default', setting_value: '60', setting_type: 'number', description: 'รอบความถี่ในการเดินตรวจขั้นต่ำ (นาที)' },
      { setting_key: 'require_vehicle_photo', setting_value: 'true', setting_type: 'boolean', description: 'บังคับถ่ายรูปรถยนต์และป้ายทะเบียนตอนบันทึกเข้า' },
      { setting_key: 'require_key_signature', setting_value: 'true', setting_type: 'boolean', description: 'เปิดปิดการบังคับเซ็นชื่อเวลาเบิกกุญแจ' },
      { setting_key: 'require_patrol_qr', setting_value: 'true', setting_type: 'boolean', description: 'เปิดปิดการสแกน QR Code สำหรับตรวจสอบจุดตรวจพิกัด' },
    ];
    for (const setting of settings) {
      await createSystemSetting(siteId, { ...setting, updated_by: operatorName });
    }
  }

  await writeAuditLog(
    operatorName,
    'เริ่มสร้างค่าระบบเริ่มต้น (Initialize System Data)',
    'SystemSettings',
    'SYSTEM_INIT',
    '',
    'จัดเตรียมข้อมูลโครงสร้างพื้นฐานสำหรับระบบเป็นราย collection ที่ว่างอยู่โดยไม่เขียนทับข้อมูลจริง',
    loginEmail,
    operatorName,
  );
}
