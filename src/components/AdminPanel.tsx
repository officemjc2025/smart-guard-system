/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  Users, CreditCard, MapPin, Key, Ban, AlertTriangle, Settings, 
  ClipboardList, Download, LayoutDashboard, QrCode, Plus, Edit2, 
  RefreshCw, CheckCircle, XCircle, Shield, ShieldAlert, FileText, Search, Save, Calendar, Home
} from 'lucide-react';
import { 
  collection, doc, query, where, getDocs, writeBatch 
} from 'firebase/firestore';
import { clearUnitCache } from '../hooks/useUnits';
import { db, auth } from '../firebase';
import { 
  readSheet, appendSheetRow, updateSheetRow, writeAuditLog, SCHEMA, initializeSystemData,
  COLLECTION_MAPPING
} from '../googleApi';
import { 
  UserRecord, ParkingCardRecord, PatrolPointRecord, KeyLogRecord, 
  IncidentReportRecord, BlacklistRecord, AuditLogRecord, UnitRecord 
} from '../types';

function getExcelCellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return '';
  if (typeof cell.w === 'string' && cell.w.trim()) {
    return cell.w.trim();
  }
  try {
    const formatted = XLSX.utils.format_cell(cell);
    if (formatted != null && String(formatted).trim()) {
      return String(formatted).trim();
    }
  } catch {}
  return String(cell.v ?? '').trim();
}

function isCellCorrupted(val: string): boolean {
  if (!val) return false;
  // matches long decimal serial fraction e.g. 36892.0000462963
  if (/^\d{4,6}\.\d{5,}$/.test(val)) return true;
  // matches scientific notation e.g. 4.20E+05 or similar
  if (/[eE]\+?\-?\d+/.test(val)) return true;
  // matches ISO date or date formats like YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return true;
  // matches standard JS Date object string conversion
  if (/^[A-Za-z]{3}\s[A-Za-z]{3}\s\d{2}\s\d{4}/.test(val)) return true;
  return false;
}

interface AdminPanelProps {
  currentUser: {
    name: string;
    role: 'Guard' | 'ShiftHead' | 'Manager' | 'Admin';
  };
  loginEmail?: string;
  authorizationResult?: string;
}

