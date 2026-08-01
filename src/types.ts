/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Timestamp } from 'firebase/firestore';

export interface UserRecord {
  user_id: string;
  operator_id?: string;
  account_id?: string;
  username?: string;
  site_id?: string;
  login_email: string;
  operator_name: string;
  role: 'Guard' | 'ShiftHead' | 'Manager' | 'Admin';
  shift: string;
  phone: string;
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}

export type ParkingCardStatus = 'Available' | 'Reserved' | 'InUse' | 'Returned' | 'Disabled' | 'Suspended' | 'Lost' | 'Cancelled' | 'Replaced' | 'ReplacementApproved' | 'Retired' | 'VIP';
export type ParkingCardType = 'Temporary' | 'VIP' | 'Resident' | 'Contractor' | 'Staff' | 'Other';

export interface ParkingCardRecord {
  firestore_document_id: string;
  card_id: string;
  site_id: string;
  card_number: string;
  card_number_normalized: string;
  qr_code_value: string;
  qr_code_normalized: string;
  card_type: ParkingCardType;
  status: ParkingCardStatus;
  status_normalized: ParkingCardStatus;
  status_original?: string;
  current_vehicle_plate?: string;
  current_vehicle_log_id?: string;
  current_vehicle_session_id?: string;
  last_activity_at?: string;
  member_id?: string;
  lost_reason?: string;
  lost_at?: string;
  reported_by?: string;
  reported_by_account_uid?: string;
  related_vehicle_log_id?: string;
  replacement_card_id?: string;
  replaced_by_card_id?: string;
  replaced_by_document_id?: string;
  replacement_for_card_id?: string;
  replacement_for_document_id?: string;
  replacement_reason?: string;
  replacement_at?: string;
  replacement_by?: string;
  created_by?: string;
  replacement_approved?: boolean;
  replacement_approved_by?: string;
  replacement_approved_at?: string;
  note?: string;
  created_at: string;
  updated_at: string;
}

export type VehicleSessionStage =
  | 'Created' | 'CardIssued' | 'VehicleEntered' | 'PlateCaptured'
  | 'VehicleCaptured' | 'VisitorInfo' | 'DestinationSelected'
  | 'EvidenceUploaded' | 'Ready' | 'Active' | 'VehicleExited'
  | 'Completed' | 'Cancelled';

export type VehicleSessionStatus =
  | 'Draft' | 'Pending' | 'InProgress' | 'WaitingPhoto' | 'WaitingVisitor'
  | 'WaitingDestination' | 'WaitingEvidence' | 'Ready' | 'Completed' | 'Cancelled';

export type VehicleQueueStatus =
  | 'Waiting' | 'Assigned' | 'In Progress' | 'Waiting Information'
  | 'Ready' | 'Completed';

export type VehicleQueuePriority = 'Emergency' | 'High' | 'Normal' | 'Low';

export interface VehicleQueueMetrics {
  firstQueuedAt: Timestamp | null;
  firstAssignedAt: Timestamp | null;
  workStartedAt: Timestamp | null;
  readyAt: Timestamp | null;
  completedAt: Timestamp | null;
  waitingSeconds: number;
  workingSeconds: number;
  totalCycleSeconds: number;
  transferCount: number;
  reassignCount: number;
  releaseCount: number;
  priorityChangeCount: number;
  lastTransitionAt: Timestamp | null;
  lastEventId: string;
  metricsVersion: number;
}

export interface VehicleSessionActivity {
  action: string;
  stage: VehicleSessionStage;
  by: string;
  byName: string;
  at: string;
}

export interface VehicleSessionRecord {
  session_id: string;
  site_id: string;
  parking_card_id: string;
  card_number: string;
  stage: VehicleSessionStage;
  status: VehicleSessionStatus;
  opened_by: string;
  opened_by_name: string;
  current_owner: string;
  last_updated_by: string;
  assigned_to?: string;
  queueStatus: VehicleQueueStatus;
  priority: VehicleQueuePriority;
  assignedTo: string | null;
  assignedBy: string | null;
  assignedAt?: string;
  queuePosition: number | null;
  sessionVersion: number;
  assignmentVersion: number;
  queueMetrics: VehicleQueueMetrics;
  last_activity_at: string;
  editing_by?: string;
  editing_by_name?: string;
  editing_since?: string;
  expires_at?: string;
  vehicle_plate?: string;
  vehicle_type?: VehicleLogRecord['vehicle_type'];
  visitor_name?: string;
  visitor_phone?: string;
  target_room?: string;
  target_unit_id?: string;
  target_building?: string;
  unit_lookup_status?: 'matched' | 'manual';
  purpose?: string;
  note?: string;
  entry_plate_photo_url?: string;
  entry_vehicle_photo_url?: string;
  vehicle_log_id?: string;
  activity: VehicleSessionActivity[];
  created_at: string;
  updated_at: string;
}

