/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from './firebase';

export const SCHEMA = {
  Users: ['user_id', 'login_email', 'operator_name', 'role', 'shift', 'phone', 'status', 'created_at', 'updated_at'],
  ParkingCards: ['card_id', 'card_number', 'qr_code_value', 'status', 'current_vehicle_plate', 'note', 'created_at', 'updated_at'],
  VehicleLogs: ['log_id', 'card_number', 'vehicle_plate', 'vehicle_type', 'visitor_name', 'visitor_phone', 'target_room', 'purpose', 'entry_time', 'exit_time', 'entry_plate_photo_url', 'entry_vehicle_photo_url', 'exit_plate_photo_url', 'exit_vehicle_photo_url', 'status', 'recorded_by', 'note', 'created_at', 'updated_at', 'login_email', 'operator_name'],
  ContractorLogs: ['contractor_log_id', 'contractor_name', 'id_card_number', 'phone', 'company', 'target_room', 'owner_name', 'work_type', 'entry_time', 'exit_time', 'id_card_photo_url', 'face_photo_url', 'status', 'recorded_by', 'note', 'created_at', 'updated_at', 'login_email', 'operator_name'],
  KeyLogs: ['key_log_id', 'room_number', 'key_type', 'borrower_name', 'borrower_phone', 'borrower_id_number', 'purpose', 'checkout_time', 'return_time', 'issued_by', 'returned_by', 'signature_image_url', 'borrower_photo_url', 'document_photo_url', 'status', 'note', 'created_at', 'updated_at', 'login_email', 'operator_name'],
  PatrolPoints: ['patrol_point_id', 'point_name', 'location_detail', 'qr_code_value', 'required_interval_minutes', 'status', 'created_at', 'updated_at'],
  PatrolLogs: ['patrol_log_id', 'patrol_point_id', 'point_name', 'guard_name', 'shift_type', 'checkin_time', 'photo_url', 'status', 'abnormal_detail', 'incident_photo_url', 'note', 'created_at', 'login_email', 'operator_name'],
  IncidentReports: ['incident_id', 'incident_datetime', 'location', 'incident_type', 'description', 'photo_url', 'reported_by', 'shift_leader', 'management_note', 'status', 'created_at', 'updated_at', 'severity', 'assigned_to', 'resolved_at', 'login_email', 'operator_name'],
  Blacklist: ['blacklist_id', 'type', 'vehicle_plate', 'id_card_number', 'name', 'reason', 'severity', 'status', 'created_at', 'updated_at'],
  DailyReports: ['report_id', 'report_date', 'shift_type', 'total_vehicle_in', 'total_vehicle_out', 'total_contractors', 'total_keys_not_returned', 'total_patrol_missing', 'total_incidents', 'blacklist_alerts', 'shift_leader', 'note', 'created_at', 'login_email', 'operator_name'],
  AuditLogs: ['audit_id', 'user_name', 'action', 'module_name', 'record_id', 'old_value', 'new_value', 'created_at', 'login_email', 'operator_name', 'action_result', 'ip_or_session_id'],
  Keys: ['key_id', 'room_number', 'key_type', 'key_label', 'status', 'current_borrower_name', 'current_checkout_log_id', 'note', 'created_at', 'updated_at'],
  SystemSettings: ['setting_key', 'setting_value', 'setting_type', 'description', 'updated_by', 'updated_at']
};

export const COLLECTION_MAPPING: Record<string, string> = {
  Users: 'users',
  ParkingCards: 'parkingCards',
  VehicleLogs: 'vehicleLogs',
  ContractorLogs: 'contractorLogs',
  KeyLogs: 'keyLogs',
  PatrolPoints: 'patrolPoints',
  PatrolLogs: 'patrolLogs',
  IncidentReports: 'incidentReports',
  Blacklist: 'blacklist',
  DailyReports: 'dailyReports',
  AuditLogs: 'auditLogs',
  Keys: 'keys',
  SystemSettings: 'systemSettings',
};

