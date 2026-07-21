/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface UserRecord {
  user_id: string;
  login_email: string;
  operator_name: string;
  role: 'Guard' | 'Shift Leader' | 'Manager' | 'Admin';
  shift: string;
  phone: string;
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}

export interface ParkingCardRecord {
  card_id: string;
  card_number: string;
  qr_code_value: string;
  status: 'ว่าง' | 'ใช้งานอยู่';
  current_vehicle_plate?: string;
  note?: string;
  created_at: string;
  updated_at: string;
}

/** Canonical master-data record for an occupiable unit. */
export interface UnitRecord {
  unit_id: string;
  site_id: string;
  room_code?: string;
  room_number: string;
  floor: string;
  area?: string;
  ratio?: string;
  owner_name: string;
  phone?: string;
  email?: string;
  occupancy_status: string;
  searchable_text: string;
  search_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  source_file_name?: string;
  import_batch_id?: string;
}

export interface VehicleLogRecord {
  log_id: string;
  card_number: string;
  vehicle_plate: string;
  vehicle_type: 'รถยนต์' | 'จักรยานยนต์' | 'รถส่งของ' | 'อื่นๆ';
  visitor_name: string;
  visitor_phone: string;
  target_room: string;
  /** Optional reference to Units; target_room remains the historical display field. */
  target_unit_id?: string;
  unit_lookup_status?: 'matched' | 'manual';
  purpose: string;
  entry_time: string;
  exit_time?: string;
  entry_plate_photo_url?: string;
  entry_vehicle_photo_url?: string;
  exit_plate_photo_url?: string;
  exit_vehicle_photo_url?: string;
  status: 'กำลังจอด' | 'ออกแล้ว';
  recorded_by: string;
  note?: string;
  created_at: string;
  updated_at: string;
  login_email?: string;
  operator_name?: string;
}

export interface ContractorLogRecord {
  contractor_log_id: string;
  contractor_name: string;
  id_card_number: string;
  phone: string;
  company: string;
  target_room: string;
  target_unit_id?: string;
  unit_lookup_status?: 'matched' | 'manual';
  owner_name: string;
  work_type: string;
  entry_time: string;
  exit_time?: string;
  id_card_photo_url?: string;
  face_photo_url?: string;
  status: 'กำลังปฏิบัติงาน' | 'ออกแล้ว';
  recorded_by: string;
  note?: string;
  created_at: string;
  updated_at: string;
  login_email?: string;
  operator_name?: string;
}

export interface KeyLogRecord {
  key_log_id: string;
  room_number: string;
  target_unit_id?: string;
  unit_lookup_status?: 'matched' | 'manual';
  key_type: 'ห้องพัก' | 'ห้องไฟฟ้า' | 'ห้องเครื่องจักร' | 'พื้นที่ส่วนกลาง' | 'อื่นๆ';
  borrower_name: string;
  borrower_phone: string;
  borrower_id_number: string;
  purpose: string;
  checkout_time: string;
  return_time?: string;
  issued_by: string;
  returned_by?: string;
  signature_image_url?: string;
  borrower_photo_url?: string;
  document_photo_url?: string;
  status: 'ถูกเบิก' | 'คืนแล้ว';
  note?: string;
  created_at: string;
  updated_at: string;
  login_email?: string;
  operator_name?: string;
}

export interface PatrolPointRecord {
  patrol_point_id: string;
  point_name: string;
  location_detail: string;
  qr_code_value: string;
  required_interval_minutes: number;
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}

export interface PatrolLogRecord {
  patrol_log_id: string;
  patrol_point_id: string;
  point_name: string;
  guard_name: string;
  shift_type: 'เช้า' | 'กลางคืน';
  checkin_time: string;
  photo_url?: string;
  status: 'ปกติ' | 'ผิดปกติ' | 'ต้องติดตาม';
  abnormal_detail?: string;
  incident_photo_url?: string;
  note?: string;
  created_at: string;
  login_email?: string;
  operator_name?: string;
}

export interface IncidentReportRecord {
  incident_id: string;
  incident_datetime: string;
  location: string;
  target_unit_id?: string;
  unit_lookup_status?: 'matched' | 'manual';
  incident_type: 'อัคคีภัย' | 'น้ำท่วม/ท่อแตก' | 'โจรกรรม/ลักทรัพย์' | 'ทะเลาะวิวาท' | 'อุปกรณ์ชำรุด' | 'อื่นๆ';
  description: string;
  photo_url?: string;
  reported_by: string;
  shift_leader: string;
  management_note?: string;
  status: 'แจ้งแล้ว' | 'กำลังดำเนินการ' | 'ปิดงานแล้ว';
  created_at: string;
  updated_at: string;
  login_email?: string;
  operator_name?: string;
}

export interface BlacklistRecord {
  blacklist_id: string;
  type: 'ทะเบียนรถ' | 'เลขบัตรประชาชน' | 'ชื่อบุคคล';
  vehicle_plate?: string;
  id_card_number?: string;
  name?: string;
  reason: string;
  severity: 'เตือนภัยระดับต่ำ' | 'ห้ามเข้าเด็ดขาด' | 'เฝ้าระวังพิเศษ';
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}

export interface DailyReportRecord {
  report_id: string;
  report_date: string;
  shift_type: 'เช้า' | 'กลางคืน';
  total_vehicle_in: number;
  total_vehicle_out: number;
  total_contractors: number;
  total_keys_not_returned: number;
  total_patrol_missing: number;
  total_incidents: number;
  blacklist_alerts: number;
  shift_leader: string;
  note?: string;
  created_at: string;
  login_email?: string;
  operator_name?: string;
}

export interface AuditLogRecord {
  audit_id: string;
  user_name: string;
  action: string;
  module_name: string;
  record_id: string;
  old_value?: string;
  new_value?: string;
  created_at: string;
  login_email?: string;
  operator_name?: string;
  action_result?: string;
  ip_or_session_id?: string;
}