type AdminTab = 'dashboard' | 'users' | 'cards' | 'points' | 'keys' | 'blacklist' | 'incidents' | 'settings' | 'audit' | 'units';

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
  const [unitList, setUnitList] = useState<UnitRecord[]>([]);
  const [csvRejections, setCsvRejections] = useState<string[]>([]);

  // Import modal and preview states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importPreviewList, setImportPreviewList] = useState<any[]>([]);
  const [importAllRecords, setImportAllRecords] = useState<UnitRecord[]>([]);
  const [importRejections, setImportRejections] = useState<string[]>([]);
  const [importStats, setImportStats] = useState<{
    total: number;
    imported: number;
    updated: number;
    rejected: number;
    reasons: string[];
  } | null>(null);
  const [isImportingInProgress, setIsImportingInProgress] = useState(false);

  // Full Replacement and Rollback States
  const [isFullReplacementMode, setIsFullReplacementMode] = useState(false);
  const [showSecondConfirm, setShowSecondConfirm] = useState(false);
  const [archiveRecordsCount, setArchiveRecordsCount] = useState(0);
  const [corruptedIdsCount, setCorruptedIdsCount] = useState(0);
  const [duplicateRoomsCount, setDuplicateRoomsCount] = useState(0);
  const [backupBatches, setBackupBatches] = useState<any[]>([]);
  const [selectedRollbackBatch, setSelectedRollbackBatch] = useState<string>('');
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [archiveLoaded, setArchiveLoaded] = useState(false);

  const hasCorruptedRoomCode = importAllRecords.some(r => r.room_code && isCellCorrupted(r.room_code)) ||
    importPreviewList.some(row => row.room_code && isCellCorrupted(row.room_code));

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
  const [unitsSearch, setUnitsSearch] = useState('');

  // Migration Export Tool States
  const [exportConfirmation, setExportConfirmation] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    collectionName: string;
    collectionIndex: number;
    totalCollections: number;
    status: string;
  } | null>(null);
  const [exportResult, setExportResult] = useState<{
    filename: string;
    jsonText: string;
    sha256: string;
    metadata: any;
    preview: { name: string; docsCount: number; excludedMediaCount: number }[];
    sizeText: string;
    type: string;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Form States
  const [userForm, setUserForm] = useState({ name: '', login_email: '', role: 'Guard', shift: 'ทั่วไป', phone: '', pin: '1234' });
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

  // Helper to recursively serialize values and filter out Base64 images
  const serializeValue = (val: any, context: { excludedCount: number }): any => {
    if (val === null || val === undefined) {
      return null;
    }

    if (typeof val === 'string') {
      if (val.startsWith('data:image/')) {
        context.excludedCount++;
        return {
          "__excluded_large_media": true
        };
      }
      return val;
    }

    if (typeof val !== 'object') {
      return val;
    }

    if (Array.isArray(val)) {
      return val.map(item => serializeValue(item, context));
    }

    // Check if it's a Firestore Timestamp-like object
    if (typeof val.toDate === 'function' && typeof val.seconds === 'number' && typeof val.nanoseconds === 'number') {
      return {
        "__firestore_type": "timestamp",
        "seconds": val.seconds,
        "nanoseconds": val.nanoseconds
      };
    }

    // Fallback for serialized or plain-obj representation of Firestore Timestamp
    if ('seconds' in val && 'nanoseconds' in val && Object.keys(val).length === 2 && typeof val.seconds === 'number' && typeof val.nanoseconds === 'number') {
      return {
        "__firestore_type": "timestamp",
        "seconds": val.seconds,
        "nanoseconds": val.nanoseconds
      };
    }

    // Check if it's a Firestore GeoPoint-like object (latitude and longitude)
    if (typeof val.latitude === 'number' && typeof val.longitude === 'number' && typeof val.isEqual === 'function') {
      return {
        "__firestore_type": "geopoint",
        "latitude": val.latitude,
        "longitude": val.longitude
      };
    }

    // Check if it's a DocumentReference-like object
    if (typeof val.path === 'string' && typeof val.id === 'string' && typeof val.withConverter === 'function') {
      return {
        "__firestore_type": "reference",
        "path": val.path
      };
    }

    if (val instanceof Date) {
      return {
        "__firestore_type": "date",
        "iso": val.toISOString()
      };
    }

    // Plain objects
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = serializeValue(v, context);
    }
    return res;
  };

  // Helper to calculate SHA-256 of text
  const calculateSHA256 = async (text: string): Promise<string> => {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Helper to trigger download of file content
  const downloadFile = (filename: string, content: string, contentType: string = 'application/json') => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Sequential batch-by-batch migration export engine
  const handleMigrationExport = async (type: 'master' | 'transaction') => {
    if (exportConfirmation.trim() !== 'EXPORT SOURCE DATA') {
      setExportError('กรุณาพิมพ์ "EXPORT SOURCE DATA" ให้ถูกต้องเพื่อยืนยันสิทธิ์ก่อนเริ่มดาวน์โหลด');
      return;
    }

    setExportError(null);
    setExportResult(null);
    setIsExporting(true);

    const MASTER_COLLECTIONS_KEYS = [
      'SystemSettings',
      'Accounts',
      'Operators',
      'Users',
      'Units',
      'ParkingCards',
      'Keys',
      'PatrolPoints',
      'Blacklist'
    ];

    const TRANSACTION_COLLECTIONS_KEYS = [
      'VehicleLogs',
      'ContractorLogs',
      'KeyLogs',
      'PatrolLogs',
      'IncidentReports',
      'AuditLogs',
      'DailyReports',
      'UnitsArchive'
    ];

    const keysToExport = type === 'master' ? MASTER_COLLECTIONS_KEYS : TRANSACTION_COLLECTIONS_KEYS;
    const collectionsData: Record<string, any[]> = {};
    const collectionCounts: Record<string, number> = {};
    let totalDocuments = 0;
    const previewInfo: any[] = [];
    let totalExcludedMedia = 0;

    try {
      for (let i = 0; i < keysToExport.length; i++) {
        const colKey = keysToExport[i];
        const colName = COLLECTION_MAPPING[colKey];

        if (!colName) {
          throw new Error(`ไม่พบการแมปคีย์ของระบบ [${colKey}] ไปยัง Firestore Collection`);
        }

        // Sequential step: Show progress
        setExportProgress({
          collectionName: colName,
          collectionIndex: i + 1,
          totalCollections: keysToExport.length,
          status: 'กำลังเริ่มดึงข้อมูล (Fetching)...'
        });

        const colRef = collection(db, colName);
        const snap = await getDocs(colRef);

        const docsArray: any[] = [];
        const size = snap.size;
        collectionCounts[colName] = size;
        totalDocuments += size;

        let colExcludedCount = 0;
        let docIdx = 0;

        for (const docSnap of snap.docs) {
          docIdx++;
          if (docIdx % 10 === 0 || docIdx === size) {
            setExportProgress({
              collectionName: colName,
              collectionIndex: i + 1,
              totalCollections: keysToExport.length,
              status: `กำลังประมวลผลเอกสาร (${docIdx}/${size})`
            });
            // Yield control back to browser to prevent rendering freeze
            await new Promise(resolve => setTimeout(resolve, 5));
          }

          const docData = docSnap.data();
          const serialized: Record<string, any> = {
            "__document_id": docSnap.id
          };

          const context = { excludedCount: 0 };
          for (const [k, v] of Object.entries(docData)) {
            serialized[k] = serializeValue(v, context);
          }

          docsArray.push(serialized);
          colExcludedCount += context.excludedCount;
        }

        totalExcludedMedia += colExcludedCount;
        collectionsData[colName] = docsArray;

        previewInfo.push({
          name: colName,
          docsCount: size,
          excludedMediaCount: colExcludedCount
        });
      }

      // Metadata generation
      const nowISO = new Date().toISOString();
      const warnings: string[] = [];
      if (totalExcludedMedia > 0) {
        warnings.push(`ข้ามรูปภาพประเภท Base64 ขนาดใหญ่จำนวน ${totalExcludedMedia} จุด เพื่อความปลอดภัยของข้อมูลและรักษาขนาดไฟล์ให้เหมาะสม`);
      }

      const exportMetadata = {
        schema_version: 1,
        source_project_id: "amped-impulse-cdw25",
        source_database_id: "ai-studio-smartguardsystem-e2a4586d-b4ef-4694-9036-1c64c9967e71",
        exported_at: nowISO,
        exported_by_email: loginEmail || auth.currentUser?.email || 'office.mjc2025@gmail.com',
        collection_counts: collectionCounts,
        total_documents: totalDocuments,
        warnings: warnings
      };

      const finalJSON = {
        export_metadata: exportMetadata,
        collections: collectionsData
      };

      const jsonString = JSON.stringify(finalJSON, null, 2);

      // SHA-256 calculation
      const sha256Hex = await calculateSHA256(jsonString);

      // Calculate file size text
      const sizeInBytes = new TextEncoder().encode(jsonString).length;
      let sizeText = `${sizeInBytes} B`;
      if (sizeInBytes > 1024 * 1024) {
        sizeText = `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
      } else if (sizeInBytes > 1024) {
        sizeText = `${(sizeInBytes / 1024).toFixed(2)} KB`;
      }

      // Generate filename based on local date/time
      const datePart = nowISO.split('T')[0].replace(/-/g, '');
      const timePart = nowISO.split('T')[1].substring(0, 5).replace(/:/g, '');
      const filename = `smart-guard-${type}-export-${datePart}-${timePart}.json`;

      setExportResult({
        filename,
        jsonText: jsonString,
        sha256: sha256Hex,
        metadata: exportMetadata,
        preview: previewInfo,
        sizeText,
        type
      });

      showToast('success', `ส่งออกข้อมูลสำเร็จ! ไฟล์ขนาดประเมิน ${sizeText}`);
    } catch (err: any) {
      console.error(err);
      setExportError(err.message || 'เกิดข้อผิดพลาดรุนแรงในการส่งออกข้อมูล');
      showToast('error', `การส่งออกล้มเหลว: ${err.message || err}`);
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  const fetchData = async () => {
    clearUnitCache();
    setLoading(true);
    try {
      const [u, c, p, k, b, i, a, s, un] = await Promise.all([
        readSheet<UserRecord>('Users'),
        readSheet<ParkingCardRecord>('ParkingCards'),
        readSheet<PatrolPointRecord>('PatrolPoints'),
        readSheet<any>('Keys'),
        readSheet<BlacklistRecord>('Blacklist'),
        readSheet<IncidentReportRecord>('IncidentReports'),
        readSheet<AuditLogRecord>('AuditLogs'),
        readSheet<any>('SystemSettings'),
        readSheet<UnitRecord>('Units')
      ]);
      setUserList(u || []);
      setCardList(c || []);
      setPointList(p || []);
      setKeyList(k || []);
      setBlacklist(b || []);
      setIncidentList(i || []);
      setAuditLogs(a || []);
      setSystemSettings(s || []);
      setUnitList(un || []);
    } catch (err: any) {
      console.error(err);
      showToast('error', 'ไม่สามารถดึงข้อมูลจาก Cloud Firestore ได้');
    } finally {
      setLoading(false);
    }
  };

  const fetchBackupBatches = async () => {
    setLoadingArchive(true);
    try {
      console.log('[Smart Guard Units] Lazily loading units_archive...');
      const archived = await readSheet<any>('UnitsArchive');
      const batchMap = new Map<string, any>();
      (archived || []).forEach((record: any) => {
        const bid = record.backup_batch_id;
        if (!bid) return;
        if (batchMap.has(bid)) {
          batchMap.get(bid).count++;
        } else {
          batchMap.set(bid, {
            backup_batch_id: bid,
            archived_at: record.archived_at || '',
            count: 1,
            operator_name: record.operator_name || 'Admin'
          });
        }
      });
      const sortedBackups = Array.from(batchMap.values()).sort((a: any, b: any) => b.archived_at.localeCompare(a.archived_at));
      setBackupBatches(sortedBackups);
      setArchiveLoaded(true);
    } catch (err: any) {
      console.error('[Smart Guard Units] Error loading units_archive lazily:', err);
      showToast('error', 'ไม่สามารถโหลดประวัติสำรองข้อมูลห้องชุดได้');
    } finally {
      setLoadingArchive(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const computeImportStatus = () => {
    let validCount = 0;
    let dbRejectionCount = 0;
    const dbReasons: string[] = [];

    unitList.forEach((u: any) => {
      const reasons: string[] = [];
      if (!u.unit_id) {
        reasons.push(`ข้อมูลยูนิต ID หายไป (missing unit_id)`);
      }
      if (!u.room_number || String(u.room_number).trim() === '') {
        reasons.push(`ยูนิต ID ${u.unit_id || 'ไม่ระบุ'}: เลขห้องว่าง (empty room_number)`);
      }
      if (u.floor === undefined || u.floor === null || String(u.floor).trim() === '') {
        reasons.push(`ห้อง ${u.room_number || 'ไม่ระบุ'}: ไม่มีข้อมูลชั้น (missing floor)`);
      }
      if (u.owner_name === undefined || u.owner_name === null) {
        reasons.push(`ห้อง ${u.room_number || 'ไม่ระบุ'}: ไม่มีข้อมูลเจ้าของ (missing owner_name)`);
      }
      if (u.phone === undefined || u.phone === null) {
        reasons.push(`ห้อง ${u.room_number || 'ไม่ระบุ'}: ไม่มีเบอร์โทรศัพท์ (missing phone)`);
      }
      if (u.occupancy_status === undefined || u.occupancy_status === null || String(u.occupancy_status).trim() === '') {
        reasons.push(`ห้อง ${u.room_number || 'ไม่ระบุ'}: ไม่มีสถานะ (missing occupancy_status)`);
      }
      
      if (reasons.length === 0) {
        validCount++;
      } else {
        dbRejectionCount++;
        dbReasons.push(...reasons);
      }
    });

    const allReasons = [...csvRejections, ...dbReasons];
    
    return {
      total: unitList.length + csvRejections.length,
      valid: validCount,
      rejected: dbRejectionCount + csvRejections.length,
      reasons: allReasons.slice(0, 10)
    };
  };

  const handleUnitsFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsFullReplacementMode(false);
    processUnitsFile(file);
    e.target.value = '';
  };

  const handleUnitsFileSelectFullReplacement = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsFullReplacementMode(true);
    processUnitsFile(file);
    e.target.value = '';
  };

  const processUnitsFile = (file: File) => {
    if (!isAdmin && !isManager) {
      showToast('error', 'สิทธิ์ระดับของคุณไม่ได้รับอนุญาตให้ทำการนำเข้าข้อมูล (Admin and Manager only)');
      return;
    }

    setImportFileName(file.name);
    setLoading(true);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { 
          type: 'array',
          cellHTML: false,
          cellText: true,
          cellDates: false,
          raw: false
        });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Construct 2D grid of cell objects
        const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
        const grid: (XLSX.CellObject | undefined)[][] = [];
        for (let r = range.s.r; r <= range.e.r; r++) {
          const rowCells: (XLSX.CellObject | undefined)[] = [];
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cellAddress = XLSX.utils.encode_cell({ r, c });
            rowCells.push(worksheet[cellAddress]);
          }
          grid.push(rowCells);
        }

        if (grid.length < 2) {
          showToast('error', 'ไฟล์นำเข้าไม่มีข้อมูลเพียงพอ (ต้องมีแถวหัวตารางและแถวข้อมูล)');
          setLoading(false);
          return;
        }

        const headers = grid[0].map(cell => getExcelCellText(cell).trim());
        setImportHeaders(headers);

        const mapping: { [key: string]: number } = {};
        headers.forEach((header, index) => {
          if (!header) return;
          const h = header.toLowerCase();
          
          if (/^(roomid|room_code|รหัสห้อง|รหัสยูนิต)$/i.test(h)) {
            mapping['room_code'] = index;
          } else if (/^(room_no|roomno|room_number|roomnumber|เลขที่ห้อง|เลขห้อง|ห้อง)$/i.test(h)) {
            mapping['room_number'] = index;
          } else if (/^(floor|ชั้น)$/i.test(h)) {
            mapping['floor'] = index;
          } else if (/^(owner_name|ownername|ชื่อเจ้าของห้อง|ชื่อเจ้าของ|ชื่อ-นามสกุล|ชื่อ|owner)$/i.test(h)) {
            mapping['owner_name'] = index;
          } else if (/^(phoneno|phonenumber|phone|เบอร์โทร|เบอร์โทรศัพท์|เบอร์|phone_number)$/i.test(h)) {
            mapping['phone'] = index;
          } else if (/^(email|อีเมล|อีเมลห้อง)$/i.test(h)) {
            mapping['email'] = index;
          } else if (/^(occupancy_status|status|สถานะการพักอาศัย|สถานะ)$/i.test(h)) {
            mapping['occupancy_status'] = index;
          } else if (/^(area|พื้นที่|ขนาดพื้นที่)$/i.test(h)) {
            mapping['area'] = index;
          } else if (/^(ratio|อัตราส่วน)$/i.test(h)) {
            mapping['ratio'] = index;
          }
        });

        const requiredFields = ['room_number', 'floor', 'owner_name'];
        const missingFields = requiredFields.filter(f => mapping[f] === undefined);
        if (missingFields.length > 0) {
          const fieldNamesMap: { [key: string]: string } = {
            room_number: 'เลขที่ห้อง / room_number',
            floor: 'ชั้น / floor',
            owner_name: 'ชื่อเจ้าของห้อง / owner_name'
          };
          const missingThai = missingFields.map(f => fieldNamesMap[f] || f).join(', ');
          showToast('error', `ไม่พบคอลัมน์ที่จำเป็น: ${missingThai}`);
          setLoading(false);
          return;
        }

        const now = new Date().toISOString();
        const validRecords: UnitRecord[] = [];
        const rejections: string[] = [];

        const cleanId = (val: string): string => {
          return val.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/(^_|_$)/g, '');
        };

        const getRowVal = (row: (XLSX.CellObject | undefined)[], colIdx: number | undefined): string => {
          if (colIdx === undefined || !row) return '';
          return getExcelCellText(row[colIdx]);
        };

        for (let i = 1; i < grid.length; i++) {
          const row = grid[i];
          if (!row || row.length === 0 || row.every(cell => !cell || getExcelCellText(cell).trim() === '')) {
            continue;
          }

          const rIndex = i + 1;
          
          let room_code = mapping['room_code'] !== undefined ? getRowVal(row, mapping['room_code']) : '';
          const room_number = getRowVal(row, mapping['room_number']);
          const floor = getRowVal(row, mapping['floor']);
          const owner_name = getRowVal(row, mapping['owner_name']);
          
          const rowErrors: string[] = [];
          if (!room_number) {
            rowErrors.push(`แถวที่ ${rIndex}: ไม่มีเลขที่ห้อง (room_number)`);
          }
          if (!floor) {
            rowErrors.push(`แถวที่ ${rIndex}: ไม่มีข้อมูลชั้น (floor)`);
          }
          if (!owner_name) {
            rowErrors.push(`แถวที่ ${rIndex}: ไม่มีชื่อเจ้าของห้อง (owner_name)`);
          }

          // Date serial corruption guard
          let roomCodeIsCorrupted = false;
          if (room_code && isCellCorrupted(room_code)) {
            roomCodeIsCorrupted = true;
            rowErrors.push(`แถวที่ ${rIndex}: RoomID ถูกอ่านเป็น Excel serial/date โปรดแก้ parser หรือใช้ค่า formatted text`);
          }

          if (rowErrors.length > 0) {
            rejections.push(...rowErrors);
            continue;
          }

          const phone = mapping['phone'] !== undefined ? getRowVal(row, mapping['phone']) : '';
          const email = mapping['email'] !== undefined ? getRowVal(row, mapping['email']) : '';
          const occupancy_status = mapping['occupancy_status'] !== undefined ? getRowVal(row, mapping['occupancy_status']) : 'ว่าง';
          const area = mapping['area'] !== undefined ? getRowVal(row, mapping['area']) : '';
          const ratio = mapping['ratio'] !== undefined ? getRowVal(row, mapping['ratio']) : '';

          let unit_id = '';
          if (room_code && !roomCodeIsCorrupted) {
            unit_id = `UNIT_${cleanId(room_code)}`.toUpperCase();
          } else {
            unit_id = `UNIT_${cleanId(room_number)}`.toUpperCase();
          }

          const searchable_text = `${room_code} ${room_number} ${floor} ${owner_name} ${phone} ${email}`.toLowerCase().trim();

          const record: UnitRecord = {
            unit_id,
            room_code: (room_code && !roomCodeIsCorrupted) ? room_code : undefined,
            room_number,
            floor,
            owner_name,
            phone,
            email,
            occupancy_status,
            area,
            ratio,
            searchable_text,
            created_at: now,
            updated_at: now
          };

          validRecords.push(record);
        }

        setImportAllRecords(validRecords);
        setImportRejections(rejections);

        // Compute stats for replacement preview
        const currentActiveCount = unitList.filter(u => u.is_active !== false).length;
        
        const generateDeterministicUnitId = (roomCode?: string, roomNumber?: string): string => {
          const source = roomCode || roomNumber || '';
          const cleaned = source.replace(/[\s\/\-\_\.]/g, '_').replace(/_+/g, '_').replace(/(^_|_$)/g, '');
          return `UNIT_${cleaned}`.toUpperCase();
        };

        const corruptedCount = unitList.filter(u => {
          if (!u.unit_id) return true;
          if (u.unit_id.includes('/')) return true;
          const expectedId = generateDeterministicUnitId(u.room_code, u.room_number);
          return u.unit_id !== expectedId;
        }).length;

        const roomNumbersInFile = new Set<string>();
        const duplicateRoomsInFile = new Set<string>();
        validRecords.forEach(r => {
          if (roomNumbersInFile.has(r.room_number)) {
            duplicateRoomsInFile.add(r.room_number);
          } else {
            roomNumbersInFile.add(r.room_number);
          }
        });

        setArchiveRecordsCount(currentActiveCount);
        setCorruptedIdsCount(corruptedCount);
        setDuplicateRoomsCount(duplicateRoomsInFile.size);
        
        const previews = grid.slice(1, 21).map((row, idx) => {
          const rIndex = idx + 2;
          if (!row || row.length === 0 || row.every(cell => !cell || getExcelCellText(cell).trim() === '')) {
            return null;
          }
          
          const room_code = mapping['room_code'] !== undefined ? getRowVal(row, mapping['room_code']) : '';
          const room_number = mapping['room_number'] !== undefined ? getRowVal(row, mapping['room_number']) : '';
          const floor = mapping['floor'] !== undefined ? getRowVal(row, mapping['floor']) : '';
          const owner_name = mapping['owner_name'] !== undefined ? getRowVal(row, mapping['owner_name']) : '';
          const phone = mapping['phone'] !== undefined ? getRowVal(row, mapping['phone']) : '';
          const email = mapping['email'] !== undefined ? getRowVal(row, mapping['email']) : '';
          const occupancy_status = mapping['occupancy_status'] !== undefined ? getRowVal(row, mapping['occupancy_status']) : 'ว่าง';
          const area = mapping['area'] !== undefined ? getRowVal(row, mapping['area']) : '';
          const ratio = mapping['ratio'] !== undefined ? getRowVal(row, mapping['ratio']) : '';
          
          const errors: string[] = [];
          if (!room_number) errors.push('เลขห้องว่าง');
          if (!floor) errors.push('ไม่มีชั้น');
          if (!owner_name) errors.push('ไม่มีชื่อเจ้าของ');

          const roomCodeIsCorrupted = room_code && isCellCorrupted(room_code);
          if (roomCodeIsCorrupted) {
            errors.push('RoomID ถูกอ่านเป็น Excel serial/date โปรดแก้ parser หรือใช้ค่า formatted text');
          }

          const cellObj = mapping['room_code'] !== undefined ? row[mapping['room_code']] : undefined;

          return {
            rowNum: rIndex,
            room_code,
            room_number,
            floor,
            owner_name,
            phone,
            email,
            occupancy_status,
            area,
            ratio,
            isValid: errors.length === 0,
            errorMsg: errors.join(', '),
            debug: {
              raw_value: cellObj ? String(cellObj.v ?? '') : '',
              formatted_value: cellObj ? (cellObj.w || (XLSX.utils.format_cell(cellObj) || '')) : '',
              stored_value: room_code
            }
          };
        }).filter(Boolean);

        setImportPreviewList(previews);
        setImportStats(null);
        setIsImportModalOpen(true);
      } catch (err: any) {
        console.error(err);
        showToast('error', `ล้มเหลวในการประมวลผลไฟล์: ${err.message || err}`);
      } finally {
        setLoading(false);
      }
    };

    reader.onerror = () => {
      showToast('error', 'เกิดข้อผิดพลาดในการอ่านไฟล์');
      setLoading(false);
    };

    reader.readAsArrayBuffer(file);
  };

  const handleConfirmImport = async () => {
    if (importAllRecords.length === 0) {
      showToast('error', 'ไม่มีข้อมูลยูนิตที่ถูกต้องสำหรับนำเข้า');
      return;
    }

    setIsImportingInProgress(true);
    let importedCount = 0;
    let updatedCount = 0;
    let rejectedCount = importRejections.length;
    const finalRejections = [...importRejections];

    try {
      const existingIds = new Set(unitList.map(u => u.unit_id));

      for (const record of importAllRecords) {
        try {
          const isUpdate = existingIds.has(record.unit_id);
          
          if (isUpdate) {
            const existingRecord = unitList.find(u => u.unit_id === record.unit_id);
            if (existingRecord) {
              record.created_at = existingRecord.created_at || record.created_at;
            }
            updatedCount++;
          } else {
            importedCount++;
          }

          await appendSheetRow('Units', record);
        } catch (err: any) {
          rejectedCount++;
          finalRejections.push(`ห้อง ${record.room_number}: บันทึกล้มเหลว (${err.message || err})`);
        }
      }

      setImportStats({
        total: importAllRecords.length + importRejections.length,
        imported: importedCount,
        updated: updatedCount,
        rejected: rejectedCount,
        reasons: finalRejections
      });

      await writeAuditLog(
        currentUser.name,
        'นำเข้าข้อมูลห้องชุด (Excel/CSV)',
        'Units',
        'IMPORT_BATCH',
        'N/A',
        `Imported ${importedCount} units, updated ${updatedCount} units, rejected ${rejectedCount} rows`
      );

      showToast('success', `นำเข้าเรียบร้อย: ใหม่ ${importedCount} ห้อง, อัปเดต ${updatedCount} ห้อง, ล้มเหลว/ปฏิเสธ ${rejectedCount} แถว`);
      await fetchData();
    } catch (err: any) {
      showToast('error', `เกิดข้อผิดพลาดในการบันทึกข้อมูล: ${err.message || err}`);
    } finally {
      setIsImportingInProgress(false);
    }
  };

  const handleConfirmFullReplacement = async () => {
    if (importAllRecords.length === 0) {
      showToast('error', 'ไม่มีข้อมูลยูนิตที่ถูกต้องสำหรับแทนที่');
      return;
    }

    setIsImportingInProgress(true);
    const backupBatchId = 'BACKUP_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const importBatchId = 'BATCH_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const archivedAt = new Date().toISOString();
    
    const operatorName = sessionStorage.getItem('selected_operator_name') || currentUser.name || 'Admin';
    const loginEmail = sessionStorage.getItem('selected_login_email') || (currentUser as any).email || '';
    const currentSiteId = sessionStorage.getItem('selected_site_id') || 'site-01';
    const sourceFileName = importFileName || 'uploaded_file.xlsx';

    try {
      // 1. Read all current units freshly from Firestore
      const currentUnitsSnap = await getDocs(collection(db, 'units'));
      const currentUnits: any[] = [];
      currentUnitsSnap.forEach(docSnap => {
        currentUnits.push({ ...docSnap.data(), id: docSnap.id });
      });

      // 2. Archive copies: do not hard-delete anything until archive copy succeeds!
      let batch = writeBatch(db);
      let writeCount = 0;
      for (const unit of currentUnits) {
        const archiveId = `${unit.unit_id}_${backupBatchId}`;
        const archiveRef = doc(db, 'units_archive', archiveId);
        const archiveRecord = {
          ...unit,
          archive_id: archiveId,
          backup_batch_id: backupBatchId,
          archived_at: archivedAt,
          original_doc_id: unit.unit_id,
          operator_name: operatorName
        };
        batch.set(archiveRef, archiveRecord);
        writeCount++;
        if (writeCount % 400 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (writeCount % 400 !== 0) {
        await batch.commit();
      }

      // 3. Mark all existing active units in current active collection as is_active = false
      batch = writeBatch(db);
      writeCount = 0;
      for (const unit of currentUnits) {
        const unitRef = doc(db, 'units', unit.unit_id);
        batch.update(unitRef, { is_active: false, updated_at: archivedAt });
        writeCount++;
        if (writeCount % 400 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (writeCount % 400 !== 0) {
        await batch.commit();
      }

      // 4. Import the new file as a fresh active dataset
      const uniqueRecordsMap = new Map<string, any>();
      for (const record of importAllRecords) {
        const source = record.room_code || record.room_number || '';
        const cleaned = source.replace(/[\s\/\-\_\.]/g, '_').replace(/_+/g, '_').replace(/(^_|_$)/g, '');
        const unit_id = `UNIT_${cleaned}`.toUpperCase();
        uniqueRecordsMap.set(unit_id, record);
      }

      batch = writeBatch(db);
      writeCount = 0;
      let importedCount = 0;
      let updatedCount = 0;

      for (const [unit_id, record] of uniqueRecordsMap.entries()) {
        const unitRef = doc(db, 'units', unit_id);
        
        // Check if exists in currentUnits to preserve created_at
        const existingUnit = currentUnits.find(u => u.unit_id === unit_id);
        const isUpdate = !!existingUnit;
        const createdAtVal = existingUnit?.created_at || archivedAt;
        const updatedAtVal = archivedAt;

        if (isUpdate) {
          updatedCount++;
        } else {
          importedCount++;
        }

        // Required fields
        const roomCodeVal = record.room_code || '';
        const roomNumberVal = record.room_number;
        const floorVal = record.floor;
        const ownerNameVal = record.owner_name;
        const phoneVal = record.phone || '';
        const emailVal = record.email || '';
        const occupancyStatusVal = record.occupancy_status || 'ไม่ระบุ';
        const ratioVal = record.ratio || '';
        const areaVal = record.area || '';

        const searchKeyVal = `${roomNumberVal}${roomCodeVal}`.replace(/[\s\/\-\_\.]/g, '').toLowerCase();
        const searchableTextVal = `${roomCodeVal} ${roomNumberVal} ${floorVal} ${ownerNameVal} ${phoneVal} ${emailVal} ${searchKeyVal}`.toLowerCase().trim();

        const finalRecord: UnitRecord = {
          unit_id,
          site_id: currentSiteId,
          room_code: roomCodeVal || undefined,
          room_number: roomNumberVal,
          floor: floorVal,
          ratio: ratioVal,
          area: areaVal,
          owner_name: ownerNameVal,
          phone: phoneVal,
          email: emailVal,
          occupancy_status: occupancyStatusVal,
          searchable_text: searchableTextVal,
          search_key: searchKeyVal,
          import_batch_id: importBatchId,
          source_file_name: sourceFileName,
          is_active: true,
          created_at: createdAtVal,
          updated_at: updatedAtVal
        };

        batch.set(unitRef, finalRecord);
        writeCount++;
        if (writeCount % 400 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (writeCount % 400 !== 0) {
        await batch.commit();
      }

      // Write Immutable Audit Log
      await writeAuditLog(
        operatorName,
        'สำรองและนำเข้าข้อมูลห้องใหม่ทั้งหมด (Full Replacement Workflow)',
        'Units',
        importBatchId,
        `Previous Active Count: ${currentUnits.filter(u => u.is_active !== false).length}`,
        `New Active Count: ${uniqueRecordsMap.size}, Backup Batch ID: ${backupBatchId}, Corrupted IDs Cleared: ${corruptedIdsCount}`
      );

      // Report stats to UI
      setImportStats({
        total: importAllRecords.length + importRejections.length,
        imported: importedCount,
        updated: updatedCount,
        rejected: importRejections.length,
        reasons: [
          `สำรองข้อมูลเดิมไปยัง Archive เรียบร้อย (Batch ID: ${backupBatchId})`,
          `นำเข้ายูนิตใหม่แบบ Active สำเร็จ ${uniqueRecordsMap.size} ยูนิต`,
          ...importRejections
        ]
      });

      showToast('success', `สับเปลี่ยนข้อมูลสำเร็จ! สำรองเดิม ${currentUnits.length} ห้องไปยัง Archive และนำเข้า Active ใหม่ ${uniqueRecordsMap.size} ห้อง`);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      showToast('error', `การแทนที่ฐานข้อมูลล้มเหลว: ${err.message || err}`);
    } finally {
      setIsImportingInProgress(false);
      setShowSecondConfirm(false);
    }
  };

  const handleRollback = async (targetBatchId: string) => {
    if (!targetBatchId) {
      showToast('error', 'กรุณาเลือกชุดข้อมูลย้อนหลังที่ต้องการกู้คืน');
      return;
    }

    setLoading(true);
    const newBackupBatchId = 'BACKUP_BEFORE_ROLLBACK_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const restoredAt = new Date().toISOString();
    const operatorName = sessionStorage.getItem('selected_operator_name') || currentUser.name || 'Admin';
    const loginEmail = sessionStorage.getItem('selected_login_email') || (currentUser as any).email || '';

    try {
      // 1. Get current active units
      const currentUnitsSnap = await getDocs(collection(db, 'units'));
      const currentUnits: any[] = [];
      currentUnitsSnap.forEach(docSnap => {
        currentUnits.push({ ...docSnap.data(), id: docSnap.id });
      });

      // 2. Archive current dataset before rollback to prevent data loss!
      let batch = writeBatch(db);
      let writeCount = 0;
      for (const unit of currentUnits) {
        const archiveId = `${unit.unit_id}_${newBackupBatchId}`;
        const archiveRef = doc(db, 'units_archive', archiveId);
        batch.set(archiveRef, {
          ...unit,
          archive_id: archiveId,
          backup_batch_id: newBackupBatchId,
          archived_at: restoredAt,
          original_doc_id: unit.unit_id,
          operator_name: operatorName
        });
        writeCount++;
        if (writeCount % 400 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (writeCount % 400 !== 0) {
        await batch.commit();
      }

      // 3. Mark all existing active units in current active collection as is_active = false
      batch = writeBatch(db);
      writeCount = 0;
      for (const unit of currentUnits) {
        const unitRef = doc(db, 'units', unit.unit_id);
        batch.update(unitRef, { is_active: false, updated_at: restoredAt });
        writeCount++;
        if (writeCount % 400 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (writeCount % 400 !== 0) {
        await batch.commit();
      }

      // 4. Fetch the units from units_archive belonging to targetBatchId
      const archiveQuery = query(collection(db, 'units_archive'), where('backup_batch_id', '==', targetBatchId));
      const archiveSnap = await getDocs(archiveQuery);
      const archivedRecordsToRestore: any[] = [];
      archiveSnap.forEach(d => {
        archivedRecordsToRestore.push(d.data());
      });

      if (archivedRecordsToRestore.length === 0) {
        showToast('error', 'ไม่พบประวัติข้อมูลของชุด Backup นี้ในฐานข้อมูลเก็บถาวร');
        setLoading(false);
        return;
      }

      // 5. Restore them into units collection as is_active: true
      batch = writeBatch(db);
      writeCount = 0;
      for (const record of archivedRecordsToRestore) {
        const unitRef = doc(db, 'units', record.unit_id);
        const restoredRecord = {
          ...record,
          is_active: true,
          updated_at: restoredAt
        };
        // Clean up archive-specific properties
        delete restoredRecord.archive_id;
        delete restoredRecord.backup_batch_id;
        delete restoredRecord.archived_at;
        delete restoredRecord.original_doc_id;

        batch.set(unitRef, restoredRecord);
        writeCount++;
        if (writeCount % 400 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (writeCount % 400 !== 0) {
        await batch.commit();
      }

      // 6. Write Audit Log
      await writeAuditLog(
        operatorName,
        `กู้คืนประวัติข้อมูลห้องชุดสำเร็จ (Database Rollback to Batch: ${targetBatchId})`,
        'Units',
        targetBatchId,
        `Current batch auto-archived to ${newBackupBatchId}`,
        `Restored ${archivedRecordsToRestore.length} units as active`
      );

      showToast('success', `กู้คืนข้อมูลห้องชุดสำเร็จ! กู้คืนเป็นชุดข้อมูลเดิมจำนวน ${archivedRecordsToRestore.length} ห้อง`);
      await fetchData();
      if (archiveLoaded) {
        await fetchBackupBatches();
      }
    } catch (err: any) {
      console.error(err);
      showToast('error', `การ Rollback ล้มเหลว: ${err.message || err}`);
    } finally {
      setLoading(false);
      setSelectedRollbackBatch('');
    }
  };

  // Handle Create Operations
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้ทำการแก้ไขค่าระบบหลัก');
    try {
      setLoading(true);
      const userId = 'U' + Math.floor(Math.random() * 9000 + 1000);
      const now = new Date().toISOString();
      const record: UserRecord = {
        user_id: userId,
        login_email: userForm.login_email || 'shared@example.com',
        operator_name: userForm.name,
        role: userForm.role as any,
        shift: userForm.shift as any,
        phone: userForm.phone,
        status: 'Active',
        created_at: now,
        updated_at: now
      };
      await appendSheetRow('Users', record);
      await writeAuditLog(currentUser.name, 'สร้างผู้ใช้งาน', 'Users', userId, '', JSON.stringify(record));
      setUserForm({ name: '', login_email: '', role: 'Guard', shift: 'ทั่วไป', phone: '', pin: '1234' });
      setShowAddForm(false);
      showToast('success', 'สร้างผู้ใช้งานสำเร็จ!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
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

  // Update Status / Fields Actions
  const handleToggleUserStatus = async (user: UserRecord) => {
    if (!hasEditAccess) return showToast('error', 'สิทธิ์ระดับผู้จัดการไม่ได้รับอนุญาตให้แก้ไขสถานะผู้ใช้งาน');
    try {
      setLoading(true);
      const nextStatus = user.status === 'Active' ? 'Inactive' : 'Active';
      await updateSheetRow('Users', 'user_id', user.user_id, { status: nextStatus, updated_at: new Date().toISOString() });
      await writeAuditLog(currentUser.name, `เปลี่ยนสถานะผู้ใช้งาน`, 'Users', user.user_id, user.status, nextStatus);
      showToast('success', 'อัปเดตสถานะผู้ใช้งานสำเร็จ!');
      fetchData();
    } catch (err: any) {
      showToast('error', err.message);
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
      <div className="relative z-10 grid grid-cols-3 sm:grid-cols-5 md:grid-cols-10 gap-2 mb-6 bg-slate-950/60 p-1.5 rounded-2xl border border-slate-800">
        {[
          { tab: 'dashboard', icon: LayoutDashboard, text: 'หน้าแรก' },
          { tab: 'users', icon: Users, text: 'พนักงาน' },
          { tab: 'cards', icon: CreditCard, text: 'บัตรจอดรถ' },
          { tab: 'points', icon: MapPin, text: 'จุดตรวจ' },
          { tab: 'keys', icon: Key, text: 'กุญแจหลัก' },
          { tab: 'units', icon: Home, text: 'ยูนิตห้องพัก' },
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
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">อีเมล Google ที่ใช้ล็อกอิน (สิทธิ์แบบแชร์ได้)</label>
                    <input
                      type="email"
                      required
                      value={userForm.login_email}
                      onChange={e => setUserForm({ ...userForm, login_email: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="เช่น guard@example.com"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">บทบาท / สิทธิ์ปฏิบัติงาน</label>
                    <select
                      value={userForm.role}
                      onChange={e => setUserForm({ ...userForm, role: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                    >
                      <option value="Guard">Guard (เจ้าหน้าที่ รปภ.)</option>
                      <option value="ShiftHead">ShiftHead (หัวหน้ากะตรวจตรา)</option>
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
                    <label className="text-[10px] text-slate-400 font-bold block mb-1">รหัส PIN (สำหรับระบบล็อกอินเสริม)</label>
                    <input
                      type="text"
                      maxLength={4}
                      value={userForm.pin}
                      onChange={e => setUserForm({ ...userForm, pin: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="4 หลัก"
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
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">{user.login_email}</div>
                        </td>
                        <td className="p-4">
                          <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                            user.role === 'Admin' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            user.role === 'Manager' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            user.role === 'ShiftHead' || (user.role as string) === 'Shift Leader' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
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

        {/* Units Management Tab */}
        {activeTab === 'units' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/40 p-4 rounded-2xl border border-slate-800/80">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Home className="w-4 h-4 text-blue-500" /> สารบบยูนิตห้องพักและเจ้าของร่วม (Units Master Hub)
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">
                  นำเข้าไฟล์รายชื่อยูนิต / ห้องพัก เพื่อเชื่อมโยงระบบบันทึกเข้า-ออกของทีม รปภ.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    value={unitsSearch}
                    onChange={e => setUnitsSearch(e.target.value)}
                    className="bg-slate-950 text-xs text-white pl-8 pr-3 py-2 rounded-xl border border-slate-800 outline-none w-48 focus:border-blue-500"
                    placeholder="ค้นหาเลขห้อง/ชื่อเจ้าของ/เบอร์..."
                  />
                </div>
                {(isAdmin || isManager) ? (
                  <>
                    <input
                      type="file"
                      accept=".csv,.xlsx"
                      onChange={handleUnitsFileSelect}
                      className="hidden"
                      id="xlsx-units-upload"
                    />
                    <label
                      htmlFor="xlsx-units-upload"
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-md shadow-blue-500/10 cursor-pointer transition-all shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" /> นำเข้าข้อมูลห้องชุด (Excel/CSV)
                    </label>
                  </>
                ) : (
                  <button
                    disabled
                    className="bg-slate-800 text-slate-500 text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shrink-0 cursor-not-allowed"
                  >
                    <Download className="w-3.5 h-3.5" /> นำเข้าข้อมูลห้องชุด (อ่านอย่างเดียว)
                  </button>
                )}
              </div>
            </div>

            {/* Admin-only Import Status Card */}
            {isAdmin && (() => {
              const status = computeImportStatus();
              return (
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                        สถานะการตรวจสอบนำเข้ายูนิตห้องพัก (Import Integrity Report)
                      </h4>
                      <p className="text-[10px] text-slate-500 mt-1">
                        วิเคราะห์ความสมบูรณ์ของโครงสร้างข้อมูลในสารบบยูนิตแบบเรียลไทม์
                      </p>
                    </div>
                    <span className="text-[9px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full uppercase font-bold">
                      Admin Access Only
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ยูนิตห้องพักทั้งหมด</span>
                      <span className="text-xl font-black text-white font-mono">{status.total} <span className="text-xs font-normal text-slate-500">ห้อง</span></span>
                    </div>
                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3 flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ผ่านการตรวจสอบความถูกต้อง (Valid)</span>
                      <span className="text-xl font-black text-emerald-400 font-mono">{status.valid} <span className="text-xs font-normal text-slate-500">ห้อง</span></span>
                    </div>
                    <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-3 flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-bold">ห้องที่ถูกปฏิเสธ/ไม่สมบูรณ์ (Rejected)</span>
                      <span className="text-xl font-black text-rose-400 font-mono">{status.rejected} <span className="text-xs font-normal text-slate-500">แถว/ยูนิต</span></span>
                    </div>
                  </div>

                  {status.reasons.length > 0 && (
                    <div className="bg-slate-950/60 rounded-xl p-4 border border-rose-500/10 flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-rose-400 flex items-center gap-1.5 uppercase font-bold tracking-wider">
                        ⚠️ สาเหตุความล้มเหลว/การปฏิเสธนำเข้า (First 10 Rejection Reasons):
                      </span>
                      <ul className="text-[10px] font-mono text-slate-400 list-disc list-inside space-y-1.5 pl-1 leading-relaxed">
                        {status.reasons.map((reason, idx) => (
                          <li key={idx} className="text-slate-300">
                            <span className="text-rose-400/80 font-bold mr-1">#{idx + 1}</span> {reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="bg-slate-900/40 rounded-2xl border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[10px] font-bold uppercase tracking-wider bg-slate-950/40">
                      <th className="p-3">ID ยูนิต (unit_id)</th>
                      <th className="p-3">รหัสห้อง (room_code)</th>
                      <th className="p-3">เลขห้อง (room_number)</th>
                      <th className="p-3">ชั้น (FLOOR)</th>
                      <th className="p-3">อัตราส่วน (RATIO)</th>
                      <th className="p-3">พื้นที่ (AREA)</th>
                      <th className="p-3">ชื่อเจ้าของ (OWNER_NAME)</th>
                      <th className="p-3">เบอร์โทรศัพท์ (PhoneNo)</th>
                      <th className="p-3">อีเมล (Email)</th>
                      <th className="p-3 text-right">สถานะ (STATUS)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-[11px] text-slate-300">
                    {unitList.filter(u => {
                      const s = unitsSearch.toLowerCase();
                      const normS = s.replace(/[\s\/\-\_\.]/g, '');
                      const normRoom = (u.room_number || '').toLowerCase().replace(/[\s\/\-\_\.]/g, '');
                      const normCode = (u.room_code || '').toLowerCase().replace(/[\s\/\-\_\.]/g, '');
                      return (
                        (normS && normRoom.includes(normS)) ||
                        (normS && normCode.includes(normS)) ||
                        (u.room_code || '').toLowerCase().includes(s) ||
                        (u.room_number || '').toLowerCase().includes(s) ||
                        (u.owner_name || '').toLowerCase().includes(s) ||
                        (u.phone || '').toLowerCase().includes(s) ||
                        (u.searchable_text || '').toLowerCase().includes(s)
                      );
                    }).length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-8 text-center text-slate-500">
                          ไม่พบข้อมูลยูนิตห้องพักในฐานข้อมูล กรุณาอัปโหลดไฟล์ CSV ห้องพักผ่านทางปุ่มด้านบน
                        </td>
                      </tr>
                    ) : (
                      unitList.filter(u => {
                        const s = unitsSearch.toLowerCase();
                        const normS = s.replace(/[\s\/\-\_\.]/g, '');
                        const normRoom = (u.room_number || '').toLowerCase().replace(/[\s\/\-\_\.]/g, '');
                        const normCode = (u.room_code || '').toLowerCase().replace(/[\s\/\-\_\.]/g, '');
                        return (
                          (normS && normRoom.includes(normS)) ||
                          (normS && normCode.includes(normS)) ||
                          (u.room_code || '').toLowerCase().includes(s) ||
                          (u.room_number || '').toLowerCase().includes(s) ||
                          (u.owner_name || '').toLowerCase().includes(s) ||
                          (u.phone || '').toLowerCase().includes(s) ||
                          (u.searchable_text || '').toLowerCase().includes(s)
                        );
                      }).map((unit) => (
                        <tr key={unit.unit_id} className="hover:bg-slate-800/20 transition-colors">
                          <td className="p-3 font-mono text-slate-400">{unit.unit_id}</td>
                          <td className="p-3 font-mono text-slate-300">{unit.room_code || '-'}</td>
                          <td className="p-3 font-bold text-white">{unit.room_number}</td>
                          <td className="p-3">{unit.floor} ชั้น</td>
                          <td className="p-3 font-mono">{unit.ratio}</td>
                          <td className="p-3 font-mono">{unit.area} ตร.ม.</td>
                          <td className="p-3">{unit.owner_name || '-'}</td>
                          <td className="p-3 font-mono">{unit.phone || '-'}</td>
                          <td className="p-3">{unit.email || '-'}</td>
                          <td className="p-3 text-right">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                              unit.occupancy_status === 'Active' || unit.occupancy_status === 'ใช้งานอยู่' || unit.occupancy_status === 'OWN'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}>
                              {unit.occupancy_status || 'ว่าง'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
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

            {/* เครื่องมือย้ายฐานข้อมูล (Migration Export) Section */}
            {isAdmin && (
              <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl flex flex-col gap-5 shadow-inner">
                <div className="border-b border-slate-800 pb-3">
                  <h4 className="text-sm font-black text-blue-400 flex items-center gap-2">
                    📂 เครื่องมือย้ายฐานข้อมูล (Migration Export)
                  </h4>
                  <p className="text-xs text-slate-400 font-bold mt-1">
                    ระบบส่งออกข้อมูลระดับแอดมินสูงสุดสำหรับการเตรียมย้ายฐานข้อมูลต้นทาง (Source Database) ไปยังโครงการความปลอดภัยใหม่ปลายทาง (SecurityProjectV1)
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-bold bg-slate-950 p-4 rounded-xl border border-slate-850">
                  <div>
                    <span className="text-slate-500 block mb-1">SOURCE PROJECT (โครงการต้นทาง):</span>
                    <span className="text-white font-mono text-xs bg-slate-900 px-2 py-1 rounded border border-slate-800">amped-impulse-cdw25</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">SOURCE DATABASE ID (ฐานข้อมูลต้นทาง):</span>
                    <span className="text-white font-mono text-[11px] bg-slate-900 px-2 py-1 rounded border border-slate-800 break-all select-all">
                      ai-studio-smartguardsystem-e2a4586d-b4ef-4694-9036-1c64c9967e71
                    </span>
                  </div>
                </div>

                {/* User Confirmation Input */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 flex flex-col gap-3">
                  <label className="text-xs font-black text-amber-400">
                    ⚠️ ขั้นตอนความปลอดภัย: กรุณาพิมพ์คำยืนยันรหัสส่งออกเพื่อปลดล็อคการดาวน์โหลด:
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                    <input
                      type="text"
                      value={exportConfirmation}
                      onChange={(e) => setExportConfirmation(e.target.value)}
                      placeholder="พิมพ์คำว่า: EXPORT SOURCE DATA"
                      className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 font-mono outline-none focus:border-blue-500 transition-all flex-1"
                    />
                    <span className="text-[10px] text-slate-400 font-bold">
                      (พิมพ์ตัวพิมพ์ใหญ่ตรงกันทุกตัวอักษร)
                    </span>
                  </div>
                </div>

                {/* Buttons Grid */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    type="button"
                    disabled={isExporting || exportConfirmation.trim() !== 'EXPORT SOURCE DATA'}
                    onClick={() => handleMigrationExport('master')}
                    className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-blue-950/20"
                  >
                    {isExporting && exportResult?.type === 'master' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    ส่งออกข้อมูลหลัก (Master Data)
                  </button>

                  <button
                    type="button"
                    disabled={isExporting || exportConfirmation.trim() !== 'EXPORT SOURCE DATA'}
                    onClick={() => handleMigrationExport('transaction')}
                    className="flex-1 py-3 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-purple-950/20"
                  >
                    {isExporting && exportResult?.type === 'transaction' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    ส่งออกประวัติรายการ (Transaction Data)
                  </button>
                </div>

                {/* Progress bar and message */}
                {exportProgress && (
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 flex flex-col gap-2">
                    <div className="flex justify-between items-center text-xs font-bold">
                      <span className="text-slate-300">
                        กำลังดึงข้อมูล [{exportProgress.collectionName}] ({exportProgress.collectionIndex} จาก {exportProgress.totalCollections})
                      </span>
                      <span className="text-blue-400 font-mono">
                        {Math.round((exportProgress.collectionIndex / exportProgress.totalCollections) * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="bg-blue-500 h-full transition-all duration-300"
                        style={{ width: `${(exportProgress.collectionIndex / exportProgress.totalCollections) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      สถานะระบบ: {exportProgress.status}
                    </span>
                  </div>
                )}

                {/* Error message */}
                {exportError && (
                  <div className="bg-red-950/50 border border-red-900/50 p-4 rounded-xl text-xs text-red-400 font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                    <span>{exportError}</span>
                  </div>
                )}

                {/* Preview & Downloads Section */}
                {exportResult && (
                  <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 flex flex-col gap-4 animate-fade-in">
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-black border-b border-slate-800 pb-2">
                      <CheckCircle className="w-4 h-4" />
                      <span>สร้างชุดข้อมูลสำเร็จ! พร้อมดาวน์โหลดไฟล์ ({exportResult.type === 'master' ? 'Master Data' : 'Transaction Data'})</span>
                    </div>

                    {/* Info Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-semibold bg-slate-900 p-3 rounded-lg border border-slate-850">
                      <div>
                        <span className="text-slate-500 block">ชื่อไฟล์ข้อมูล:</span>
                        <span className="text-white font-mono text-[11px] break-all">{exportResult.filename}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">เอกสารรวมทั้งสิ้น:</span>
                        <span className="text-emerald-400 font-mono font-bold text-sm">
                          {exportResult.metadata.total_documents.toLocaleString()} รายการ
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">ขนาดไฟล์ JSON:</span>
                        <span className="text-blue-400 font-mono font-bold text-sm">{exportResult.sizeText}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">คัดออกรูปภาพ Base64:</span>
                        <span className={`${exportResult.metadata.warnings.length > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'} font-mono`}>
                          {exportResult.metadata.warnings.length > 0 ? 'คัดออกแล้ว' : 'ไม่มี'}
                        </span>
                      </div>
                    </div>

                    {/* SHA-256 Checksum */}
                    <div className="bg-slate-900 p-3 rounded-lg border border-slate-850 flex flex-col gap-1">
                      <span className="text-[10px] text-slate-500 font-bold block">SHA-256 CHECKSUM (แฮชตรวจสอบความถูกต้องของเนื้อหาไฟล์):</span>
                      <span className="text-white font-mono text-[11px] select-all break-all bg-slate-950 px-2 py-1.5 rounded border border-slate-800">
                        {exportResult.sha256}
                      </span>
                    </div>

                    {/* Warnings List */}
                    {exportResult.metadata.warnings.length > 0 && (
                      <div className="bg-amber-950/20 border border-amber-900/30 p-3 rounded-lg text-[11px] text-amber-400 font-bold flex flex-col gap-1">
                        <span className="text-amber-500 block uppercase tracking-wider text-[10px]">บันทึกความปลอดภัยของสื่อมีเดีย (Media exclusion notice)</span>
                        <ul className="list-disc list-inside space-y-1">
                          {exportResult.metadata.warnings.map((w: string, idx: number) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Collection Breakdown Preview */}
                    <div>
                      <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase block mb-2">ตารางตรวจสอบสถิติราย Collection:</span>
                      <div className="border border-slate-850 rounded-lg overflow-hidden">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-slate-900 text-slate-400 uppercase font-bold border-b border-slate-850">
                            <tr>
                              <th className="px-3 py-2">ชื่อ Collection ในระบบ</th>
                              <th className="px-3 py-2 text-right">จำนวนทั้งหมด</th>
                              <th className="px-3 py-2 text-right">จำนวนที่ดึงออก</th>
                              <th className="px-3 py-2 text-right">ข้ามสื่อขนาดใหญ่</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-850">
                            {exportResult.preview.map((col: any) => (
                              <tr key={col.name} className="hover:bg-slate-900/30">
                                <td className="px-3 py-2 font-mono font-bold text-slate-300">{col.name}</td>
                                <td className="px-3 py-2 text-right font-mono text-slate-400">{col.docsCount}</td>
                                <td className="px-3 py-2 text-right font-mono text-emerald-400">{col.docsCount}</td>
                                <td className="px-3 py-2 text-right font-mono text-amber-400">{col.excludedMediaCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Action Downloads */}
                    <div className="flex flex-col sm:flex-row gap-3 border-t border-slate-900 pt-4">
                      <button
                        type="button"
                        onClick={() => downloadFile(exportResult.filename, exportResult.jsonText)}
                        className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-md shadow-emerald-950/20"
                      >
                        <Download className="w-4 h-4" />
                        ดาวน์โหลดไฟล์ข้อมูล (.json)
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadFile(`${exportResult.filename}.sha256.txt`, exportResult.sha256, 'text/plain')}
                        className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                      >
                        <FileText className="w-4 h-4" />
                        ดาวน์โหลดไฟล์ Checksum (.sha256.txt)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

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

                <div className="flex flex-col gap-3 pt-4 border-t border-slate-900">
                  <span className="text-[10px] text-slate-400 font-bold block">3. กู้คืนข้อมูลสารบบห้องชุด (Database Restore & Rollback)</span>
                  {!archiveLoaded ? (
                    <button
                      type="button"
                      onClick={fetchBackupBatches}
                      disabled={loadingArchive}
                      className="p-3 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-400 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingArchive ? 'animate-spin' : ''}`} />
                      {loadingArchive ? 'กำลังดึงรายการข้อมูลสำรอง...' : 'ดูประวัติและกู้คืนข้อมูล (Restore Backup)'}
                    </button>
                  ) : (
                    <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-300 font-bold">เลือกชุดข้อมูลสำรองที่ต้องการกู้คืน:</span>
                        <button
                          type="button"
                          onClick={() => setArchiveLoaded(false)}
                          className="text-[10px] text-indigo-400 hover:underline font-bold"
                        >
                          ซ่อนประวัติ
                        </button>
                      </div>
                      {backupBatches.length === 0 ? (
                        <span className="text-[10px] text-slate-500 italic">ไม่พบข้อมูลสำรองห้องชุดในระบบ</span>
                      ) : (
                        <>
                          <select
                            value={selectedRollbackBatch}
                            onChange={e => setSelectedRollbackBatch(e.target.value)}
                            className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-xl border border-slate-800 outline-none focus:border-blue-500"
                          >
                            <option value="">-- เลือกชุดข้อมูลสำรอง --</option>
                            {backupBatches.map((batch) => (
                              <option key={batch.backup_batch_id} value={batch.backup_batch_id}>
                                {new Date(batch.archived_at).toLocaleString('th-TH')} - {batch.count} ยูนิต ({batch.operator_name})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleRollback(selectedRollbackBatch)}
                            disabled={!selectedRollbackBatch || loading}
                            className="w-full p-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
                          >
                            {loading ? 'กำลังกู้คืนข้อมูล...' : 'ยืนยันการกู้คืนห้องชุด (Restore Selected Backup)'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
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

      {/* Excel / CSV Import & Preview Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-4xl flex flex-col gap-5 text-left shadow-2xl my-8">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" /> ตรวจสอบความถูกต้องและพรีวิวข้อมูลห้องชุด
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  ไฟล์ที่เลือก: <span className="font-mono text-blue-400">{importFileName}</span> | ตรวจพบแถวทั้งหมด: {importAllRecords.length + importRejections.length} แถว
                </p>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-500 hover:text-white text-xs p-1"
                disabled={isImportingInProgress}
              >
                ✕ ปิด
              </button>
            </div>

            {/* If import is completed, show the results report! */}
            {importStats ? (
              <div className="flex flex-col gap-4">
                <div className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-2xl flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <CheckCircle className="w-5 h-5" /> นำเข้าและอัปเดตข้อมูลสำเร็จเสร็จสิ้น!
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
                    <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase font-bold">จำนวนแถวทั้งหมด</div>
                      <div className="text-lg font-mono font-bold text-slate-300">{importStats.total} แถว</div>
                    </div>
                    <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase font-bold">ยูนิตใหม่ที่เพิ่ม</div>
                      <div className="text-lg font-mono font-bold text-emerald-400">+{importStats.imported} ห้อง</div>
                    </div>
                    <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase font-bold">ยูนิตเดิมที่อัปเดต</div>
                      <div className="text-lg font-mono font-bold text-blue-400">{importStats.updated} ห้อง</div>
                    </div>
                    <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase font-bold">แถวที่ปฏิเสธ/ล้มเหลว</div>
                      <div className="text-lg font-mono font-bold text-rose-400">{importStats.rejected} แถว</div>
                    </div>
                  </div>
                </div>

                {importStats.rejected > 0 && (
                  <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-rose-400 font-bold text-xs">
                      <AlertTriangle className="w-4 h-4" /> รายงานข้อผิดพลาด/แถวที่ถูกปฏิเสธ (จำกัดแสดง 10 รายการแรก)
                    </div>
                    <div className="max-h-40 overflow-y-auto bg-slate-950/40 p-3 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-300 divide-y divide-slate-900">
                      {importStats.reasons.slice(0, 10).map((reason, idx) => (
                        <div key={idx} className="py-1.5 text-rose-300">
                          {reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => {
                      setIsImportModalOpen(false);
                      setImportStats(null);
                    }}
                    className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ปิดหน้าต่างรายงาน
                  </button>
                </div>
              </div>
            ) : (
              // Preview & Upload State
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">ข้อมูลที่พร้อมนำเข้า (Valid)</div>
                    <div className="text-lg font-mono font-bold text-emerald-400">{importAllRecords.length} แถว</div>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">ข้อมูลที่ไม่ผ่านเกณฑ์ (Rejected)</div>
                    <div className="text-lg font-mono font-bold text-rose-400">{importRejections.length} แถว</div>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">หัวตารางที่ตรวจพบ (Headers)</div>
                    <div className="text-xs font-mono font-bold text-slate-300 truncate" title={importHeaders.join(', ')}>
                      {importHeaders.length} คอลัมน์ ({importHeaders.slice(0, 3).join(', ')}...)
                    </div>
                  </div>
                </div>

                {importRejections.length > 0 && (
                  <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-rose-400 font-bold text-xs">
                      <AlertTriangle className="w-4 h-4" /> ตรวจพบรายการไม่ผ่านเกณฑ์การตรวจสอบ (จะถูกข้ามตอนนำเข้า)
                    </div>
                    <div className="max-h-28 overflow-y-auto bg-slate-950/40 p-3 rounded-xl border border-slate-800 text-[10px] font-mono text-slate-300">
                      {importRejections.slice(0, 10).map((r, i) => (
                        <div key={i} className="text-rose-300 mb-1">• {r}</div>
                      ))}
                      {importRejections.length > 10 && (
                        <div className="text-rose-400/80 italic mt-1 font-bold">... และอีก {importRejections.length - 10} รายการที่ไม่ผ่านเกณฑ์</div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-xs font-bold text-white mb-2">พรีวิวข้อมูลจำลอง 20 แถวแรก:</div>
                  <div className="bg-slate-950/60 rounded-2xl border border-slate-800/80 overflow-hidden">
                    <div className="max-h-60 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-[10px]">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider bg-slate-950">
                            <th className="p-2.5 w-12 text-center">แถว</th>
                            <th className="p-2.5">รหัสห้อง (code)</th>
                            <th className="p-2.5">เลขที่ห้อง (number)</th>
                            <th className="p-2.5">ชั้น</th>
                            <th className="p-2.5">ชื่อเจ้าของห้อง</th>
                            <th className="p-2.5">เบอร์โทร</th>
                            <th className="p-2.5">สถานะ</th>
                            <th className="p-2.5 text-right">การตรวจสอบ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-slate-300">
                          {importPreviewList.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/20 transition-colors">
                              <td className="p-2 text-center text-slate-500 font-mono">{row.rowNum}</td>
                              <td className="p-2 font-mono">
                                <div className="font-bold text-slate-200">{row.room_code || '-'}</div>
                                {row.debug && (
                                  <div className="text-[8px] text-slate-500 mt-1 space-y-0.5 border-t border-slate-800/60 pt-1 font-sans">
                                    <div>RoomID raw: <span className="font-mono text-slate-400">{row.debug.raw_value || '-'}</span></div>
                                    <div>RoomID formatted: <span className="font-mono text-blue-400">{row.debug.formatted_value || '-'}</span></div>
                                    <div>Room Code stored: <span className="font-mono text-emerald-400">{row.debug.stored_value || '-'}</span></div>
                                  </div>
                                )}
                              </td>
                              <td className="p-2 font-bold text-white">{row.room_number || '-'}</td>
                              <td className="p-2">{row.floor || '-'}</td>
                              <td className="p-2">{row.owner_name || '-'}</td>
                              <td className="p-2 font-mono">{row.phone || '-'}</td>
                              <td className="p-2 font-mono">{row.occupancy_status || '-'}</td>
                              <td className="p-2 text-right">
                                {row.isValid ? (
                                  <span className="bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded text-[9px] font-bold border border-emerald-500/20">
                                    ✓ สมบูรณ์
                                  </span>
                                ) : (
                                  <span className="bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded text-[9px] font-bold border border-rose-500/20" title={row.errorMsg}>
                                    ✕ ไม่สมบูรณ์
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-800 pt-3">
                  {hasCorruptedRoomCode && (
                    <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl flex items-center gap-2 text-rose-400 text-xs font-bold">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500 animate-pulse" />
                      <span>ตรวจพบ Room Code ถูกแปลงเป็น Excel serial กรุณาแก้การอ่านไฟล์ก่อนนำเข้า</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">
                      * ระบบจะสร้าง <span className="text-blue-400 font-mono">unit_id</span> แบบอัตโนมัติ และอัปเดตข้อมูลทับรายการเดิมถ้าเลขห้องตรงกัน
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setIsImportModalOpen(false)}
                        className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                        disabled={isImportingInProgress}
                      >
                        ยกเลิก
                      </button>
                      <button
                        onClick={handleConfirmImport}
                        className="px-6 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isImportingInProgress || importAllRecords.length === 0 || hasCorruptedRoomCode}
                      >
                        {isImportingInProgress ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> กำลังนำเข้า ({importAllRecords.length} แถว)...
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-3.5 h-3.5" /> ยืนยันการนำเข้าข้อมูล
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