/** Canonical master-data record for an occupiable unit. */
export interface UnitRecord {
  /** Firestore path segment; separate from the user-visible business unit_id. */
  firestore_document_id: string;
  unit_id: string;
  site_id: string;
  building: string;
  room_code?: string;
  room_number: string;
  floor: string;
  area?: string;
  ratio?: string;
  owner_name: string;
  resident_name: string;
  phone?: string;
  email?: string;
  occupancy_status: string;
  status: 'Active' | 'Inactive';
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
  vehicle_session_id?: string;
  site_id: string;
  card_number: string;
  parking_card_id?: string;
  vehicle_plate: string;
  vehicle_type: 'รถยนต์' | 'จักรยานยนต์' | 'รถส่งของ' | 'อื่นๆ';
  visitor_name: string;
  visitor_phone: string;
  target_room: string;
  /** Optional reference to Units; target_room remains the historical display field. */
  target_unit_id?: string;
  target_building?: string;
  unit_lookup_status?: 'matched' | 'manual';
  purpose: string;
  entry_time: string;
  exit_time?: string;
  entry_plate_photo_url?: string;
  entry_vehicle_photo_url?: string;
  exit_plate_photo_url?: string;
  exit_vehicle_photo_url?: string;
  workflow_status?: 'active' | 'completed';
  exit_recorded_by?: string;
  exit_account_uid?: string;
  exit_operator_id?: string;
  exit_operator_name?: string;
  exit_role?: string;
  exit_site_id?: string;
  exit_note?: string;
  abnormal_note?: string;
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
  activities?: ContractorActivityRecord[];
  workspace_lock_uid?: string;
  workspace_lock_name?: string;
  workspace_lock_expires_at?: string;
}

export type ContractorActivityType =
  | 'entered'
  | 'warning'
  | 'violation'
  | 'remark'
  | 'exit'
  | 'custom';

export interface ContractorActivityRecord {
  activity_id: string;
  activity_type: ContractorActivityType;
  note: string;
  created_at: string;
  created_by: string;
  site_id: string;
  contractor_id: string;
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
  return_photo_url?: string;
  return_signature_url?: string;
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
  area?: string;
  building?: string;
  floor?: string;
  sort_order?: number;
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
  patrol_point_name?: string;
  custom_location?: string;
  area_status?: 'normal' | 'abnormal';
  abnormal_reason?: string;
  evidence_photo_1_url?: string;
  evidence_photo_2_url?: string;
  evidence_photo_1_file_id?: string;
  evidence_photo_2_file_id?: string;
  captured_at_client?: string;
  recorded_by_uid?: string;
  workflow_status?: 'completed';
  shift_id?: string;
  shift_end_at?: string;
  operational_date?: string;
  photo_url?: string;
  status: 'ปกติ' | 'ผิดปกติ' | 'ต้องติดตาม';
  abnormal_detail?: string;
  incident_photo_url?: string;
  note?: string;
  remarks?: string;
  created_at: string;
  login_email?: string;
  operator_name?: string;
  revision_number?: number;
  last_revision_id?: string;
  last_edited_at?: string;
  last_edited_by_uid?: string;
  last_edited_by_name?: string;
  has_corrections?: boolean;
}

export interface IncidentReportRecord {
  incident_id: string;
  incident_datetime: string;
  location: string;
  location_type?: 'unit' | 'patrol_point' | 'common_area' | 'custom';
  patrol_point_id?: string;
  location_name_snapshot?: string;
  custom_location?: string;
  target_unit_id?: string;
  unit_lookup_status?: 'matched' | 'manual';
  incident_type: 'อัคคีภัย' | 'น้ำท่วม/ท่อแตก' | 'โจรกรรม/ลักทรัพย์' | 'ทะเลาะวิวาท' | 'อุปกรณ์ชำรุด' | 'อื่นๆ';
  description: string;
  photo_url?: string;
  photo_file_id?: string;
  reported_at?: string;
  reporter_name?: string;
  involved_parties?: string;
  damage_details?: string;
  initial_action?: string;
  remarks?: string;
  outcome?: string;
  priority?: 'Low' | 'Normal' | 'High' | 'Emergency';
  incident_status?: 'reported' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed';
  alert_status?: 'active' | 'acknowledged' | 'cleared';
  acknowledged_at?: string;
  acknowledged_by?: string;
  action_started_at?: string;
  action_started_by?: string;
  resolution_summary?: string;
  resolved_at?: string;
  resolved_by?: string;
  closed_at?: string;
  closed_by?: string;
  recorded_by_uid?: string;
  revision_number?: number;
  last_revision_id?: string;
  last_edited_at?: string;
  last_edited_by_uid?: string;
  last_edited_by_name?: string;
  has_corrections?: boolean;
  shift_id?: string;
  shift_end_at?: string;
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