export const ID_COLUMNS: Record<string, string> = {
  Users: 'user_id',
  ParkingCards: 'card_id',
  VehicleLogs: 'log_id',
  ContractorLogs: 'contractor_log_id',
  KeyLogs: 'key_log_id',
  PatrolPoints: 'patrol_point_id',
  PatrolLogs: 'patrol_log_id',
  IncidentReports: 'incident_id',
  Blacklist: 'blacklist_id',
  DailyReports: 'report_id',
  AuditLogs: 'audit_id',
  Keys: 'key_id',
  SystemSettings: 'setting_key',
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous
    },
    operationType,
    path
  };
  console.error('[Smart Guard Firestore Error]:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Client-side image compression to optimize free tier limits
export async function compressImageBase64(base64Str: string, maxWidth = 800, maxHeight = 800, quality = 0.75): Promise<string> {
  return new Promise((resolve) => {
    if (!base64Str.startsWith('data:image')) {
      resolve(base64Str);
      return;
    }
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      
      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      } else {
        resolve(base64Str);
      }
    };
    img.onerror = () => {
      resolve(base64Str);
    };
  });
}

/**
 * Upload image to Firebase Storage
 */
export async function uploadImageToStorage(base64Data: string, folderName: string, fileName: string): Promise<string> {
  try {
    console.log(`[Firebase Storage] Preparing to upload to folder: ${folderName}`);
    // Compress first
    const compressed = await compressImageBase64(base64Data);
    
    // Calculate size of base64 data to enforce 2 MB limit
    const base64Length = compressed.split(',')[1]?.length || compressed.length;
    const sizeInBytes = (base64Length * 3) / 4;
    const maxSizeBytes = 2 * 1024 * 1024; // 2 MB
    if (sizeInBytes > maxSizeBytes) {
      throw new Error(`ไฟล์ภาพมีขนาดใหญ่เกินกว่าขีดจำกัดสูงสุดหลังบีบอัด (${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB จากสูงสุด 2.00 MB) กรุณาใช้ไฟล์ที่มีขนาดเล็กลง`);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const path = `${folderName}/${todayStr}/${cleanFileName}`;
    
    const storageRef = ref(storage, path);
    await uploadString(storageRef, compressed, 'data_url');
    
    const downloadUrl = await getDownloadURL(storageRef);
    console.log('[Firebase Storage] Upload completed successfully:', downloadUrl);
    return downloadUrl;
  } catch (error) {
    console.error('[Firebase Storage] Upload error:', error);
    throw error;
  }
}

export async function uploadImageToDrive(base64Data: string, filename: string): Promise<string> {
  let folder = 'general-uploads';
  if (filename.startsWith('vehicle_')) {
    folder = 'vehicle-logs';
  } else if (filename.startsWith('contractor_')) {
    folder = 'contractor-logs';
  } else if (filename.startsWith('key_')) {
    folder = 'key-logs';
  } else if (filename.startsWith('patrol_')) {
    folder = 'patrol-logs';
  } else if (filename.startsWith('incident_')) {
    folder = 'incident-reports';
  }
  
  return uploadImageToStorage(base64Data, folder, filename);
}

export async function fetchDriveImageAsUrl(fileId: string): Promise<string> {
  // If it's already a full URL (Firebase Storage URL), return it directly
  if (fileId.startsWith('http://') || fileId.startsWith('https://')) {
    return fileId;
  }
  return `https://images.unsplash.com/photo-1557683316-973673baf926?w=400&h=300&fit=crop&q=80`;
}

/**
 * Read records from a Firestore collection
 */
export async function readSheet<T>(sheetName: keyof typeof SCHEMA): Promise<T[]> {
  const collectionName = COLLECTION_MAPPING[sheetName] || String(sheetName);
  try {
    const querySnapshot = await getDocs(collection(db, collectionName));
    const records: T[] = [];
    querySnapshot.forEach((docSnap) => {
      records.push({ ...docSnap.data() } as T);
    });

    // If database is completely unseeded for core configs, run auto-seed ONLY in development mode
    const isDev = (import.meta as any).env?.DEV === true;
    if (isDev && records.length === 0 && ['Users', 'ParkingCards', 'PatrolPoints', 'Keys', 'SystemSettings'].includes(sheetName)) {
      console.log(`[Smart Guard DB] Collection ${collectionName} is empty in development. Running auto-seed...`);
      await seedCollection(sheetName);
      // Re-fetch
      const reSnapshot = await getDocs(collection(db, collectionName));
      const reRecords: T[] = [];
      reSnapshot.forEach((docSnap) => {
        reRecords.push({ ...docSnap.data() } as T);
      });
      return reRecords;
    }

    // Sort descending by created_at or other time attributes
    records.sort((a: any, b: any) => {
      const timeA = a.created_at || a.entry_time || a.checkout_time || '';
      const timeB = b.created_at || b.entry_time || b.checkout_time || '';
      return String(timeB).localeCompare(String(timeA));
    });

    return records;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, collectionName);
    return [];
  }
}

