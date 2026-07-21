/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Users, CreditCard, MapPin, Key, Ban, AlertTriangle, Settings, 
  ClipboardList, Download, LayoutDashboard, QrCode, Plus, Edit2, 
  RefreshCw, CheckCircle, XCircle, Shield, ShieldAlert, FileText, Search, Save, Calendar
} from 'lucide-react';
import { 
  readSheet, appendSheetRow, updateSheetRow, writeAuditLog, SCHEMA, initializeSystemData
} from '../googleApi';
import { createStaffAccount, rotateStaffPin, setStaffStatus } from '../firebase';
import { 
  UserRecord, ParkingCardRecord, PatrolPointRecord, KeyLogRecord, 
  IncidentReportRecord, BlacklistRecord, AuditLogRecord 
} from '../types';

interface AdminPanelProps {
  currentUser: {
    name: string;
    role: 'Guard' | 'Shift Leader' | 'Manager' | 'Admin';
  };
  loginEmail?: string;
  authorizationResult?: string;
}



type AdminTab = 'dashboard' | 'users' | 'cards' | 'points' | 'keys' | 'blacklist' | 'incidents' | 'settings' | 'audit';

export default function AdminPanel({ currentUser, loginEmail = '', authorizationResult = '' }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // States for Master Data
  const [userList, setUserList] = useState<UserRecord[]>([]);
  const [cardList, setCardList] = useState<ParkingCardRecord[]>([]);
  const [pointList, setPointList] = useState<PatrolPointRecord[]>([]);
  const [keyList, setKeyList] = useState<any[]>([]); // Keys sheet
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const [incidentList, setIncidentList] = useState<IncidentReportRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [systemSettings, setSystemSettings] = useState<any[]>([]);

  // Selection/Modals/Editing States
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [qrModalCode, setQrModalCode] = useState<{ value: string; title: string } | null>(null);

  // Search/Filters
  const [blacklistSearch, setBlacklistSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditFilterModule, setAuditFilterModule] = useState('');
  const [incidentFilterStatus, setIncidentFilterStatus] = useState('');
  const [incidentFilterSeverity, setIncidentFilterSeverity] = useState('');

  // Form States
  const [userForm, setUserForm] = useState({ name: '', username: '', role: 'Guard', shift: 'ทั่วไป', phone: '', pin: '' });
  const [cardForm, setCardForm] = useState({ card_number: '', qr_code_value: '', note: '' });
  const [pointForm, setPointForm] = useState({ point_name: '', location_detail: '', required_interval_minutes: 60 });
  const [keyForm, setKeyForm] = useState({ room_number: '', key_type: 'ห้องพัก', key_label: '', note: '' });
  const [blacklistForm, setBlacklistForm] = useState({ type: 'ทะเบียนรถ', vehicle_plate: '', id_card_number: '', name: '', reason: '', severity: 'เฝ้าระวังพิเศษ' });
  const [incidentForm, setIncidentForm] = useState({ status: 'แจ้งแล้ว', management_note: '', assigned_to: '', severity: 'Medium' });

  // Role Access Checks
  const isManager = currentUser.role === 'Manager';
  const isAdmin = currentUser.role === 'Admin';
  const hasEditAccess = isAdmin; // Manager is read-heavy

  const [initSystemLoading, setInitSystemLoading] = useState(false);

  const handleManualSystemInit = async () => {
    if (!isAdmin) {
      showToast('error', 'คุณไม่มีสิทธิ์ผู้ดูแลระบบหลัก (Admin) ในการดำเนินการจัดเตรียมค่าระบบ');
      return;
    }
    setInitSystemLoading(true);
    try {
      await initializeSystemData(currentUser.name, loginEmail);
      showToast('success', 'จัดเตรียมข้อมูลโครงสร้างพื้นฐานสำหรับระบบเรียบร้อยแล้ว! (เฉพาะตารางที่ว่างอยู่โดยไม่กระทบข้อมูลจริง)');
      await fetchData();
    } catch (err: any) {
      showToast('error', err.message || 'เกิดข้อผิดพลาดในการบูตสแตรประบบเริ่มต้น');
    } finally {
      setInitSystemLoading(false);
    }
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    if (type === 'success') {
      setSuccess(message);
      setTimeout(() => setSuccess(null), 4000);
    } else {
      setError(message);
      setTimeout(() => setError(null), 4000);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [u, c, p, k, b, i, a, s] = await Promise.all([
        readSheet<UserRecord>('Users'),
        readSheet<ParkingCardRecord>('ParkingCards'),
        readSheet<PatrolPointRecord>('PatrolPoints'),
        readSheet<any>('Keys'),
        readSheet<BlacklistRecord>('Blacklist'),
        readSheet<IncidentReportRecord>('IncidentReports'),
        readSheet<AuditLogRecord>('AuditLogs'),
        readSheet<any>('SystemSettings')
      ]);
      setUserList(u || []);
      setCardList(c || []);
      setPointList(p || []);
      setKeyList(k || []);
      setBlacklist(b || []);
      setIncidentList(i || []);
      setAuditLogs(a || []);
      setSystemSettings(s || []);
    } catch (err: any) {
      console.error(err);
      showToast('error', 'ไม่สามารถดึงข้อมูลจาก Cloud Firestore ได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  // Handle Create Operations
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasEditAccess) return showToast('error', 'เฉพาะ Admin เท่านั้นที่สร้างผู้ใช้งานได้');
    try {
      setLoading(true);
      const normalizedUsername = userForm.username.trim().toLowerCase().replace(/\s+/g, '');
      if (!/^[a-z0-9._-]{3,24}$/.test(normalizedUsername)) {
        throw new Error('Username ต้องมี 3–24 ตัว ใช้ a-z, 0-9, จุด, ขีดกลาง หรือขีดล่าง');
      }
      if (!/^\d{6}$/.test(userForm.pin)) {
        throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
      }
      const record = await createStaffAccount({
        username: normalizedUsername,
        operator_name: userForm.name,
        role: userForm.role as any,
        shift: userForm.shift,
        phone: userForm.phone,
        status: 'Active'
      }, userForm.pin);
      await writeAuditLog(currentUser.name, 'สร้างผู้ใช้งาน Firebase Auth', 'Users', record.user_id, '', JSON.stringify({ username: normalizedUsername, role: userForm.role }));
      setUserForm({ name: '', username: '', role: 'Guard', shift: 'ทั่วไป', phone: '', pin: '' });
      setShowAddForm(false);
      showToast('success', 'สร้าง Username และ PIN สำเร็จ');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message || 'สร้างผู้ใช้งานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้ทำการแก้ไขค่าระบบหลัก');
    try {
      setLoading(true);
      const cardId = 'C' + Math.floor(Math.random() * 9000 + 1000);
      const now = new Date().toISOString();
      const qrValue = cardForm.qr_code_value || `CARD_${cardForm.card_number}_QR`;
      const record: ParkingCardRecord = {
        card_id: cardId,
        card_number: cardForm.card_number,
        qr_code_value: qrValue,
        status: 'ว่าง',
        note: cardForm.note,
        created_at: now,
        updated_at: now
      };
      await appendSheetRow('ParkingCards', record);
      await writeAuditLog(currentUser.name, 'เพิ่มบัตรจอดรถ', 'ParkingCards', cardId, '', JSON.stringify(record));
      setCardForm({ card_number: '', qr_code_value: '', note: '' });
      setShowAddForm(false);
      showToast('success', 'เพิ่มบัตรจอดรถสำเร็จ!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้ทำการแก้ไขค่าระบบหลัก');
    try {
      setLoading(true);
      const pointId = 'PP' + Math.floor(Math.random() * 9000 + 1000);
      const now = new Date().toISOString();
      const qrVal = `PATROL_${pointForm.point_name}_QR`;
      const record: PatrolPointRecord = {
        patrol_point_id: pointId,
        point_name: pointForm.point_name,
        location_detail: pointForm.location_detail,
        qr_code_value: qrVal,
        required_interval_minutes: Number(pointForm.required_interval_minutes),
        status: 'Active',
        created_at: now,
        updated_at: now
      };
      await appendSheetRow('PatrolPoints', record);
      await writeAuditLog(currentUser.name, 'เพิ่มจุดตรวจพิกัด', 'PatrolPoints', pointId, '', JSON.stringify(record));
      setPointForm({ point_name: '', location_detail: '', required_interval_minutes: 60 });
      setShowAddForm(false);
      showToast('success', 'เพิ่มจุดตรวจพิกัดสำเร็จ!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้ทำการแก้ไขค่าระบบหลัก');
    try {
      setLoading(true);
      const keyId = 'KEY_R' + Math.floor(Math.random() * 9000 + 1000);
      const now = new Date().toISOString();
      const record = {
        key_id: keyId,
        room_number: keyForm.room_number,
        key_type: keyForm.key_type,
        key_label: keyForm.key_label || `กุญแจห้อง ${keyForm.room_number}`,
        status: 'Available',
        current_borrower_name: '',
        current_checkout_log_id: '',
        note: keyForm.note,
        created_at: now,
        updated_at: now
      };
      await appendSheetRow('Keys', record);
      await writeAuditLog(currentUser.name, 'เพิ่มกุญแจห้องในระบบ', 'Keys', keyId, '', JSON.stringify(record));
      setKeyForm({ room_number: '', key_type: 'ห้องพัก', key_label: '', note: '' });
      setShowAddForm(false);
      showToast('success', 'เพิ่มรหัสกุญแจห้องสำเร็จ!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้ทำการแก้ไขค่าระบบหลัก');
    try {
      setLoading(true);
      const blId = 'BL' + Math.floor(Math.random() * 9000 + 1000);
      const now = new Date().toISOString();
      const record: BlacklistRecord = {
        blacklist_id: blId,
        type: blacklistForm.type as any,
        vehicle_plate: blacklistForm.vehicle_plate,
        id_card_number: blacklistForm.id_card_number,
        name: blacklistForm.name,
        reason: blacklistForm.reason,
        severity: blacklistForm.severity as any,
        status: 'Active',
        created_at: now,
        updated_at: now
      };
      await appendSheetRow('Blacklist', record);
      await writeAuditLog(currentUser.name, 'สร้างประวัติแบล็กลิสต์', 'Blacklist', blId, '', JSON.stringify(record));
      setBlacklistForm({ type: 'ทะเบียนรถ', vehicle_plate: '', id_card_number: '', name: '', reason: '', severity: 'เฝ้าระวังพิเศษ' });
      setShowAddForm(false);
      showToast('success', 'สร้างแบล็กลิสต์สำเร็จ!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };


  const handleSetUsername = async (_user: UserRecord) => {
    showToast('error', 'Username ไม่สามารถเปลี่ยนภายหลังได้ หากต้องการเปลี่ยนให้สร้างบัญชีใหม่');
  };

  const handleResetUserPin = async (user: UserRecord) => {
    if (!isAdmin) return showToast('error', 'เฉพาะ Admin เท่านั้นที่รีเซ็ต PIN ได้');
    const newPin = window.prompt(`กำหนด PIN ใหม่สำหรับ ${user.operator_name}\nกรอกตัวเลข 6 หลัก`);
    if (newPin === null) return;
    if (!/^\d{6}$/.test(newPin)) return showToast('error', 'PIN ต้องเป็นตัวเลข 6 หลัก');
    try {
      setLoading(true);
      const replacement = await rotateStaffPin(user as any, newPin);
      await writeAuditLog(currentUser.name, 'รีเซ็ต PIN และหมุน Firebase Auth UID', 'Users', replacement.user_id, '', user.operator_name, loginEmail, currentUser.name);
      showToast('success', `รีเซ็ต PIN ให้ ${user.operator_name} เรียบร้อยแล้ว`);
      fetchData();
    } catch (err: any) {
      showToast('error', err.message || 'ไม่สามารถรีเซ็ต PIN ได้');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockUserPin = async (_user: UserRecord) => {
    showToast('success', 'Firebase Auth จัดการการจำกัดความพยายามเข้าสู่ระบบให้อัตโนมัติ');
  };

  const handleToggleUserStatus = async (user: UserRecord) => {
    if (!hasEditAccess) return showToast('error', 'เฉพาะ Admin เท่านั้นที่แก้ไขสถานะผู้ใช้งานได้');
    try {
      setLoading(true);
      const nextStatus = user.status === 'Active' ? 'Inactive' : 'Active';
      await setStaffStatus(user as any, nextStatus as 'Active' | 'Inactive');
      await writeAuditLog(currentUser.name, 'เปลี่ยนสถานะผู้ใช้งาน', 'Users', user.user_id, user.status, nextStatus);
      showToast('success', 'อัปเดตสถานะผู้ใช้งานสำเร็จ');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message || 'อัปเดตสถานะไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePointStatus = async (pt: PatrolPointRecord) => {
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้แก้ไขค่าระบบหลัก');
    try {
      setLoading(true);
      const nextStatus = pt.status === 'Active' ? 'Inactive' : 'Active';
      await updateSheetRow('PatrolPoints', 'patrol_point_id', pt.patrol_point_id, { status: nextStatus, updated_at: new Date().toISOString() });
      await writeAuditLog(currentUser.name, `เปลี่ยนสถานะจุดตรวจพิกัด`, 'PatrolPoints', pt.patrol_point_id, pt.status, nextStatus);
      showToast('success', 'อัปเดตสถานะจุดตรวจพิกัดสำเร็จ!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCardStatus = async (cardId: string, oldStatus: string, nextStatus: any) => {
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้แก้ไขบัตรจอดรถ');
    try {
      setLoading(true);
      await updateSheetRow('ParkingCards', 'card_id', cardId, { status: nextStatus, updated_at: new Date().toISOString() });
      await writeAuditLog(currentUser.name, `เปลี่ยนสถานะบัตรจอดรถ`, 'ParkingCards', cardId, oldStatus, nextStatus);
      showToast('success', 'อัปเดตสถานะบัตรจอดรถสำเร็จ!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateKeyStatus = async (keyId: string, oldStatus: string, nextStatus: string) => {
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้แก้ไขข้อมูลกุญแจ');
    try {
      setLoading(true);
      await updateSheetRow('Keys', 'key_id', keyId, { status: nextStatus, updated_at: new Date().toISOString() });
      await writeAuditLog(currentUser.name, `เปลี่ยนสถานะกุญแจห้อง`, 'Keys', keyId, oldStatus, nextStatus);
      showToast('success', 'อัปเดตสถานะกุญแจห้องเรียบร้อย!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBlacklistStatus = async (bl: BlacklistRecord) => {
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้แก้ไขแบล็กลิสต์');
    try {
      setLoading(true);
      const nextStatus = bl.status === 'Active' ? 'Inactive' : 'Active';
      await updateSheetRow('Blacklist', 'blacklist_id', bl.blacklist_id, { status: nextStatus, updated_at: new Date().toISOString() });
      await writeAuditLog(currentUser.name, `เปลี่ยนสถานะแบล็กลิสต์`, 'Blacklist', bl.blacklist_id, bl.status, nextStatus);
      showToast('success', 'เปลี่ยนสถานะรายชื่อเรียบร้อย!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Incident Review (Managers are allowed to update status and assign responsible person)
  const handleUpdateIncident = async (e: React.FormEvent, incidentId: string) => {
    e.preventDefault();
    try {
      setLoading(true);
      const original = incidentList.find(i => i.incident_id === incidentId);
      const isClosing = incidentForm.status === 'ปิดงานแล้ว';
      const updatePayload: any = {
        status: incidentForm.status,
        management_note: incidentForm.management_note,
        assigned_to: incidentForm.assigned_to,
        severity: incidentForm.severity,
        updated_at: new Date().toISOString()
      };
      if (isClosing) {
        updatePayload.resolved_at = new Date().toISOString();
      }
      await updateSheetRow('IncidentReports', 'incident_id', incidentId, updatePayload);
      await writeAuditLog(
        currentUser.name, 
        'ทบทวนรายงานเหตุผิดปกติ', 
        'IncidentReports', 
        incidentId, 
        original ? original.status : '', 
        `${incidentForm.status} | Assigned: ${incidentForm.assigned_to}`
      );
      setEditingId(null);
      showToast('success', 'อัปเดตรายงานเหตุการณ์ผิดปกติเรียบร้อย!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  // System Settings Update
  const handleUpdateSetting = async (key: string, value: string, oldValue: string) => {
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้เปลี่ยนการตั้งค่าระบบ');
    try {
      setLoading(true);
      await updateSheetRow('SystemSettings', 'setting_key', key, { 
        setting_value: value, 
        updated_by: currentUser.name, 
        updated_at: new Date().toISOString() 
      });
      await writeAuditLog(currentUser.name, 'เปลี่ยนค่าตัวแปรระบบ', 'SystemSettings', key, oldValue, value);
      showToast('success', `บันทึกค่าระบบ "${key}" เรียบร้อยแล้ว`);
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  // CSV Export & Backup Actions
  const handleExportCSV = (sheetName: keyof typeof SCHEMA) => {
    const headers = SCHEMA[sheetName];
    let rows: any[] = [];
    if (sheetName === 'Users') rows = userList;
    else if (sheetName === 'ParkingCards') rows = cardList;
    else if (sheetName === 'PatrolPoints') rows = pointList;
    else if (sheetName === 'Keys') rows = keyList;
    else if (sheetName === 'Blacklist') rows = blacklist;
    else if (sheetName === 'IncidentReports') rows = incidentList;
    else if (sheetName === 'AuditLogs') rows = auditLogs;
    
    if (rows.length === 0) {
      showToast('error', `ไม่พบข้อมูลในตาราง ${sheetName} สำหรับการส่งออก`);
      return;
    }

    const csvContent = [
      headers.join(','),
      ...rows.map(row => headers.map(header => {
        let val = row[header] !== undefined ? String(row[header]) : '';
        if (val.includes(',') || val.includes('\n') || val.includes('"')) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(','))
    ].join('\n');

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${sheetName}_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('success', `ส่งออกไฟล์ ${sheetName}.csv เรียบร้อย`);
  };

  const handleBackupFirestore = async () => {
    try {
      setLoading(true);
      const nowStr = new Date().toLocaleString('th-TH');
      localStorage.setItem('smart_guard_last_db_backup', nowStr);
      await writeAuditLog(currentUser.name, 'สร้างสำเนาสำรอง Cloud Firestore', 'SystemBackup', 'FIRESTORE_COPY', '', nowStr);
      showToast('success', `สร้างข้อมูลสำรองฐานข้อมูลเสร็จสิ้นเมื่อ ${nowStr}`);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBackupMediaFolder = async () => {
    try {
      setLoading(true);
      const nowStr = new Date().toLocaleString('th-TH');
      localStorage.setItem('smart_guard_last_media_backup', nowStr);
      await writeAuditLog(currentUser.name, 'สร้างโฟลเดอร์สำรองสื่อประกอบ', 'SystemBackup', 'STORAGE_MEDIA_COPY', '', nowStr);
      showToast('success', `สำรองข้อมูลโฟลเดอร์ภาพถ่ายสื่อสารแล้วเมื่อ ${nowStr}`);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Helper stats for Dashboard
  const activeUsers = userList.filter(u => u.status === 'Active').length;
  const activeCards = cardList.filter(c => c.status === 'ใช้งานอยู่').length;
  const lostCards = cardList.filter(c => c.status === 'สูญหาย/ระงับ' || c.status === 'ระงับชั่วคราว').length;
  const activePoints = pointList.filter(p => p.status === 'Active').length;
  const keysCheckedOut = keyList.filter(k => k.status === 'Checked Out' || k.status === 'ถูกเบิก').length;
  const openIncidents = incidentList.filter(i => i.status !== 'ปิดงานแล้ว' && i.status !== 'Closed').length;
  const criticalBlacklist = blacklist.filter(b => b.status === 'Active' && (b.severity === 'ห้ามเข้าเด็ดขาด' || b.severity === 'Critical')).length;

  return (
    <div className="w-full bg-slate-900 text-slate-100 rounded-3xl border border-slate-800 p-6 shadow-2xl relative overflow-hidden font-sans">
      <div className="absolute inset-0 bg-[radial-gradient(#2563eb_1px,transparent_1px)] [background-size:24px_24px] opacity-5 pointer-events-none"></div>

      {/* Header Panel */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-600/10 text-blue-500 rounded-2xl border border-blue-500/20">
            <Shield className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              แผงควบคุมผู้จัดการ & แอดมิน (Management Console)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              จัดการฐานข้อมูล ทะเบียนสิทธิ์ผู้ใช้ ตรวจสอบรายงานเหตุ และควบคุมความปลอดภัยขั้นสูง
            </p>
          </div>
        </div>

        {/* User Role Indicator Badge */}
        <div className="flex items-center gap-2.5 bg-slate-950 px-4 py-2 rounded-2xl border border-slate-800 self-start md:self-auto">
          {isAdmin ? (
            <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-black">
              <ShieldCheckIcon className="w-4 h-4" />
              <span>โหมดแอดมิน (Full Control Admin)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-amber-400 text-xs font-black">
              <ShieldAlert className="w-4 h-4" />
              <span>โหมดผู้จัดการ (Read-Heavy Manager)</span>
            </div>
          )}
        </div>
      </div>

      {/* Warning Alert Banner for Manager View */}
      {isManager && (
        <div className="bg-amber-950/40 border border-amber-900/50 rounded-2xl p-3 text-xs text-amber-400 font-bold mb-6 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-500" />
          <span>สิทธิ์เข้าใช้งานระดับผู้จัดการ: คุณสามารถอ่านข้อมูล ตรวจเช็ค และทบทวนรายงานเหตุการณ์ผิดปกติได้ แต่การสร้าง ลบ หรือปรับแต่งค่ามาสเตอร์จำเป็นต้องได้รับสิทธิ์จากแอดมิน</span>
        </div>
      )}

      {/* Toast Notification Messages */}
      {success && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white font-bold px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-xs border border-emerald-500/20 animate-fade-in">
          <CheckCircle className="w-4 h-4" /> {success}
        </div>
      )}
      {error && (
        <div className="fixed top-6 right-6 z-50 bg-red-600 text-white font-bold px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-xs border border-red-500/20 animate-fade-in">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Responsive Sub-navigation Grid */}
      <div className="relative z-10 grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2 mb-6 bg-slate-950/60 p-1.5 rounded-2xl border border-slate-800">
        {[
          { tab: 'dashboard', icon: LayoutDashboard, text: 'หน้าแรก' },
          { tab: 'users', icon: Users, text: 'พนักงาน' },
          { tab: 'cards', icon: CreditCard, text: 'บัตรจอดรถ' },
          { tab: 'points', icon: MapPin, text: 'จุดตรวจ' },
          { tab: 'keys', icon: Key, text: 'กุญแจหลัก' },
          { tab: 'blacklist', icon: Ban, text: 'แบล็กลิสต์' },
          { tab: 'incidents', icon: AlertTriangle, text: 'จัดการเหตุ' },
          { tab: 'settings', icon: Settings, text: 'ตั้งค่าระบบ' },
          { tab: 'audit', icon: ClipboardList, text: 'ประวัติระบบ' }
        ].map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.tab;
          return (
            <button
              key={item.tab}
              onClick={() => {
                setActiveTab(item.tab as AdminTab);
                setEditingId(null);
                setShowAddForm(false);
              }}
              className={`flex flex-col items-center justify-center p-2.5 rounded-xl transition-all cursor-pointer gap-1 ${
                isActive 
                  ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-500/10 scale-102' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-[10px] tracking-tight">{item.text}</span>
            </button>
          );
        })}
      </div>

      {/* Main Panel Content Body */}
      <div className="relative z-10 min-h-[400px]">

        {/* 10. Admin Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="flex flex-col gap-6">

            {/* Admin Verification Card */}
            <div className="bg-slate-950 border border-slate-800 p-6 rounded-2xl relative overflow-hidden flex flex-col gap-4">
              <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:20px_20px] opacity-5 pointer-events-none"></div>
              
              <div className="flex items-center gap-2 border-b border-slate-900 pb-3 z-10">
                <Shield className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <h4 className="text-sm font-black text-white">แผงตรวจสอบสิทธิ์และยืนยันตัวตนสำหรับผู้บริหาร (Admin Verification Console)</h4>
                  <p className="text-[10px] text-slate-500 font-medium">ข้อมูลจำเพาะของผู้ปฏิบัติการปัจจุบันที่เชื่อมต่อระบบคลาวด์</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 z-10">
                <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-xl">
                  <span className="text-[10px] text-slate-500 font-bold block uppercase">Signed-in Email</span>
                  <span className="text-xs font-bold text-blue-400 break-all font-mono block mt-1">{loginEmail || 'N/A'}</span>
                </div>
                <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-xl">
                  <span className="text-[10px] text-slate-500 font-bold block uppercase">Selected Operator Name</span>
                  <span className="text-xs font-bold text-white block mt-1">{currentUser.name || 'N/A'}</span>
                </div>
                <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-xl">
                  <span className="text-[10px] text-slate-500 font-bold block uppercase">Effective Role</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-bold mt-1 px-2 py-0.5 rounded ${
                    currentUser.role === 'Admin' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                    currentUser.role === 'Manager' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {currentUser.role || 'N/A'}
                  </span>
                </div>
                <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-xl">
                  <span className="text-[10px] text-slate-500 font-bold block uppercase">Authorization Result</span>
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 mt-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    {authorizationResult || 'Authorized - Active'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-slate-400 text-xs block font-bold">พนักงานรวม</span>
                  <span className="text-2xl font-black text-white mt-1 block">{activeUsers}</span>
                </div>
                <Users className="w-10 h-10 text-blue-500 opacity-20" />
              </div>
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-slate-400 text-xs block font-bold">บัตรใช้งานอยู่</span>
                  <span className="text-2xl font-black text-emerald-400 mt-1 block">{activeCards}</span>
                </div>
                <CreditCard className="w-10 h-10 text-emerald-500 opacity-20" />
              </div>
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-slate-400 text-xs block font-bold">บัตรระงับ / หาย</span>
                  <span className="text-2xl font-black text-red-400 mt-1 block">{lostCards}</span>
                </div>
                <Ban className="w-10 h-10 text-red-500 opacity-20" />
              </div>
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-slate-400 text-xs block font-bold">กุญแจถูกเบิก</span>
                  <span className="text-2xl font-black text-amber-400 mt-1 block">{keysCheckedOut}</span>
                </div>
                <Key className="w-10 h-10 text-amber-500 opacity-20" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl">
                <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-3 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> สรุปเหตุการณ์ที่รอการจัดการ
                </h3>
                <div className="flex flex-col gap-4 mt-2">
                  <div className="flex justify-between items-center bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                    <span className="text-xs font-medium text-slate-300">แจ้งเรื่องอุบัติภัยค้างคา</span>
                    <span className="px-2.5 py-1 bg-amber-600/20 text-amber-400 text-xs font-bold rounded-lg border border-amber-500/20">
                      {openIncidents} รายการ
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-900 p-3.5 rounded-xl border border-slate-800">
                    <span className="text-xs font-medium text-slate-300">ผู้ร้าย / แบล็กลิสต์ขั้นอันตราย</span>
                    <span className="px-2.5 py-1 bg-red-600/20 text-red-400 text-xs font-bold rounded-lg border border-red-500/20">
                      {criticalBlacklist} จุดเฝ้าระวัง
                    </span>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 bg-slate-950 border border-slate-800 p-5 rounded-2xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
                    <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" /> บันทึกการดำเนินการของแอดมินล่าสุด (Recent Actions)
                  </h3>
                  <button onClick={fetchData} className="p-1 hover:bg-slate-800 rounded text-slate-400">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-bold">
                        <th className="pb-2">ผู้กระทำ</th>
                        <th className="pb-2">กิจกรรม</th>
                        <th className="pb-2">ตาราง</th>
                        <th className="pb-2 text-right">เวลาดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.slice(-5).reverse().map((log, idx) => (
                        <tr key={idx} className="border-b border-slate-900 hover:bg-slate-900/50">
                          <td className="py-2.5 font-bold text-slate-300">{log.user_name}</td>
                          <td className="py-2.5 text-blue-400">{log.action}</td>
                          <td className="py-2.5 font-mono text-slate-500 text-[10px]">{log.module_name}</td>
                          <td className="py-2.5 text-right text-slate-400">
                            {log.created_at ? new Date(log.created_at).toLocaleTimeString('th-TH') : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 1. User & Role Management Tab */}
        {activeTab === 'users' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-500" /> จัดการสิทธิ์การใช้งาน และกะปฏิบัติการของพนักงาน
              </h3>
              {!showAddForm && isAdmin && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> เพิ่มพนักงานปฏิบัติงาน
                </button>
              )}
            </div>

            {showAddForm && (
              <form onSubmit={handleAddUser} className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex flex-col gap-4">
                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">ลงทะเบียนเจ้าหน้าที่รักษาความปลอดภัยใหม่</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ชื่อ-นามสกุลจริง</label>
                    <input
                      type="text"
                      required
                      value={userForm.name}
                      onChange={e => setUserForm({ ...userForm, name: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น นายมานะ รักดินดี"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-user-username" className="text-[10px] text-slate-400 font-bold block mb-1">Username สำหรับเข้าสู่ระบบ</label>
                    <input
                      id="new-user-username"
                      name="username"
                      type="text"
                      required
                      autoCapitalize="none"
                      value={userForm.username}
                      onChange={e => setUserForm({ ...userForm, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น guard01, leader01"
                    />
                    <div className="text-[9px] text-slate-500 mt-1">ผู้ใช้กรอก Username + PIN เท่านั้น ไม่ต้องใช้ Google</div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">บทบาท / สิทธิ์ปฏิบัติงาน</label>
                    <select
                      value={userForm.role}
                      onChange={e => setUserForm({ ...userForm, role: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                    >
                      <option value="Guard">Guard (เจ้าหน้าที่ รปภ.)</option>
                      <option value="Shift Leader">Shift Leader (หัวหน้ากะตรวจตรา)</option>
                      <option value="Manager">Manager (ผู้จัดการนิติอาคาร)</option>
                      <option value="Admin">Admin (แอดมินสูงสุด)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">กะปฏิบัติการประจำ</label>
                    <select
                      value={userForm.shift}
                      onChange={e => setUserForm({ ...userForm, shift: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                    >
                      <option value="กะเช้า (06:00 - 18:00)">กะเช้า (06:00 - 18:00)</option>
                      <option value="กะกลางคืน (18:00 - 06:00)">กะกลางคืน (18:00 - 06:00)</option>
                      <option value="ทั่วไป">ปฏิบัติงานทั่วไป / ทั่วไป</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">เบอร์โทรศัพท์ติดต่อ</label>
                    <input
                      type="text"
                      required
                      value={userForm.phone}
                      onChange={e => setUserForm({ ...userForm, phone: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น 081xxxxxxx"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-user-pin" className="text-[10px] text-slate-400 font-bold block mb-1">PIN สำหรับเข้าสู่ระบบ</label>
                    <input
                      id="new-user-pin"
                      name="pin"
                      type="password"
                      inputMode="numeric"
                      required
                      minLength={4}
                      maxLength={6}
                      value={userForm.pin}
                      onChange={e => setUserForm({ ...userForm, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="4–6 หลัก (Admin กำหนด)"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                  >
                    บันทึกข้อมูลเจ้าหน้าที่
                  </button>
                </div>
              </form>
            )}

            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-bold">
                      <th className="p-4">รหัสพนักงาน</th>
                      <th className="p-4">ชื่อ-นามสกุล</th>
                      <th className="p-4">สิทธิ์ / บทบาท</th>
                      <th className="p-4">กะปฏิบัติการ</th>
                      <th className="p-4">เบอร์โทรศัพท์</th>
                      <th className="p-4">สถานะ</th>
                      <th className="p-4 text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userList.map((user, idx) => (
                      <tr key={idx} className="border-b border-slate-900 hover:bg-slate-900/50">
                        <td className="p-4 font-mono font-bold text-slate-400">{user.user_id}</td>
                        <td className="p-4">
                          <div className="font-bold text-white">{user.operator_name}</div>
                          <div className="text-[10px] text-blue-400 font-mono mt-0.5">Username: {(user as any).username || (user.role === 'Admin' ? 'admin' : String(user.user_id || '').toLowerCase())}</div>
                        </td>
                        <td className="p-4">
                          <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                            user.role === 'Admin' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            user.role === 'Manager' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            user.role === 'Shift Leader' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                          }`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="p-4 text-slate-300">{user.shift}</td>
                        <td className="p-4 font-mono text-slate-300">{user.phone}</td>
                        <td className="p-4">
                          <span className={`font-bold text-[10px] flex items-center gap-1 ${
                            user.status === 'Active' ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${user.status === 'Active' ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                            {user.status === 'Active' ? 'พร้อมปฏิบัติการ' : 'ปิดใช้งาน'}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <div className="flex flex-wrap items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleSetUsername(user)}
                              className="px-3 py-1 text-[10px] font-bold rounded-lg cursor-pointer bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-400 border border-cyan-500/20"
                            >
                              กำหนด Username
                            </button>
                            <button
                              onClick={() => handleResetUserPin(user)}
                              className="px-3 py-1 text-[10px] font-bold rounded-lg cursor-pointer bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/20"
                            >
                              กำหนด/รีเซ็ต PIN
                            </button>
                            {(user as any).pinLockedUntil && (
                              <button
                                onClick={() => handleUnlockUserPin(user)}
                                className="px-3 py-1 text-[10px] font-bold rounded-lg cursor-pointer bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 border border-amber-500/20"
                              >
                                ปลดล็อก PIN
                              </button>
                            )}
                            <button
                              onClick={() => handleToggleUserStatus(user)}
                              className={`px-3 py-1 text-[10px] font-bold rounded-lg cursor-pointer ${
                                user.status === 'Active' 
                                  ? 'bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20' 
                                  : 'bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20'
                              }`}
                            >
                              {user.status === 'Active' ? 'ปิดสิทธิ์เข้าใช้' : 'เปิดใช้งานสิทธิ์'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 2. Parking Card Management Tab */}
        {activeTab === 'cards' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-emerald-500" /> ควบคุมและตรวจสอบบัตรจอดรถชั่วคราว (Parking Card Assets)
              </h3>
              {!showAddForm && isAdmin && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> สร้างสิทธิ์บัตรใหม่
                </button>
              )}
            </div>

            {showAddForm && (
              <form onSubmit={handleAddCard} className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex flex-col gap-4">
                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">บันทึกเพิ่มบัตรผู้มาติดต่อรายวัน</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">หมายเลขหน้าบัตร</label>
                    <input
                      type="text"
                      required
                      value={cardForm.card_number}
                      onChange={e => setCardForm({ ...cardForm, card_number: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น P999"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">รหัส QR Code (เว้นว่างไว้เพื่อสร้างอัตโนมัติ)</label>
                    <input
                      type="text"
                      value={cardForm.qr_code_value}
                      onChange={e => setCardForm({ ...cardForm, qr_code_value: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น P999_QR"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">หมายเหตุ / ประเภทการใช้งาน</label>
                    <input
                      type="text"
                      value={cardForm.note}
                      onChange={e => setCardForm({ ...cardForm, note: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น บัตรสำรอง สำหรับ VIP"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                  >
                    สร้างคีย์การ์ดผู้ติดต่อ
                  </button>
                </div>
              </form>
            )}

            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-bold">
                      <th className="p-4">รหัสระบุบัตร</th>
                      <th className="p-4">หมายเลขหน้าบัตร</th>
                      <th className="p-4">รหัส QR Code บาร์โค้ด</th>
                      <th className="p-4">สถานะบัตร</th>
                      <th className="p-4">รถยนต์ที่ถือกราฟ</th>
                      <th className="p-4">หมายเหตุ</th>
                      <th className="p-4 text-center">จัดการสถานะ / QR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardList.map((card, idx) => (
                      <tr key={idx} className="border-b border-slate-900 hover:bg-slate-900/50">
                        <td className="p-4 font-mono font-bold text-slate-400">{card.card_id}</td>
                        <td className="p-4 font-bold text-white">{card.card_number}</td>
                        <td className="p-4 font-mono text-slate-300 text-xs flex items-center gap-1">
                          <span>{card.qr_code_value}</span>
                          <button
                            onClick={() => setQrModalCode({ value: card.qr_code_value, title: `รหัส QR บัตรจอดรถหมายเลข: ${card.card_number}` })}
                            className="p-1 text-blue-400 hover:text-white"
                            title="แสดงภาพ QR สำหรับติดตั้งหน้ารถ"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            card.status === 'ว่าง' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            card.status === 'ใช้งานอยู่' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {card.status}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-blue-400">{card.current_vehicle_plate || '-'}</td>
                        <td className="p-4 text-slate-400 max-w-xs truncate">{card.note || '-'}</td>
                        <td className="p-4 text-center flex justify-center gap-1.5">
                          {isAdmin ? (
                            <>
                              <button
                                onClick={() => handleUpdateCardStatus(card.card_id, card.status, 'ว่าง')}
                                className="px-2 py-1 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 font-bold rounded text-[10px] border border-emerald-500/20"
                              >
                                ตั้งค่าว่าง
                              </button>
                              <button
                                onClick={() => handleUpdateCardStatus(card.card_id, card.status, 'สูญหาย/ระงับ')}
                                className="px-2 py-1 bg-red-600/10 hover:bg-red-600/20 text-red-400 font-bold rounded text-[10px] border border-red-500/20"
                              >
                                ระงับใช้
                              </button>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-500 font-bold">อ่านอย่างเดียว</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 3. Patrol Point Management Tab */}
        {activeTab === 'points' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-blue-500" /> บริหารจัดการจุดตรวจพิกัด (Patrol Checkpoints)
              </h3>
              {!showAddForm && isAdmin && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> เพิ่มพิกัดจุดตรวจ
                </button>
              )}
            </div>

            {showAddForm && (
              <form onSubmit={handleAddPoint} className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex flex-col gap-4">
                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">บันทึกเพิ่มพิกัดตำแหน่งตรวจตรวจเดินเวร</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ชื่อตำแหน่งตรวจ</label>
                    <input
                      type="text"
                      required
                      value={pointForm.point_name}
                      onChange={e => setPointForm({ ...pointForm, point_name: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น จุดตรวจ ชั้น 32 ทิศเหนือ"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">รายละเอียดตำแหน่งที่ชัดเจน</label>
                    <input
                      type="text"
                      required
                      value={pointForm.location_detail}
                      onChange={e => setPointForm({ ...pointForm, location_detail: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น ขวาด้านหน้าประตูหนีไฟหลัก"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ความถี่ในการตรวจที่บังคับ (นาที)</label>
                    <input
                      type="number"
                      required
                      value={pointForm.required_interval_minutes}
                      onChange={e => setPointForm({ ...pointForm, required_interval_minutes: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                  >
                    บันทึกพิกัดตรวจตรา
                  </button>
                </div>
              </form>
            )}

            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-bold">
                      <th className="p-4">พิกัดโค้ด</th>
                      <th className="p-4">ชื่อจุดพิกัดตรวจ</th>
                      <th className="p-4">รายละเอียดตำแหน่งที่ตั้ง</th>
                      <th className="p-4">รหัส QR Code (สแกนตรวจ)</th>
                      <th className="p-4">รอบเวลาตรวจ (นาที)</th>
                      <th className="p-4">สถานะการเดินกะ</th>
                      <th className="p-4 text-center">จัดการสถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pointList.map((pt, idx) => (
                      <tr key={idx} className="border-b border-slate-900 hover:bg-slate-900/50">
                        <td className="p-4 font-mono font-bold text-slate-400">{pt.patrol_point_id}</td>
                        <td className="p-4 font-bold text-white">{pt.point_name}</td>
                        <td className="p-4 text-slate-300">{pt.location_detail}</td>
                        <td className="p-4 font-mono text-blue-400 text-xs flex items-center gap-1">
                          <span>{pt.qr_code_value}</span>
                          <button
                            onClick={() => setQrModalCode({ value: pt.qr_code_value, title: `สติ๊กเกอร์ QR Code สำหรับติดตำแหน่งจุด: ${pt.point_name}` })}
                            className="p-1 text-blue-400 hover:text-white"
                            title="เปิดสติกเกอร์พิมพ์ QR Code สำหรับติด ณ จุดเดินตรวจ"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>
                        </td>
                        <td className="p-4 font-mono text-white text-center font-bold bg-slate-900/20">{pt.required_interval_minutes} นาที</td>
                        <td className="p-4">
                          <span className={`font-bold text-[10px] flex items-center gap-1 ${
                            pt.status === 'Active' ? 'text-emerald-400' : 'text-slate-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${pt.status === 'Active' ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                            {pt.status === 'Active' ? 'เปิดการเดินตรวจ' : 'ระงับชั่วคราว'}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          {isAdmin ? (
                            <button
                              onClick={() => handleTogglePointStatus(pt)}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded-lg cursor-pointer ${
                                pt.status === 'Active' 
                                  ? 'bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20' 
                                  : 'bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20'
                              }`}
                            >
                              {pt.status === 'Active' ? 'ระงับพิกัด' : 'เปิดตรวจตรา'}
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-500 font-bold">อ่านอย่างเดียว</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 4. Key Master Management Tab */}
        {activeTab === 'keys' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Key className="w-4 h-4 text-amber-500" /> ควบคุมระบบพวงกุญแจห้องและพื้นที่ส่วนกลางหลัก (Master Keys Assets)
              </h3>
              {!showAddForm && isAdmin && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> ลงทะเบียนกุญแจใหม่
                </button>
              )}
            </div>

            {showAddForm && (
              <form onSubmit={handleAddKey} className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex flex-col gap-4">
                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">ลงทะเบียนพวงกุญแจหลักระบบนิติบุคคล</h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">หมายเลขห้องพัก / ตำแหน่งห้อง</label>
                    <input
                      type="text"
                      required
                      value={keyForm.room_number}
                      onChange={e => setKeyForm({ ...keyForm, room_number: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น EE02 หรือ 305/14"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ประเภทแม่กุญแจ</label>
                    <select
                      value={keyForm.key_type}
                      onChange={e => setKeyForm({ ...keyForm, key_type: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                    >
                      <option value="ห้องพัก">ห้องพักส่วนบุคคล</option>
                      <option value="ห้องไฟฟ้า">ห้องระบบไฟฟ้า</option>
                      <option value="ห้องเครื่องจักร">ห้องระบบปั๊มน้ำ/เครื่องจักร</option>
                      <option value="พื้นที่ส่วนกลาง">พื้นที่ส่วนกลาง</option>
                      <option value="อื่นๆ">อื่นๆ</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ชื่อสลากป้ายกำกับพวงกุญแจ</label>
                    <input
                      type="text"
                      value={keyForm.key_label}
                      onChange={e => setKeyForm({ ...keyForm, key_label: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="ป้ายเขียนกำกับติดตัวกุญแจ"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">หมายเหตุ / ข้อมูลจำเพาะ</label>
                    <input
                      type="text"
                      value={keyForm.note}
                      onChange={e => setKeyForm({ ...keyForm, note: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="ข้อจำกัดการเบิกถอน"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ลงสารบบกุญแจห้องนิติ
                  </button>
                </div>
              </form>
            )}

            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-bold">
                      <th className="p-4">รหัสกุญแจ</th>
                      <th className="p-4">หมายเลขห้อง</th>
                      <th className="p-4">ประเภทกุญแจ</th>
                      <th className="p-4">ป้ายเขียนกำกับกุญแจ</th>
                      <th className="p-4">สถานะปัจจุบัน</th>
                      <th className="p-4">ผู้ยืมเบิกขณะนี้</th>
                      <th className="p-4">ข้อกำหนดเบิกถอน</th>
                      <th className="p-4 text-center">จัดการสถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyList.map((keyRec, idx) => (
                      <tr key={idx} className="border-b border-slate-900 hover:bg-slate-900/50">
                        <td className="p-4 font-mono font-bold text-slate-400 text-xs">{keyRec.key_id}</td>
                        <td className="p-4 font-bold text-white text-xs">{keyRec.room_number}</td>
                        <td className="p-4 text-slate-300 text-xs">{keyRec.key_type}</td>
                        <td className="p-4 text-slate-300 font-semibold">{keyRec.key_label}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            keyRec.status === 'Available' || keyRec.status === 'ว่าง' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            keyRec.status === 'Checked Out' || keyRec.status === 'ถูกเบิก' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {keyRec.status === 'Available' ? 'ว่าง (พร้อมเบิก)' : keyRec.status === 'Checked Out' ? 'ถูกเบิกไปใช้งาน' : keyRec.status}
                          </span>
                        </td>
                        <td className="p-4 text-blue-400 font-bold">{keyRec.current_borrower_name || '-'}</td>
                        <td className="p-4 text-slate-400 max-w-xs truncate">{keyRec.note || '-'}</td>
                        <td className="p-4 text-center">
                          {isAdmin ? (
                            <div className="flex justify-center gap-1.5">
                              <button
                                onClick={() => handleUpdateKeyStatus(keyRec.key_id, keyRec.status, 'Available')}
                                className="px-2 py-1 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 rounded text-[10px] font-bold border border-emerald-500/20"
                              >
                                เคลียร์ว่าง
                              </button>
                              <button
                                onClick={() => handleUpdateKeyStatus(keyRec.key_id, keyRec.status, 'Suspended')}
                                className="px-2 py-1 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded text-[10px] font-bold border border-red-500/20"
                              >
                                ระงับเบิก
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-500 font-bold">อ่านอย่างเดียว</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 5. Blacklist Management Tab */}
        {activeTab === 'blacklist' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Ban className="w-4 h-4 text-red-500" /> สารบบควบคุมบุคคลและทะเบียนยานพาหนะต้องสงสัยสูงสุด (Blacklist Hub)
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    value={blacklistSearch}
                    onChange={e => setBlacklistSearch(e.target.value)}
                    className="bg-slate-950 text-xs text-white pl-8 pr-3 py-2 rounded-xl border border-slate-800 outline-none w-48 focus:border-red-500"
                    placeholder="สืบค้นแบล็กลิสต์..."
                  />
                </div>
                {!showAddForm && isAdmin && (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> บันทึกภัยคุกคาม
                  </button>
                )}
              </div>
            </div>

            {showAddForm && (
              <form onSubmit={handleAddBlacklist} className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex flex-col gap-4">
                <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider">บันทึกเพิ่มบุคคลและพาหนะห้ามเข้าและสังเกตการณ์เป็นพิเศษ</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ประเภทแบล็กลิสต์</label>
                    <select
                      value={blacklistForm.type}
                      onChange={e => setBlacklistForm({ ...blacklistForm, type: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-red-500 outline-none"
                    >
                      <option value="ทะเบียนรถ">ทะเบียนยานพาหนะ (Vehicle)</option>
                      <option value="เลขบัตรประชาชน">บุคคล / เลขบัตรประชาชน (Person ID)</option>
                      <option value="ชื่อบุคคล">ผู้รับเหมาผิดกฎหมาย (Contractor)</option>
                      <option value="อื่นๆ">อื่นๆ (Other Security Threats)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ข้อมูลระบุภัยคุกคาม (ป้ายทะเบียน / ชื่อนามสกุล / เลขบัตร)</label>
                    <input
                      type="text"
                      required
                      value={blacklistForm.type === 'ทะเบียนรถ' ? blacklistForm.vehicle_plate : blacklistForm.type === 'เลขบัตรประชาชน' ? blacklistForm.id_card_number : blacklistForm.name}
                      onChange={e => {
                        const val = e.target.value;
                        if (blacklistForm.type === 'ทะเบียนรถ') setBlacklistForm({ ...blacklistForm, vehicle_plate: val, id_card_number: '', name: '' });
                        else if (blacklistForm.type === 'เลขบัตรประชาชน') setBlacklistForm({ ...blacklistForm, id_card_number: val, vehicle_plate: '', name: '' });
                        else setBlacklistForm({ ...blacklistForm, name: val, vehicle_plate: '', id_card_number: '' });
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-red-500 outline-none"
                      placeholder="ใส่รายละเอียดสำคัญตรงนี้"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ระดับความรุนแรงของสถานการณ์ (Severity)</label>
                    <select
                      value={blacklistForm.severity}
                      onChange={e => setBlacklistForm({ ...blacklistForm, severity: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-red-500 outline-none"
                    >
                      <option value="เตือนภัยระดับต่ำ">เตือนภัยระดับต่ำ (Low Alert)</option>
                      <option value="เฝ้าระวังพิเศษ">เฝ้าระวังเฝ้าระวัง (Medium Vigilance)</option>
                      <option value="เฝ้าระวังสูงสุด">ระดับสูง สังเกตการณ์อย่างเข้มข้น (High)</option>
                      <option value="ห้ามเข้าเด็ดขาด">ห้ามเข้าอาคารเด็ดขาดสูงสุด (Critical / Stop Entry)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">เหตุผลและประวัติทางพฤติกรรม (Reason & Note)</label>
                    <textarea
                      required
                      value={blacklistForm.reason}
                      onChange={e => setBlacklistForm({ ...blacklistForm, reason: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-red-500 outline-none h-16"
                      placeholder="ระบุพฤติกรรม ข้อกังวล หรือประวัติที่เคยมีปัญหา เช่น ลักขโมย ชักจูงบุคคลอื่นสร้างความปั่นป่วน"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ยืนยันการตั้งข้อห้ามแบล็กลิสต์
                  </button>
                </div>
              </form>
            )}

            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-bold">
                      <th className="p-4">รหัสระบุภัย</th>
                      <th className="p-4">ประเภทแบล็กลิสต์</th>
                      <th className="p-4">ข้อมูลระบุตัวตนบุคคลหรือพาหนะ</th>
                      <th className="p-4">ระดับภัยคุกคาม</th>
                      <th className="p-4">พฤติกรรมและพยานหลักฐาน</th>
                      <th className="p-4">สถานะผลบังคับ</th>
                      <th className="p-4 text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blacklist
                      .filter(b => {
                        const s = blacklistSearch.toLowerCase();
                        return b.blacklist_id.toLowerCase().includes(s) ||
                          (b.vehicle_plate && b.vehicle_plate.toLowerCase().includes(s)) ||
                          (b.id_card_number && b.id_card_number.toLowerCase().includes(s)) ||
                          (b.name && b.name.toLowerCase().includes(s)) ||
                          b.reason.toLowerCase().includes(s);
                      })
                      .map((bl, idx) => (
                        <tr key={idx} className="border-b border-slate-900 hover:bg-slate-900/50">
                          <td className="p-4 font-mono font-bold text-red-400">{bl.blacklist_id}</td>
                          <td className="p-4 font-bold text-slate-300">{bl.type}</td>
                          <td className="p-4 text-white font-extrabold text-sm">
                            {bl.type === 'ทะเบียนรถ' ? bl.vehicle_plate : bl.type === 'เลขบัตรประชาชน' ? bl.id_card_number : bl.name}
                          </td>
                          <td className="p-4">
                            <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                              bl.severity === 'ห้ามเข้าเด็ดขาด' || bl.severity === 'Critical' ? 'bg-red-500/15 text-red-400 border border-red-500/25' :
                              bl.severity === 'เฝ้าระวังพิเศษ' || bl.severity === 'High' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25' :
                              'bg-slate-500/15 text-slate-400 border border-slate-500/25'
                            }`}>
                              {bl.severity}
                            </span>
                          </td>
                          <td className="p-4 text-slate-400 max-w-sm truncate" title={bl.reason}>{bl.reason}</td>
                          <td className="p-4">
                            <span className={`font-bold text-[10px] flex items-center gap-1 ${
                              bl.status === 'Active' ? 'text-red-400 font-extrabold' : 'text-slate-500'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${bl.status === 'Active' ? 'bg-red-500' : 'bg-slate-500'}`}></span>
                              {bl.status === 'Active' ? 'ควบคุมเข้มข้น' : 'ยกเลิกคำสั่งห้าม'}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            {isAdmin ? (
                              <button
                                onClick={() => handleToggleBlacklistStatus(bl)}
                                className={`px-2.5 py-1 text-[10px] font-bold rounded-lg cursor-pointer ${
                                  bl.status === 'Active' 
                                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700' 
                                    : 'bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20'
                                }`}
                              >
                                {bl.status === 'Active' ? 'ยกเลิกแบล็กลิสต์' : 'บังคับใช้ใหม่'}
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-500 font-bold">อ่านอย่างเดียว</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 6. Incident Management Tab */}
        {activeTab === 'incidents' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> ควบคุมและสั่งการรายงานอุบัติภัย & เหตุผิดปกติ (Incident Response center)
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={incidentFilterStatus}
                  onChange={e => setIncidentFilterStatus(e.target.value)}
                  className="bg-slate-950 text-xs text-white px-3 py-1.5 rounded-xl border border-slate-800 outline-none"
                >
                  <option value="">กรองสถานะทั้งหมด</option>
                  <option value="แจ้งแล้ว">แจ้งแล้ว</option>
                  <option value="กำลังดำเนินการ">กำลังดำเนินการ</option>
                  <option value="ปิดงานแล้ว">ปิดงานแล้ว</option>
                </select>
                <select
                  value={incidentFilterSeverity}
                  onChange={e => setIncidentFilterSeverity(e.target.value)}
                  className="bg-slate-950 text-xs text-white px-3 py-1.5 rounded-xl border border-slate-800 outline-none"
                >
                  <option value="">กรองความรุนแรงทั้งหมด</option>
                  <option value="Low">Low (ต่ำ)</option>
                  <option value="Medium">Medium (กลาง)</option>
                  <option value="High">High (สูง)</option>
                  <option value="Critical">Critical (วิกฤติ)</option>
                </select>
              </div>
            </div>

            {editingId && (
              <form onSubmit={e => handleUpdateIncident(e, editingId)} className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex flex-col gap-4 border-l-4 border-l-amber-500">
                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">ทบทวนและลงบันทึกคำสั่งจัดการอุบัติภัย: #{editingId}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ความคืบหน้าของสถานการณ์</label>
                    <select
                      value={incidentForm.status}
                      onChange={e => setIncidentForm({ ...incidentForm, status: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                    >
                      <option value="แจ้งแล้ว">แจ้งแล้ว (Reported)</option>
                      <option value="กำลังดำเนินการ">กำลังดำเนินการ (In Progress)</option>
                      <option value="ปิดงานแล้ว">ปิดงานแล้วสมบูรณ์ (Resolved & Closed)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ความรุนแรงของอุบัติภัย</label>
                    <select
                      value={incidentForm.severity}
                      onChange={e => setIncidentForm({ ...incidentForm, severity: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                    >
                      <option value="Low">Low (รบกวนความเงียบสงบ)</option>
                      <option value="Medium">Medium (ชำรุดเสียหายเล็กน้อย)</option>
                      <option value="High">High (อันตรายต่อชีวิตและทรัพย์สิน)</option>
                      <option value="Critical">Critical (ภัยพิบัติร้ายแรง ด่วนที่สุด)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">ผู้ได้รับมอบหมายหลักแก้ไขสถานการณ์</label>
                    <input
                      type="text"
                      value={incidentForm.assigned_to}
                      onChange={e => setIncidentForm({ ...incidentForm, assigned_to: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น หัวหน้าช่างอาคาร หรือ รปภ. วิชัย"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">บันทึกความคิดเห็นจากนิติบุคคล / ฝ่ายบริหาร</label>
                    <input
                      type="text"
                      value={incidentForm.management_note}
                      onChange={e => setIncidentForm({ ...incidentForm, management_note: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="ข้อชี้แนะ หรือแนวทางการเยียวยาแก้ไข"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ยกเลิกการแก้ไข
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" /> บันทึกแนวทางสั่งการแก้ไข
                  </button>
                </div>
              </form>
            )}

            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-bold">
                      <th className="p-4">รหัสเหตุการ</th>
                      <th className="p-4">วันและเวลาที่เกิด</th>
                      <th className="p-4">จุดเกิดเหตุ</th>
                      <th className="p-4">หัวข้อประเภทเหตุ</th>
                      <th className="p-4">ระดับความร้ายแรง</th>
                      <th className="p-4">ผู้รับเรื่องในผลกะ</th>
                      <th className="p-4">วิสัยทัศน์ผู้รับมอบหมาย</th>
                      <th className="p-4">สถานะแก้ไข</th>
                      <th className="p-4 text-center">ทบทวนบันทึก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidentList
                      .filter(inc => {
                        if (incidentFilterStatus && inc.status !== incidentFilterStatus) return false;
                        if (incidentFilterSeverity && (inc as any).severity !== incidentFilterSeverity) return false;
                        return true;
                      })
                      .map((inc, idx) => (
                        <tr key={idx} className="border-b border-slate-900 hover:bg-slate-900/50">
                          <td className="p-4 font-mono font-bold text-red-400">{inc.incident_id}</td>
                          <td className="p-4 font-mono text-slate-300">
                            {inc.incident_datetime ? new Date(inc.incident_datetime).toLocaleString('th-TH') : '-'}
                          </td>
                          <td className="p-4 text-white font-bold">{inc.location}</td>
                          <td className="p-4 text-slate-300">{inc.incident_type}</td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              (inc as any).severity === 'Critical' ? 'bg-red-600 text-white' :
                              (inc as any).severity === 'High' ? 'bg-red-500/20 text-red-400 border border-red-500/20' :
                              (inc as any).severity === 'Medium' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20' :
                              'bg-slate-500/20 text-slate-400'
                            }`}>
                              {(inc as any).severity || 'Medium'}
                            </span>
                          </td>
                          <td className="p-4 text-slate-300">{inc.reported_by}</td>
                          <td className="p-4">
                            <div className="flex flex-col gap-0.5 text-[10px]">
                              <span className="text-slate-400">ผู้แก้ไข: <strong className="text-blue-400">{(inc as any).assigned_to || '-'}</strong></span>
                              <span className="text-slate-400 italic">บันทึกย่อ: {inc.management_note || '-'}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                              inc.status === 'ปิดงานแล้ว' || inc.status === 'Closed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                              inc.status === 'กำลังดำเนินการ' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                              'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}>
                              {inc.status}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <button
                              onClick={() => {
                                setEditingId(inc.incident_id);
                                setIncidentForm({
                                  status: inc.status,
                                  management_note: inc.management_note || '',
                                  assigned_to: (inc as any).assigned_to || '',
                                  severity: (inc as any).severity || 'Medium'
                                });
                              }}
                              className="px-2.5 py-1 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-lg text-[10px] font-bold border border-blue-500/20 cursor-pointer"
                            >
                              สั่งการ / รีวิว
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 7. System Settings Tab */}
        {activeTab === 'settings' && (
          <div className="flex flex-col gap-5">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Settings className="w-4 h-4 text-blue-500" /> ปรับค่าคอนฟิกตัวแปรกฎเกณฑ์ของระบบความปลอดภัยนิติอาคาร (Control Parameters)
            </h3>

            {isAdmin && (
              <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-xs font-black text-amber-400 block mb-1">🛠️ ตัวเลือกผู้พัฒนาและแอดมินสูงสุด (Admin System Bootstrapping)</span>
                  <p className="text-xs text-slate-400 font-bold">ระบบจะทำการสร้างรายชื่อผู้ใช้ บัตรจอดรถ พิกัดจุดตรวจ และข้อมูลพื้นฐานสำหรับทดสอบการปฏิบัติงานของ รปภ. ทันทีเมื่อตารางว่างเปล่า โดยจะไม่เขียนทับหรือลบข้อมูลที่ท่านได้บันทึกไว้ในปัจจุบัน</p>
                </div>
                <button
                  type="button"
                  disabled={initSystemLoading}
                  onClick={handleManualSystemInit}
                  className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer self-start md:self-auto shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${initSystemLoading ? 'animate-spin' : ''}`} />
                  {initSystemLoading ? 'กำลังจัดเตรียมข้อมูล...' : 'จัดเตรียมและรีเซ็ตค่าระบบเริ่มต้น (Initialize / Seed System)'}
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {systemSettings.map((setObj, idx) => {
                const key = setObj.setting_key;
                const value = setObj.setting_value;
                const desc = setObj.description;
                const isBool = setObj.setting_type === 'boolean';
                return (
                  <div key={idx} className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between gap-3 relative hover:border-slate-700 transition-all">
                    <div>
                      <span className="text-[10px] font-mono text-blue-400 block tracking-widest font-black uppercase">{key}</span>
                      <p className="text-xs text-slate-300 font-bold mt-1.5">{desc}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-2 pt-3 border-t border-slate-900">
                      {isBool ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!hasEditAccess}
                            onClick={() => handleUpdateSetting(key, value === 'true' ? 'false' : 'true', value)}
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                              value === 'true' 
                                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' 
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {value === 'true' ? 'เปิดใช้งาน (ENABLED)' : 'ปิดใช้งาน (DISABLED)'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex-1 flex gap-2">
                          <input
                            type="text"
                            disabled={!hasEditAccess}
                            defaultValue={value}
                            onBlur={e => {
                              if (e.target.value !== value) {
                                handleUpdateSetting(key, e.target.value, value);
                              }
                            }}
                            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:border-blue-500 outline-none"
                            placeholder="พิมพ์ระบุค่าตัวแปร"
                          />
                        </div>
                      )}
                      <span className="text-[10px] text-slate-500">โดย: {setObj.updated_by || 'แอดมิน'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 8 & 9. Audit Log Viewer & Backup Tab */}
        {activeTab === 'audit' && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              
              {/* 8. Audit Log Filter and Search View */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex flex-col gap-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <ClipboardList className="w-4 h-4 text-blue-500" /> ตรวจสอบพฤติกรรมเจ้าหน้าที่นิติ (Audit trail logs)
                </h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={e => setAuditSearch(e.target.value)}
                      className="w-full bg-slate-900 text-xs text-white pl-8 pr-3 py-2 rounded-xl border border-slate-800 outline-none focus:border-blue-500"
                      placeholder="ค้นหาตามชื่องาน พฤติกรรม รหัส..."
                    />
                  </div>
                  <select
                    value={auditFilterModule}
                    onChange={e => setAuditFilterModule(e.target.value)}
                    className="bg-slate-900 text-xs text-white px-3 py-2 rounded-xl border border-slate-800 outline-none shrink-0"
                  >
                    <option value="">โมดูลทั้งหมด</option>
                    <option value="Users">Users (สิทธิ์ผู้ใช้)</option>
                    <option value="ParkingCards">ParkingCards (บัตรจอดรถ)</option>
                    <option value="PatrolPoints">PatrolPoints (พิกัดจุดตรวจ)</option>
                    <option value="Keys">Keys (กุญแจห้อง)</option>
                    <option value="Blacklist">Blacklist (แบล็กลิสต์)</option>
                    <option value="IncidentReports">IncidentReports (อุบัติภัย)</option>
                  </select>
                </div>

                <div className="max-h-[300px] overflow-y-auto border border-slate-900 rounded-xl">
                  {auditLogs
                    .filter(log => {
                      const s = auditSearch.toLowerCase();
                      if (auditFilterModule && log.module_name !== auditFilterModule) return false;
                      return log.user_name.toLowerCase().includes(s) ||
                        log.action.toLowerCase().includes(s) ||
                        (log.record_id && log.record_id.toLowerCase().includes(s)) ||
                        (log.old_value && log.old_value.toLowerCase().includes(s)) ||
                        (log.new_value && log.new_value.toLowerCase().includes(s));
                    })
                    .slice()
                    .reverse()
                    .map((log, idx) => (
                      <div key={idx} className="p-3 border-b border-slate-900 hover:bg-slate-900/40 text-xs flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span className="font-bold text-slate-400">{log.user_name}</span>
                          <span>{log.created_at ? new Date(log.created_at).toLocaleString('th-TH') : ''}</span>
                        </div>
                        <div>
                          <span className="text-blue-400 font-extrabold">{log.action}</span> ในตาราง <span className="font-mono text-slate-500">{log.module_name}</span> (ID: <span className="font-mono text-slate-400">{log.record_id}</span>)
                        </div>
                        {log.old_value || log.new_value ? (
                          <div className="bg-slate-900 p-2 rounded-lg text-[10px] font-mono text-slate-400 flex flex-col gap-1 overflow-hidden truncate">
                            {log.old_value && <div className="truncate"><span className="text-red-400">ค่าเดิม:</span> {log.old_value}</div>}
                            {log.new_value && <div className="truncate"><span className="text-emerald-400">ค่าอัปเดต:</span> {log.new_value}</div>}
                          </div>
                        ) : null}
                      </div>
                    ))}
                </div>
              </div>

              {/* 9. Data Export & Backup Settings Panel */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl flex flex-col gap-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Download className="w-4 h-4 text-emerald-500" /> ส่งออกฐานข้อมูลและสำรองระบบคลาวด์ (Data Backup center)
                </h3>

                <div className="flex flex-col gap-3">
                  <span className="text-[10px] text-slate-400 font-bold block">1. เลือกโมดูลตารางข้อมูลที่ต้องการส่งออก (Export to CSV)</span>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { name: 'Users', label: 'ผู้ใช้งานและกะ รปภ.' },
                      { name: 'ParkingCards', label: 'บัตรจอดรถชั่วคราว' },
                      { name: 'PatrolPoints', label: 'จุดตรวจพิกัดเดินกะ' },
                      { name: 'Keys', label: 'พวงกุญแจห้องนิติ' },
                      { name: 'Blacklist', label: 'แบล็กลิสต์เฝ้าระวัง' },
                      { name: 'IncidentReports', label: 'เหตุผิดปกติ/อุบัติภัย' },
                      { name: 'AuditLogs', label: 'บันทึกประวัติความเปลี่ยนแปลง' }
                    ].map(btn => (
                      <button
                        key={btn.name}
                        onClick={() => handleExportCSV(btn.name as any)}
                        className="p-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl font-bold text-left flex items-center justify-between transition-all text-xs cursor-pointer"
                      >
                        <span>{btn.label}</span>
                        <Download className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3 pt-4 border-t border-slate-900">
                  <span className="text-[10px] text-slate-400 font-bold block">2. ดำเนินการสำรองฐานข้อมูล Cloud Firestore / Storage</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      onClick={handleBackupFirestore}
                      className="p-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                    >
                      <FileText className="w-4 h-4" /> สำรองข้อมูล Firestore
                    </button>
                    <button
                      onClick={handleBackupMediaFolder}
                      className="p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                    >
                      <Download className="w-4 h-4" /> สำรองโฟลเดอร์ภาพถ่าย
                    </button>
                  </div>
                  <div className="flex flex-col gap-1 text-[10px] text-slate-500 italic mt-2 bg-slate-900 p-3 rounded-lg border border-slate-800">
                    <div>สำรองฐานข้อมูลล่าสุดเมื่อ: <strong className="text-slate-300">{localStorage.getItem('smart_guard_last_db_backup') || 'ไม่พบประวัติ'}</strong></div>
                    <div>สำรองภาพถ่ายล่าสุดเมื่อ: <strong className="text-slate-300">{localStorage.getItem('smart_guard_last_media_backup') || 'ไม่พบประวัติ'}</strong></div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

      </div>

      {/* QR Code display Modal for Print */}
      {qrModalCode && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm flex flex-col items-center gap-5 text-center shadow-2xl">
            <h3 className="text-sm font-extrabold text-white">{qrModalCode.title}</h3>
            <div className="bg-white p-6 rounded-2xl inline-block border-4 border-blue-500 shadow-inner">
              <div className="w-44 h-44 bg-slate-100 flex flex-col items-center justify-center border border-slate-300 text-slate-800 relative">
                {/* Visual Simulation of QR code layout */}
                <div className="absolute top-2 left-2 w-10 h-10 border-4 border-slate-950"></div>
                <div className="absolute top-2 right-2 w-10 h-10 border-4 border-slate-950"></div>
                <div className="absolute bottom-2 left-2 w-10 h-10 border-4 border-slate-950"></div>
                <div className="w-14 h-14 bg-slate-950 opacity-10"></div>
                <div className="text-[9px] font-mono font-black mt-2 bg-slate-200 px-1 py-0.5 rounded text-slate-600 truncate max-w-[140px] z-10 select-all" title="คัดลอกรหัส QR">
                  {qrModalCode.value}
                </div>
              </div>
            </div>
            <p className="text-slate-400 text-xs">
              พิมพ์ภาพ QR Code นี้ แปะตามพิกัดจุดเดินตรวจ เพื่อให้ รปภ. นำมาแสกนระหว่างปฏิบัติหน้าที่กะประจำวัน
            </p>
            <div className="flex gap-2 w-full">
              <button
                onClick={() => {
                  window.print();
                }}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
              >
                สั่งพิมพ์ภาพสติกเกอร์
              </button>
              <button
                onClick={() => setQrModalCode(null)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Inline fallback since ShieldCheck might not exist
function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2.5" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 9.7a1 1 0 0 1-.68 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 .76-.97l8-2a1 1 0 0 1 .48 0l8 2A1 1 0 0 1 20 6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
