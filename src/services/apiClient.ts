/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// All sheets and their columns (schema definition)
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

export const getApiUrl = (): string => {
  let url = (import.meta as any).env?.VITE_APPS_SCRIPT_API_URL || '';
  if (typeof url === 'string') {
    url = url.trim();
    // Remove wrapping quotes if pasted by mistake
    url = url.replace(/^['"]|['"]$/g, '');
  }
  return url;
};

export const isDevelopmentPreview = (): boolean => {
  const hostname = window.location.hostname;
  return (
    hostname.includes('localhost') || 
    hostname.includes('127.0.0.1') || 
    hostname.includes('ais-dev') || 
    window.self !== window.top
  );
};

export const isSandboxLoginEnabled = (): boolean => {
  const envVar = (import.meta as any).env?.VITE_ENABLE_SANDBOX_LOGIN;
  const isDev = (import.meta as any).env?.DEV;
  // Enable sandbox login if in DEV mode, or VITE_ENABLE_SANDBOX_LOGIN is explicitly 'true'
  return !!(isDev || envVar === 'true');
};

// Initial log of API URL on load
const _url = getApiUrl();
if (_url && !_url.startsWith('https://script.google.com/macros/s/')) {
  console.warn(`[Smart Guard API] Warning: VITE_APPS_SCRIPT_API_URL is configured but does not look like a valid Google Apps Script Web App URL (must start with "https://script.google.com/macros/s/"). Received: "${_url.substring(0, 100)}...". Automatically falling back to Mock/Sandbox mode.`);
} else {
  console.log(`[Smart Guard API] API URL loaded: ${_url || '(Not configured)'}`);
}

export const isMockModeActive = (): boolean => {
  const token = sessionStorage.getItem('g_oauth_token');
  const url = getApiUrl();
  const hasUrl = url && url !== 'PASTE_APPS_SCRIPT_WEB_APP_URL_HERE';
  const isValidUrl = hasUrl && url.startsWith('https://script.google.com/macros/s/');
  
  // If sandbox bypass token is used, or the API URL is empty or invalid, fallback to mock mode
  return token === 'mock_sandbox_oauth_token' || !isValidUrl;
};

// Local storage helpers for mock mode
export const getMockTable = <T>(sheetName: keyof typeof SCHEMA): T[] => {
  const key = `smart_guard_db_${sheetName}`;
  const data = localStorage.getItem(key);
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error(e);
    }
  }

  // Create initial seeded data if not exists
  const now = new Date().toISOString();
  const todayStr = now.split('T')[0];

  const seedData: Record<string, any[][]> = {
    Users: [
      ['U001', 'guard@example.com', 'สมชาย แสนดี', 'Guard', 'กะเช้า (06:00 - 18:00)', '0812345678', 'Active', now, now],
      ['U002', 'guard@example.com', 'วิชัย มีทอง', 'Guard', 'กะเช้า (06:00 - 18:00)', '0823456789', 'Active', now, now],
      ['U003', 'guard@example.com', 'สมบัติ รักดี', 'Guard', 'กะกลางคืน (18:00 - 06:00)', '0834567890', 'Active', now, now],
      ['U004', 'guard@example.com', 'นที ยอดเก่ง', 'Guard', 'กะกลางคืน (18:00 - 06:00)', '0845678901', 'Active', now, now],
      ['U005', 'leader@example.com', 'ประเสริฐ สิงห์โต', 'Shift Leader', 'กะเช้า (06:00 - 18:00)', '0856789012', 'Active', now, now],
      ['U006', 'leader@example.com', 'อรรถพล แก้วมณี', 'Shift Leader', 'กะกลางคืน (18:00 - 06:00)', '0867890123', 'Active', now, now],
      ['U007', 'manager@example.com', 'จารุวรรณ ณ นคร', 'Manager', 'ทั่วไป', '0878901234', 'Active', now, now],
      ['U008', 'office.mjc2025@gmail.com', 'แอดมิน สูงสุด', 'Admin', 'ทั่วไป', '0899999999', 'Active', now, now],
      ['U009', 'office.mjc2025@gmail.com', 'ผู้ทดสอบ ระบบ', 'Admin', 'ทั่วไป', '0811111111', 'Active', now, now],
      ['U101', 'sandbox@example.com', 'สมชาย แสนดี (รปภ.)', 'Guard', 'กะเช้า (06:00 - 18:00)', '0812345678', 'Active', now, now],
      ['U102', 'sandbox@example.com', 'วิชัย มีทอง (รปภ.)', 'Guard', 'กะเช้า (06:00 - 18:00)', '0823456789', 'Active', now, now],
      ['U103', 'sandbox@example.com', 'ประเสริฐ สิงห์โต (หัวหน้ากะ)', 'Shift Leader', 'กะกลางวัน (06:00 - 18:00)', '0856789012', 'Active', now, now],
      ['U104', 'sandbox@example.com', 'จารุวรรณ ณ นคร (ผู้จัดการ)', 'Manager', 'ทั่วไป', '0878901234', 'Active', now, now],
      ['U105', 'sandbox@example.com', 'แอดมิน สูงสุด (แอดมิน)', 'Admin', 'ทั่วไป', '0899999999', 'Active', now, now]
    ],
    ParkingCards: [
      ['C001', 'P001', 'P001_QR', 'ใช้งานอยู่', 'กข 1234', 'บัตรจอดรถชั่วคราว VIP', now, now],
      ['C002', 'P002', 'P002_QR', 'ว่าง', '', 'บัตรจอดรถชั่วคราวทั่วไป', now, now],
      ['C003', 'P003', 'P003_QR', 'ใช้งานอยู่', '3กข 5678', 'บัตรจอดรถผู้รับเหมา', now, now],
      ['C004', 'P004', 'P004_QR', 'ว่าง', '', 'บัตรจอดรถชั่วคราวทั่วไป', now, now],
      ['C005', 'P005', 'P005_QR', 'ว่าง', '', 'บัตรจอดรถชั่วคราวทั่วไป', now, now],
      ['C006', 'P006', 'P006_QR', 'ว่าง', '', 'บัตรจอดรถชั่วคราวทั่วไป', now, now],
      ['C007', 'P007', 'P007_QR', 'ว่าง', '', 'บัตรจอดรถชั่วคราวทั่วไป', now, now],
      ['C008', 'P008', 'P008_QR', 'ว่าง', '', 'บัตรจอดรถชั่วคราวทั่วไป', now, now]
    ],
    VehicleLogs: [
      ['V001', 'P001', 'กข 1234', 'รถยนต์', 'คุณอนุรักษ์ เพียรดี', '0811112222', '101/45', 'เยี่ยมญาติ', `${todayStr}T08:30:00.000Z`, '', '', '', '', '', 'กำลังจอด', 'สมชาย แสนดี', 'ติดต่อชั้น 4', now, now],
      ['V002', 'P003', '3กข 5678', 'รถส่งของ', 'นายมานะ ส่งไว', '0822223333', '205/12', 'ส่งเอกสารด่วน', `${todayStr}T09:15:00.000Z`, '', '', '', '', '', 'กำลังจอด', 'วิชัย มีทอง', 'รถกระบะขนตู้เซฟ', now, now],
      ['V003', 'P002', 'งจ 999', 'รถยนต์', 'คุณสิริกร สุภาพ', '0833334444', '103/89', 'ทานอาหารร่วมกัน', `${todayStr}T07:10:00.000Z`, `${todayStr}T11:45:00.000Z`, '', '', '', '', 'ออกแล้ว', 'สมชาย แสนดี', '', now, now]
    ],
    ContractorLogs: [
      ['CON001', 'นายสมคิด ช่างไฟฟ้า', '1234567890123', '0844445555', 'บจก. เพาเวอร์ไลฟ์', 'ห้องไฟฟ้า ชั้น 5', 'นิติบุคคล', 'ซ่อมระบบแสงสว่าง', `${todayStr}T08:00:00.000Z`, '', '', '', 'กำลังปฏิบัติงาน', 'ประเสริฐ สิงห์โต', 'ได้รับอนุญาตจากวิศวกร', now, now],
      ['CON002', 'นายสมเกียรติ สุขสม', '1111222233334', '0855556666', 'ช่างแอร์บ้านระยอง', '302/14', 'คุณพัชรพรรณ', 'ล้างเครื่องปรับอากาศ', `${todayStr}T09:30:00.000Z`, `${todayStr}T11:20:00.000Z`, '', '', 'ออกแล้ว', 'วิชัย มีทอง', '', now, now]
    ],
    KeyLogs: [
      ['KEY001', '501', 'ห้องพัก', 'นายเอกชัย รักษ์ดี', '0866667777', '9876543210123', 'ซ่อมสีระเบียงด้านหลัง', `${todayStr}T08:45:00.000Z`, '', 'สมชาย แสนดี', '', '', '', '', 'ถูกเบิก', 'ต้องส่งคืนก่อน 17:00 น.', now, now]
    ],
    PatrolPoints: [
      ['PP001', 'จุดตรวจ Lobby ชั้น 1', 'เสาด้านหน้าทางเข้าหลักหน้าเคาน์เตอร์นิติ', 'PP001_QR', 60, 'Active', now, now],
      ['PP002', 'จุดตรวจ ลานจอดรถ B1 เสา B12', 'เสาโครงสร้างใกล้พัดลมดูดอากาศตัวใหญ่', 'PP002_QR', 120, 'Active', now, now],
      ['PP003', 'จุดตรวจ ห้องควบคุมไฟฟ้าชั้น M', 'หน้าประตูห้องควบคุมควบคุมไฟฟ้าประธาน', 'PP003_QR', 120, 'Active', now, now],
      ['PP004', 'จุดตรวจ ดาดฟ้า ชั้น 32', 'หน้าบานประตูกันไฟ ทางหนีทีไล่ ทิศเหนือ', 'PP004_QR', 240, 'Active', now, now]
    ],
    PatrolLogs: [
      ['PL001', 'PP001', 'จุดตรวจ Lobby ชั้น 1', 'สมชาย แสนดี', 'เช้า', `${todayStr}T07:15:00.000Z`, '', 'ปกติ', '', '', 'ตรวจความเรียบร้อยรอบพื้นที่ เรียบร้อยดี', now],
      ['PL002', 'PP002', 'จุดตรวจ ลานจอดรถ B1 เสา B12', 'สมชาย แสนดี', 'เช้า', `${todayStr}T08:22:00.000Z`, '', 'ผิดปกติ', 'หลอดไฟแสงสว่างดับ 2 ดวง สลัวมาก', '', 'แจ้งวิศวกรไฟฟ้าเปลี่ยนหลอด', now]
    ],
    IncidentReports: [
      ['INC001', `${todayStr}T10:05:00.000Z`, 'ลานจอดรถชั้น B2 เสา F4', 'อุปกรณ์ชำรุด', 'ท่อน้ำดีระบายน้ำแอร์จากห้องด้านบนรั่วซึม มีน้ำขัง นองพื้น ผิวจราจรลื่น', '', 'สมชาย แสนดี', 'ประเสริฐ สิงห์โต', 'ประสานงานแม่บ้านซับน้ำเรียบร้อย ช่างอาคารกำลังเปลี่ยนข้อต่อท่อ', 'กำลังดำเนินการ', now, now, 'Medium', 'ประเสริฐ สิงห์โต', '']
    ],
    Blacklist: [
      ['BL001', 'ทะเบียนรถ', 'กข 9999', '', 'นายระวี นักโกง', 'พฤติกรรมพยายามแอบจอดรถข้ามคืนบ่อยครั้ง และไม่ยอมชำระค่าธรรมเนียม มีปากเสียงกับ รปภ.', 'ห้ามเข้าเด็ดขาด', 'Active', now, now],
      ['BL002', 'เลขบัตรประชาชน', '', '1234567890123', 'นายโกง ทุจริต', 'มีประวัติพยายามลักลอบตัดสายเคเบิลทองแดงในไซด์งานก่อสร้าง', 'ห้ามเข้าเด็ดขาด', 'Active', now, now]
    ],
    DailyReports: [
      ['DR001', todayStr, 'เช้า', 10, 8, 3, 0, 0, 1, 0, 'ประเสริฐ สิงห์โต', 'เหตุการณ์ทั่วไปปกติ มีแจ้งเรื่องท่อน้ำรั่วซึมลานจอดรถ ได้ประสานช่างอาคารแก้ไขแล้ว', now]
    ],
    AuditLogs: [
      ['AUD001', 'สมชาย แสนดี', 'บันทึกรถเข้า', 'VehicleLogs', 'V001', '', 'กข 1234', now]
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
      ['media_folder_id', 'mock_folder_id', 'text', 'Google Drive Media Folder ID', 'แอดมิน สูงสุด', now],
      ['spreadsheet_id', 'mock_spreadsheet_id', 'text', 'Google Sheets Spreadsheet ID', 'แอดมิน สูงสุด', now],
      ['enable_sandbox_bypass', 'true', 'boolean', 'เปิดปิดการข้ามล็อกอินด่วน สำหรับหน้าจอด้านนอก', 'แอดมิน สูงสุด', now],
      ['require_vehicle_photo', 'true', 'boolean', 'บังคับถ่ายรูปรถยนต์และป้ายทะเบียนตอนบันทึกเข้า', 'แอดมิน สูงสุด', now],
      ['require_key_signature', 'true', 'boolean', 'เปิดปิดการบังคับเซ็นชื่อเวลาเบิกกุญแจ', 'แอดมิน สูงสุด', now],
      ['require_patrol_qr', 'true', 'boolean', 'เปิดปิดการสแกน QR Code สำหรับตรวจสอบจุดตรวจพิกัด', 'แอดมิน สูงสุด', now]
    ]
  };

  const tableHeaders = SCHEMA[sheetName];
  const list = seedData[sheetName] || [];
  const mapped = list.map(row => {
    const record: any = {};
    tableHeaders.forEach((col, index) => {
      const val = row[index];
      if (col === 'required_interval_minutes' || col.startsWith('total_') || col === 'blacklist_alerts') {
        record[col] = val ? Number(val) : 0;
      } else {
        record[col] = val !== undefined ? String(val) : '';
      }
    });
    return record;
  });

  localStorage.setItem(key, JSON.stringify(mapped));
  return mapped;
};