/**
 * Append a record to a Firestore collection
 */
export async function appendSheetRow<T extends object>(sheetName: keyof typeof SCHEMA, record: T): Promise<void> {
  const collectionName = COLLECTION_MAPPING[sheetName] || String(sheetName);
  const idCol = ID_COLUMNS[sheetName];
  const finalRecord = { ...record } as any;

  // Pin operator credentials if available in session
  const columns = SCHEMA[sheetName];
  if (columns.includes('login_email') && !finalRecord.login_email) {
    finalRecord.login_email = sessionStorage.getItem('selected_login_email') || auth.currentUser?.email || '';
  }
  if (columns.includes('operator_name') && !finalRecord.operator_name) {
    finalRecord.operator_name = sessionStorage.getItem('selected_operator_name') || '';
  }
  if (columns.includes('created_at') && !finalRecord.created_at) {
    finalRecord.created_at = new Date().toISOString();
  }
  if (columns.includes('updated_at') && !finalRecord.updated_at) {
    finalRecord.updated_at = new Date().toISOString();
  }

  const idValue = finalRecord[idCol] || `${sheetName.toUpperCase()}_${Math.floor(Math.random() * 1000000)}`;
  finalRecord[idCol] = idValue;

  try {
    await setDoc(doc(db, collectionName, idValue), finalRecord);
    console.log(`[Smart Guard DB] Successfully appended to ${collectionName}: ${idValue}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${idValue}`);
  }
}

/**
 * Update a specific record in a Firestore collection
 */
export async function updateSheetRow<T extends object>(
  sheetName: keyof typeof SCHEMA,
  idColumn: string,
  idValue: string,
  updatedFields: Partial<T>
): Promise<void> {
  const collectionName = COLLECTION_MAPPING[sheetName] || String(sheetName);
  const finalFields = { ...updatedFields } as any;

  if (SCHEMA[sheetName].includes('updated_at')) {
    finalFields.updated_at = new Date().toISOString();
  }

  try {
    await updateDoc(doc(db, collectionName, idValue), finalFields);
    console.log(`[Smart Guard DB] Successfully updated ${collectionName}/${idValue}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${idValue}`);
  }
}

/**
 * Delete a specific record in a Firestore collection
 */
export async function deleteSheetRow(
  sheetName: keyof typeof SCHEMA,
  idColumn: string,
  idValue: string
): Promise<void> {
  const collectionName = COLLECTION_MAPPING[sheetName] || String(sheetName);
  try {
    await deleteDoc(doc(db, collectionName, idValue));
    console.log(`[Smart Guard DB] Successfully deleted ${collectionName}/${idValue}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${idValue}`);
  }
}

/**
 * Write a change record to the AuditLogs collection
 */
