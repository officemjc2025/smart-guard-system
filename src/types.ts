export interface GuardLog {
  id: string;
  guardName: string;
  timestamp: string;
  status: 'Checked In' | 'On Patrol' | 'Checked Out' | 'Incident';
  notes: string;
  imageUrl?: string;
}

export interface AuthenticatedSession {
  uid: string;
  email: string;
  role: 'admin' | 'guard';
  siteId: string;
  operatorId: string;
  operatorName: string;
  recorded_by: string;
}

export interface Operator {
  uid: string;
  email: string;
  role: 'admin' | 'guard';
  site_id: string;
  operator_id: string;
  name: string;
}

export interface BaseTransaction {
  id: string;
  site_id: string;
  account_uid: string;
  login_email: string;
  operator_id: string;
  operator_name: string;
  role: string;
  recorded_by: string;
  created_at: string;
}

export interface VehicleLog extends BaseTransaction {
  vehicle_plate: string;
  vehicle_type: string;
  driver_name: string;
  purpose: string;
  entry_time: string;
  exit_time: string | null;
  status: 'Entered' | 'Exited';
}

export interface ContractorLog extends BaseTransaction {
  contractor_name: string;
  company: string;
  purpose: string;
  entry_time: string;
  exit_time: string | null;
  status: 'Active' | 'Exited';
}

export interface KeyLog extends BaseTransaction {
  key_name: string;
  borrower: string;
  purpose: string;
  status: 'Borrowed' | 'Returned';
  borrow_time: string;
  return_time: string | null;
}

export interface PatrolLog extends BaseTransaction {
  checkpoint: string;
  status: 'Pass' | 'Fail' | 'Issue Found';
  notes: string;
}

export interface IncidentReport extends BaseTransaction {
  title: string;
  description: string;
  severity: 'Low' | 'Medium' | 'High';
  status: 'Reported' | 'Under Investigation' | 'Resolved';
  imageUrl?: string | null;
}

export interface AuditLog extends BaseTransaction {
  action: string;
  details: string;
}

export interface DailyReport extends BaseTransaction {
  report_date: string;
  summary: string;
  patrol_count: number;
  incident_count: number;
  status: 'Draft' | 'Submitted' | 'Approved';
}

export interface MigrationStats {
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface MigrationResult {
  stats: Record<string, MigrationStats>;
  auditLogId?: string;
  logs: string[];
}