export const setMockTable = (sheetName: keyof typeof SCHEMA, data: any[]) => {
  const key = `smart_guard_db_${sheetName}`;
  localStorage.setItem(key, JSON.stringify(data));
};

/**
 * Perform a POST request to Google Apps Script Web App API
 */
export async function callAction<T = any>(action: string, payload: any = {}): Promise<T> {
  if (isMockModeActive()) {
    return handleMockAction<T>(action, payload);
  }

  const apiUrl = getApiUrl();
  if (!apiUrl || apiUrl === 'PASTE_APPS_SCRIPT_WEB_APP_URL_HERE') {
    throw new Error('Google Apps Script API URL is not configured. Please set VITE_APPS_SCRIPT_API_URL in .env');
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8' // Avoid preflight CORS issues in Apps Script
      },
      body: JSON.stringify({ action, payload })
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `HTTP network error: 404 Not Found\n` +
          `-------------------------------\n` +
          `• URL ที่เรียก: ${apiUrl}\n` +
          `• สาเหตุที่เป็นไปได้:\n` +
          `  1. คุณคัดลอก URL ของหน้า "Editor (หน้าแก้ไขโค้ด)" มาแทนที่จะเป็น URL ของ "Web App" ที่เผยแพร่จริง (Deploy)\n` +
          `  2. URL ของ Web App ไม่ถูกต้อง มีการสลับตัวอักษร หรือใส่ช่องว่างส่วนเกิน\n` +
          `  3. ยังไม่ได้ Deploy (ลงใช้งาน) บน Apps Script หรือเวอร์ชันที่ Deploy ถูกลบไปแล้ว\n` +
          `• วิธีแก้ไข:\n` +
          `  - ในหน้า Apps Script ให้กด Deploy > New deployment\n` +
          `  - เลือกประเภท "Web app"\n` +
          `  - ตั้งค่า "Execute as" เป็น "Me" และ "Who has access" เป็น "Anyone"\n` +
          `  - คัดลอก "Web app URL" ที่ลงท้ายด้วย /exec แล้วนำมาใส่ในการตั้งค่าโปรเจกต์นี้`
        );
      }
      throw new Error(`HTTP network error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch (err) {
      throw new Error(`Invalid JSON response from API: ${text.substring(0, 150)}`);
    }

    if (!result.success) {
      throw new Error(result.error || 'Backend action executed with error');
    }

    console.log(`[Smart Guard API] API Connection: SUCCESS for action "${action}"`);
    return result.data as T;
  } catch (error: any) {
    console.error(`[Smart Guard API] API Connection: FAILED for action "${action}". Error:`, error);
    throw error;
  }
}

/**
 * Fallback Mock Implementation for development sandbox mode
 */
async function handleMockAction<T>(action: string, payload: any): Promise<T> {
  const nowStr = new Date().toISOString();
  
  switch (action) {
    case 'ping': {
      return { success: true, message: 'Smart Guard API is running' } as any;
    }

    case 'getUsers': {
      return getMockTable<any>('Users') as any;
    }

    case 'getCurrentUserContext': {
      const { email } = payload;
      const users = getMockTable<any>('Users');
      const matches = users.filter(u => u.login_email === email && u.status === 'Active');
      return {
        email,
        exists: matches.length > 0,
        operators: matches
      } as any;
    }

    case 'createVehicleEntry': {
      const { record } = payload;
      const logs = getMockTable<any>('VehicleLogs');
      logs.push(record);
      setMockTable('VehicleLogs', logs);

      // Update card
      const cards = getMockTable<any>('ParkingCards');
      const cardIdx = cards.findIndex(c => c.card_number === record.card_number);
      if (cardIdx !== -1) {
        cards[cardIdx].status = 'ใช้งานอยู่';
        cards[cardIdx].current_vehicle_plate = record.vehicle_plate;
        cards[cardIdx].updated_at = nowStr;
        setMockTable('ParkingCards', cards);
      }
      return record as any;
    }

    case 'createVehicleExit': {
      const { log_id, exit_fields } = payload;
      const logs = getMockTable<any>('VehicleLogs');
      const logIdx = logs.findIndex(l => l.log_id === log_id);
      if (logIdx !== -1) {
        logs[logIdx] = { ...logs[logIdx], ...exit_fields };
        setMockTable('VehicleLogs', logs);

        // Update card
        const cardNum = logs[logIdx].card_number;
        const cards = getMockTable<any>('ParkingCards');
        const cardIdx = cards.findIndex(c => c.card_number === cardNum);
        if (cardIdx !== -1) {
          cards[cardIdx].status = 'ว่าง';
          cards[cardIdx].current_vehicle_plate = '';
          cards[cardIdx].updated_at = nowStr;
          setMockTable('ParkingCards', cards);
        }
        return logs[logIdx] as any;
      }
      throw new Error('Vehicle Log not found');
    }

    case 'createContractorEntry': {
      const { record } = payload;
      const logs = getMockTable<any>('ContractorLogs');
      logs.push(record);
      setMockTable('ContractorLogs', logs);
      return record as any;
    }

    case 'createContractorExit': {
      const { contractor_log_id, exit_fields } = payload;
      const logs = getMockTable<any>('ContractorLogs');
      const logIdx = logs.findIndex(l => l.contractor_log_id === contractor_log_id);
      if (logIdx !== -1) {
        logs[logIdx] = { ...logs[logIdx], ...exit_fields };
        setMockTable('ContractorLogs', logs);
        return logs[logIdx] as any;
      }
      throw new Error('Contractor Log not found');
    }

    case 'createKeyCheckout': {
      const { record } = payload;
      const logs = getMockTable<any>('KeyLogs');
      logs.push(record);
      setMockTable('KeyLogs', logs);

      // Update Key
      const keys = getMockTable<any>('Keys');
      const keyIdx = keys.findIndex(k => k.room_number === record.room_number && k.key_type === record.key_type);
      if (keyIdx !== -1) {
        keys[keyIdx].status = 'Checked Out';
        keys[keyIdx].current_borrower_name = record.borrower_name;
        keys[keyIdx].current_checkout_log_id = record.key_log_id;
        keys[keyIdx].updated_at = nowStr;
        setMockTable('Keys', keys);
      }
      return record as any;
    }

    case 'createKeyReturn': {
      const { key_log_id, return_fields } = payload;
      const logs = getMockTable<any>('KeyLogs');
      const logIdx = logs.findIndex(l => l.key_log_id === key_log_id);
      if (logIdx !== -1) {
        logs[logIdx] = { ...logs[logIdx], ...return_fields };
        setMockTable('KeyLogs', logs);

        // Update key
        const room = logs[logIdx].room_number;
        const type = logs[logIdx].key_type;
        const keys = getMockTable<any>('Keys');
        const keyIdx = keys.findIndex(k => k.room_number === room && k.key_type === type);
        if (keyIdx !== -1) {
          keys[keyIdx].status = 'Available';
          keys[keyIdx].current_borrower_name = '';
          keys[keyIdx].current_checkout_log_id = '';
          keys[keyIdx].updated_at = nowStr;
          setMockTable('Keys', keys);
        }
        return logs[logIdx] as any;
      }
      throw new Error('Key Log not found');
    }

    case 'createPatrolCheckin': {
      const { record } = payload;
      const logs = getMockTable<any>('PatrolLogs');
      logs.push(record);
      setMockTable('PatrolLogs', logs);
      return record as any;
    }

    case 'createIncidentReport': {
      const { record } = payload;
      const logs = getMockTable<any>('IncidentReports');
      logs.push(record);
      setMockTable('IncidentReports', logs);
      return record as any;
    }

    case 'searchHistory': {
      const { query } = payload;
      const q = (query || '').toLowerCase();
      const filterFn = (row: any) => {
        return Object.values(row).some(v => String(v).toLowerCase().includes(q));
      };

      return {
        vehicles: getMockTable<any>('VehicleLogs').filter(filterFn),
        contractors: getMockTable<any>('ContractorLogs').filter(filterFn),
        keys: getMockTable<any>('KeyLogs').filter(filterFn),
        patrols: getMockTable<any>('PatrolLogs').filter(filterFn),
        incidents: getMockTable<any>('IncidentReports').filter(filterFn)
      } as any;
    }

    case 'getDashboardSummary': {
      const vehicles = getMockTable<any>('VehicleLogs');
      const contractors = getMockTable<any>('ContractorLogs');
      const keys = getMockTable<any>('Keys');
      const incidents = getMockTable<any>('IncidentReports');
      const patrols = getMockTable<any>('PatrolLogs');

      return {
        activeVehiclesCount: vehicles.filter((v: any) => v.status === 'กำลังจอด').length,
        activeContractorsCount: contractors.filter((c: any) => c.status === 'กำลังปฏิบัติงาน').length,
        borrowedKeysCount: keys.filter((k: any) => k.status === 'Checked Out').length,
        unresolvedIncidentsCount: incidents.filter((i: any) => i.status !== 'เสร็จสิ้น' && i.status !== 'Resolved').length,
        totalPatrolsCount: patrols.length
      } as any;
    }

    // Generic fallbacks for sheets mimicking
    case 'readSheet': {
      const { sheetName } = payload;
      return getMockTable<any>(sheetName) as any;
    }

    case 'appendSheetRow': {
      const { sheetName, record } = payload;
      const table = getMockTable<any>(sheetName);
      
      const columns = SCHEMA[sheetName];
      const finalRecord = { ...record };
      if (columns.includes('login_email') && !finalRecord.login_email) {
        finalRecord.login_email = sessionStorage.getItem('selected_login_email') || '';
      }
      if (columns.includes('operator_name') && !finalRecord.operator_name) {
        finalRecord.operator_name = sessionStorage.getItem('selected_operator_name') || '';
      }

      table.push(finalRecord);
      setMockTable(sheetName, table);
      return finalRecord as any;
    }

    case 'updateSheetRow': {
      const { sheetName, idColumn, idValue, updatedFields } = payload;
      const table = getMockTable<any>(sheetName);
      const index = table.findIndex(row => String(row[idColumn]) === String(idValue));
      if (index !== -1) {
        const columns = SCHEMA[sheetName];
        const finalFields = { ...updatedFields };
        if (columns.includes('login_email') && !finalFields.login_email) {
          finalFields.login_email = sessionStorage.getItem('selected_login_email') || '';
        }
        if (columns.includes('operator_name') && !finalFields.operator_name) {
          finalFields.operator_name = sessionStorage.getItem('selected_operator_name') || '';
        }

        table[index] = { ...table[index], ...finalFields };
        setMockTable(sheetName, table);
      }
      return {} as any;
    }

    case 'deleteSheetRow': {
      const { sheetName, idColumn, idValue } = payload;
      const columns = SCHEMA[sheetName];
      if (columns.includes('status')) {
        await handleMockAction('updateSheetRow', { sheetName, idColumn, idValue, updatedFields: { status: 'Inactive' } });
      } else {
        const table = getMockTable<any>(sheetName);
        const filtered = table.filter(row => String(row[idColumn]) !== String(idValue));
        setMockTable(sheetName, filtered);
      }
      return {} as any;
    }

    case 'uploadImage': {
      // Return a simulated high-quality mock image URL
      return `https://images.unsplash.com/photo-1557683316-973673baf926?w=400&h=300&fit=crop&q=80` as any;
    }

    default:
      throw new Error(`Unknown mock action: ${action}`);
  }
}