export async function writeAuditLog(
  userName: string,
  action: string,
  moduleName: string,
  recordId: string,
  oldValue: string = '',
  newValue: string = '',
  loginEmail: string = '',
  operatorName: string = '',
  actionResult: string = 'Success',
  ipOrSessionId: string = ''
): Promise<void> {
  const audit_id = 'AUD' + Math.floor(Math.random() * 100000);
  const now = new Date().toISOString();
  
  const finalEmail = loginEmail || sessionStorage.getItem('selected_login_email') || auth.currentUser?.email || '';
  const finalOperator = operatorName || sessionStorage.getItem('selected_operator_name') || userName || '';
  
  const log = {
    audit_id,
    user_name: userName || finalOperator || 'Unknown',
    action,
    module_name: moduleName,
    record_id: recordId,
    old_value: String(oldValue),
    new_value: String(newValue),
    created_at: now,
    login_email: finalEmail,
    operator_name: finalOperator,
    action_result: actionResult,
    ip_or_session_id: ipOrSessionId || sessionStorage.getItem('selected_session_id') || 'local-session'
  };
  await appendSheetRow('AuditLogs', log);
}

/**
 * Seed Firestore collections from default mock seed data
 */
async function seedCollection(sheetName: keyof typeof SCHEMA) {
  const collectionName = COLLECTION_MAPPING[sheetName] || String(sheetName);
  const now = new Date().toISOString();
  const todayStr = now.split('T')[0];

  const seedData: Record<string, any[][]> = {
    Users: [
      ['U001', 'office.mjc2025@gmail.com', 'แอดมิน สูงสุด', 'Admin', 'ทั่วไป', '0899999999', 'Active', now, now],
      ['U002', 'guard@example.com', 'สมชาย แสนดี', 'Guard', 'กะเช้า (06:00 - 18:00)', '0812345678', 'Active', now, now],
      ['U003', 'guard@example.com', 'วิชัย มีทอง', 'Guard', 'กะเช้า (06:00 - 18:00)', '0823456789', 'Active', now, now],
      ['U004', 'leader@example.com', 'ประเสริฐ สิงห์โต', 'Shift Leader', 'กะเช้า (06:00 - 18:00)', '0856789012', 'Active', now, now],
      ['U005', 'manager@example.com', 'จารุวรรณ ณ นคร', 'Manager', 'ทั่วไป', '0878901234', 'Active', now, now],
      ['U101', 'sandbox@example.com', 'สมชาย แสนดี (รปภ.)', 'Guard', 'กะเช้า (06:00 - 18:00)', '0812345678', 'Active', now, now],
      ['U102', 'sandbox@example.com', 'ประเสริฐ สิงห์โต (หัวหน้ากะ)', 'Shift Leader', 'กะกลางวัน (06:00 - 18:00)', '0856789012', 'Active', now, now],
      ['U103', 'sandbox@example.com', 'แอดมิน สูงสุด (แอดมิน)', 'Admin', 'ทั่วไป', '0899999999', 'Active', now, now]
    ],
    ParkingCards: [
      ['C001', 'P001', 'P001_QR', 'ใช้งานอยู่', 'กข 1234', 'บัตรจอดรถชั่วคราว VIP', now, now],
      ['C002', 'P002', 'P002_QR', 'ว่าง', '', 'บัตรจอดรถชั่วคราวทั่วไป', now, now],
      ['C003', 'P003', 'P003_QR', 'ใช้งานอยู่', '3กข 5678', 'บัตรจอดรถผู้รับเหมา', now, now],
      ['C004', 'P004', 'P004_QR', 'ว่าง', '', 'บัตรจอดรถชั่วคราวทั่วไป', now, now],
      ['C005', 'P005', 'P005_QR', 'ว่าง', '', 'บัตรจอดรถชั่วคราวทั่วไป', now, now]
    ],
    PatrolPoints: [
      ['PP001', 'จุดตรวจ Lobby ชั้น 1', 'เสาด้านหน้าทางเข้าหลักหน้าเคาน์เตอร์นิติ', 'PP001_QR', 60, 'Active', now, now],
      ['PP002', 'จุดตรวจ ลานจอดรถ B1 เสา B12', 'เสาโครงสร้างใกล้พัดลมดูดอากาศตัวใหญ่', 'PP002_QR', 120, 'Active', now, now],
      ['PP003', 'จุดตรวจ ห้องควบคุมไฟฟ้าชั้น M', 'หน้าประตูห้องควบคุมควบคุมไฟฟ้าประธาน', 'PP003_QR', 120, 'Active', now, now]
    ],
    Keys: [
      ['KEY_R001', '101', 'ห้องพัก', 'กุญแจห้องพักสำรอง', 'Available', '', '', 'ตรวจสอบความปลอดภัยแล้ว', now, now],
      ['KEY_R002', 'EE01', 'ห้องไฟฟ้า', 'กุญแจห้องไฟฟ้าชั้น M', 'Checked Out', 'นายสมคิด ช่างไฟฟ้า', 'CON001', 'สำหรับเข้าปฏิบัติงานซ่อมบำรุง', now, now],
      ['KEY_R003', 'ME01', 'ห้องเครื่องจักร', 'กุญแจห้องควบคุมระบบปั๊มน้ำ', 'Available', '', '', 'กรุณาคืนหลังกะปฏิบัติการ', now, now]
    ],
    SystemSettings: [
      ['building_name', 'วิจิตรบรรจง คอนโดมิเนียม', 'text', 'ชื่อของโครงการหรืออาคารในระบบ', 'แอดมิน สูงสุด', now],
      ['condo_name', 'Vichitbanjong Condominium', 'text', 'ชื่อคอนโดภาษาอังกฤษ', 'แอดมิน สูงสุด', now],
      ['default_shift_times', '06:00 - 18:00 / 18:00 - 06:00', 'text', 'เวลาเปลี่ยนกะมาตรฐานในระบบ', 'แอดมิน สูงสุด', now],
      ['patrol_interval_default', '60', 'number', 'รอบความถี่ในการเดินตรวจขั้นต่ำ (นาที)', 'แอดมิน สูงสุด', now],
      ['require_vehicle_photo', 'true', 'boolean', 'บังคับถ่ายรูปรถยนต์และป้ายทะเบียนตอนบันทึกเข้า', 'แอดมิน สูงสุด', now],
      ['require_key_signature', 'true', 'boolean', 'เปิดปิดการบังคับเซ็นชื่อเวลาเบิกกุญแจ', 'แอดมิน สูงสุด', now],
      ['require_patrol_qr', 'true', 'boolean', 'เปิดปิดการสแกน QR Code สำหรับตรวจสอบจุดตรวจพิกัด', 'แอดมิน สูงสุด', now]
    ]
  };

  const headers = SCHEMA[sheetName];
  const list = seedData[sheetName] || [];
  const batch = writeBatch(db);

  list.forEach(row => {
    const record: any = {};
    headers.forEach((col, idx) => {
      const val = row[idx];
      if (col === 'required_interval_minutes' || col.startsWith('total_') || col === 'blacklist_alerts') {
        record[col] = val ? Number(val) : 0;
      } else {
        record[col] = val !== undefined ? String(val) : '';
      }
    });

    const idCol = ID_COLUMNS[sheetName];
    const docId = record[idCol];
    const docRef = doc(db, collectionName, docId);
    batch.set(docRef, record);
  });

  await batch.commit();
  console.log(`[Smart Guard DB] Finished seeding collection: ${collectionName}`);
}


/**
 * Admin-only explicit initialization of missing system tables (never overwrites existing records)
 */
export async function initializeSystemData(operatorName: string, loginEmail: string): Promise<void> {
  console.log('[Smart Guard DB] Explicit "Initialize System Data" action triggered.');
  
  const collectionsToSeed: (keyof typeof SCHEMA)[] = ['Users', 'ParkingCards', 'PatrolPoints', 'Keys', 'SystemSettings'];
  
  for (const sheetName of collectionsToSeed) {
    const colName = COLLECTION_MAPPING[sheetName] || String(sheetName);
    const snap = await getDocs(collection(db, colName));
    if (snap.empty) {
      console.log(`[Smart Guard DB] Seeding empty collection: ${colName}`);
      await seedCollection(sheetName);
    } else {
      console.log(`[Smart Guard DB] Collection ${colName} is not empty. Skipping to prevent overwriting.`);
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
    operatorName
  );
}

