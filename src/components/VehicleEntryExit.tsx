/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Car, Search, Check, AlertTriangle, ShieldAlert,
  ArrowUpRight, ArrowDownLeft, Camera, ShieldX, HelpCircle
} from 'lucide-react';
import { getMediaUploadConfigurationError, uploadImageToDrive } from '../services/mediaUploadService';
import { VehicleLogRecord, BlacklistRecord, type VehicleSessionRecord } from '../types';
import { listActiveBlacklist } from '../services/blacklistService';
import { completeVehicleExit, findActiveVehicleByCard, scanReturnedParkingCard, searchActiveVehicles } from '../services/parkingCardService';
import {
  acquireVehicleSessionLock,
  completeVehicleSession,
  createVehicleSessionFromScan,
  getVehicleSession,
  releaseVehicleSessionLock,
  subscribeActiveVehicleSessions,
  subscribePendingVehicleSessions,
  updateActiveVehicleSession,
  updateVehicleSession,
} from '../services/vehicleSessionService';
import { SessionConflictError } from '../services/vehicleSessionVersionService';
import {
  listOfflineVehicleSessions,
  queueOfflineVehicleSession,
  removeOfflineVehicleSession,
} from '../services/vehicleSessionOfflineQueue';
import QRScanner from './QRScanner';
import ConfirmModal from './ConfirmModal';
import UnitSearchSelect from './UnitSearchSelect';
import VehicleSessionTimeline from './VehicleSessionTimeline';
import { runSingleFlight } from '../utils/singleFlight';
import AuthenticatedEvidenceImage from './AuthenticatedEvidenceImage';

interface VehicleEntryExitProps {
  guardName: string;
  userRole: string;
}

export default function VehicleEntryExit({ guardName, userRole }: VehicleEntryExitProps) {
  const [activeTab, setActiveTab] = useState<'entry' | 'exit'>('entry');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Exit Confirmation Modal State
  const [showExitModal, setShowExitModal] = useState(false);

  // Blacklist
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const [blacklistWarning, setBlacklistWarning] = useState<string | null>(null);

  // Entry Form State
  const [entryForm, setEntryForm] = useState({
    card_number: '',
    vehicle_plate: '',
    vehicle_type: 'รถยนต์' as any,
    visitor_name: '',
    visitor_phone: '',
    target_room: '',
    target_unit_id: '',
    target_building: '',
    unit_lookup_status: undefined as 'matched' | 'manual' | undefined,
    purpose: 'เยี่ยมญาติ',
    note: ''
  });
  const [entryPlatePhoto, setEntryPlatePhoto] = useState<string>('');
  const [entryVehiclePhoto, setEntryVehiclePhoto] = useState<string>('');
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [pendingSessions, setPendingSessions] = useState<VehicleSessionRecord[]>([]);
  const [insideSessions, setInsideSessions] = useState<VehicleSessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<VehicleSessionRecord | null>(null);
  const offlineSyncRunning = useRef(false);
  const qrSessionCreationRef = useRef<Promise<string> | null>(null);
  const entrySubmitRunningRef = useRef(false);

  // Exit Form State
  const [parkedVehicles, setParkedVehicles] = useState<VehicleLogRecord[]>([]);
  const [exitSearchQuery, setExitSearchQuery] = useState('');
  const [selectedExitVehicle, setSelectedExitVehicle] = useState<VehicleLogRecord | null>(null);
  const [exitPlatePhoto, setExitPlatePhoto] = useState<string>('');
  const [exitVehiclePhoto, setExitVehiclePhoto] = useState<string>('');
  const [exitNote, setExitNote] = useState('');
  const [abnormalNote, setAbnormalNote] = useState('');
  const [lostCard, setLostCard] = useState(false);
  const [lostCardReason, setLostCardReason] = useState('');
  const [exitLoadError, setExitLoadError] = useState('');
  const [showExitScanner, setShowExitScanner] = useState(false);

  useEffect(() => {
    fetchInitialData();
  }, [activeTab]);

  useEffect(() => {
    const configurationError = getMediaUploadConfigurationError();
    if (configurationError) setStatusMessage({ type: 'error', text: configurationError });
  }, []);

  useEffect(() => {
    const sync = () => { void syncOfflineSessions(); };
    window.addEventListener('online', sync);
    if (navigator.onLine) sync();
    return () => window.removeEventListener('online', sync);
  }, [guardName]);

  async function syncOfflineSessions() {
    if (offlineSyncRunning.current || !navigator.onLine) return;
    offlineSyncRunning.current = true;
    try {
      const queued = await listOfflineVehicleSessions();
      for (const item of queued) {
        const sessionId = await createVehicleSessionFromScan(item.cardValue, item.siteId, item.operatorName, item.actorRole);
        let platePhotoUrl = '';
        let vehiclePhotoUrl = '';
        if (item.platePhotoDataUrl) {
          platePhotoUrl = await uploadImageToDrive(item.platePhotoDataUrl, `plate_in_offline_${Date.now()}.jpg`, { moduleName: 'VehicleLogs', recordId: sessionId, siteId: item.siteId, uploadedBy: item.operatorName });
        }
        if (item.vehiclePhotoDataUrl) {
          vehiclePhotoUrl = await uploadImageToDrive(item.vehiclePhotoDataUrl, `vehicle_in_offline_${Date.now()}.jpg`, { moduleName: 'VehicleLogs', recordId: sessionId, siteId: item.siteId, uploadedBy: item.operatorName });
        }
        if (item.patch) {
          const nextVersion = await updateVehicleSession(sessionId, {
            ...item.patch,
            entry_plate_photo_url: platePhotoUrl || item.patch.entry_plate_photo_url,
            entry_vehicle_photo_url: vehiclePhotoUrl || item.patch.entry_vehicle_photo_url,
          }, 'Ready', 'Ready', item.operatorName, item.actorRole, 1);
          await completeVehicleSession(sessionId, item.operatorName, item.actorRole, nextVersion);
        }
        await removeOfflineVehicleSession(item.localId);
      }
      if (queued.length) setStatusMessage({ type: 'success', text: `ซิงก์ Vehicle Session ออฟไลน์สำเร็จ ${queued.length} รายการ` });
    } catch (reason) {
      setStatusMessage({ type: 'error', text: `ยังซิงก์รายการออฟไลน์ไม่ได้: ${reason instanceof Error ? reason.message : String(reason)}` });
    } finally {
      offlineSyncRunning.current = false;
    }
  }

  useEffect(() => {
    const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';
    const stopPending = subscribePendingVehicleSessions(siteId, setPendingSessions);
    const stopInside = subscribeActiveVehicleSessions(siteId, setInsideSessions);
    return () => { stopPending(); stopInside(); };
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [blList, allVehicles] = await Promise.all([
        listActiveBlacklist(sessionStorage.getItem('selected_site_id') || 'site-01'),
        searchActiveVehicles(sessionStorage.getItem('selected_site_id') || 'site-01', { operatorName: guardName, role: userRole })
      ]);
      setBlacklist(blList);
      setParkedVehicles(allVehicles);
      setExitLoadError('');
    } catch (err) {
      console.error('Failed to load vehicle data:', err);
      setExitLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReturnedCardLookup = async (rawValue = exitSearchQuery, scanned = false) => {
    setLoading(true); setStatusMessage(null);
    try {
      const lookup = scanned ? scanReturnedParkingCard : findActiveVehicleByCard;
      const result = await lookup(rawValue.trim(), sessionStorage.getItem('selected_site_id') || 'site-01', { operatorName: guardName, role: userRole });
      if (!result.success || !result.vehicleLog) throw new Error(result.reason || 'No active vehicle linked to this card.');
      await openVehicleExit(result.vehicleLog);
      if (result.warningCode === 'LEGACY_SITE_MISSING') setStatusMessage({ type: 'error', text: 'Legacy / Missing Site — Admin compatibility mode. Verify details before exit.' });
      setShowExitScanner(false);
    } catch (reason) {
      setStatusMessage({ type: 'error', text: reason instanceof Error ? reason.message : String(reason) });
    } finally { setLoading(false); }
  };

  const openVehicleExit = async (log: VehicleLogRecord) => {
    if (!log.vehicle_session_id || (log.entry_plate_photo_url && log.entry_vehicle_photo_url)) {
      setSelectedExitVehicle(log);
      return;
    }
    try {
      const session = await getVehicleSession(log.vehicle_session_id);
      setSelectedExitVehicle({
        ...log,
        entry_plate_photo_url: log.entry_plate_photo_url || session.entry_plate_photo_url,
        entry_vehicle_photo_url: log.entry_vehicle_photo_url || session.entry_vehicle_photo_url,
      });
    } catch {
      // Legacy logs may not have a readable session. Preserve the log model.
      setSelectedExitVehicle(log);
    }
  };

  // Check Blacklist whenever plate changes
  const handlePlateChange = (plate: string) => {
    setEntryForm(prev => ({ ...prev, vehicle_plate: plate }));
    if (!plate) {
      setBlacklistWarning(null);
      return;
    }

    const matched = blacklist.find(b => 
      b.type === 'ทะเบียนรถ' && 
      b.vehicle_plate && 
      plate.replace(/\s+/g, '').includes(b.vehicle_plate.replace(/\s+/g, ''))
    );

    if (matched) {
      setBlacklistWarning(`🚨 เตือนภัยแบล็กลิสต์: รถทะเบียนนี้ถูกขึ้นบัญชีดำ! เหตุผล: ${matched.reason} (${matched.severity})`);
    } else {
      setBlacklistWarning(null);
    }
  };

  // Convert uploaded files to base64
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, setPhoto: (url: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const getOrCreateVehicleSession = async (cardNumber: string): Promise<string> => {
    if (activeSessionId) return activeSessionId;

    return runSingleFlight(qrSessionCreationRef, async () => {
      const sessionId = await createVehicleSessionFromScan(
        cardNumber,
        sessionStorage.getItem('selected_site_id') || 'site-01',
        guardName,
        userRole,
      );
      setActiveSessionId(sessionId);
      const session = await getVehicleSession(sessionId);
      setSelectedSession(session);
      setEntryPlatePhoto(session.entry_plate_photo_url || '');
      setEntryVehiclePhoto(session.entry_vehicle_photo_url || '');
      return sessionId;
    });
  };

  const handleQRScanSuccess = async (code: string) => {
    // QR payload is the canonical parking-card identifier; never rewrite suffixes.
    const cardNumber = code.trim().replace(/\s+/g, '').toUpperCase();
    console.info('[QR DEBUG]', { raw: code, parsed: cardNumber, siteId: sessionStorage.getItem('selected_site_id') || 'site-01' });
    setEntryForm(prev => ({ ...prev, card_number: cardNumber }));
    setShowQRScanner(false);
    setStatusMessage(null);
    try {
      if (!navigator.onLine) {
        const localId = `OFFLINE_${crypto.randomUUID()}`;
        await queueOfflineVehicleSession({
          localId, cardValue: cardNumber,
          siteId: sessionStorage.getItem('selected_site_id') || 'site-01',
          operatorName: guardName, actorRole: userRole, queuedAt: new Date().toISOString(),
        });
        setActiveSessionId(localId);
        setStatusMessage({ type: 'success', text: 'บันทึก QR แบบออฟไลน์แล้ว ระบบจะซิงก์อัตโนมัติเมื่อกลับมาออนไลน์' });
        return;
      }
      const existingSession = pendingSessions.find(session =>
        session.card_number.trim().replace(/\s+/g, '').toUpperCase() === cardNumber
        && !['Completed', 'Cancelled'].includes(session.status));
      if (existingSession) {
        await continueSession(existingSession);
        setStatusMessage({
          type: 'success',
          text: `เปิด Vehicle Session เดิมของบัตร ${cardNumber} เพื่อดำเนินการต่อ`,
        });
        return;
      }
      await getOrCreateVehicleSession(cardNumber);
      setStatusMessage({ type: 'success', text: 'สร้าง Vehicle Session แล้ว สามารถบันทึกต่อหรือให้เจ้าหน้าที่ท่านอื่นรับช่วงได้' });
    } catch (reason: unknown) {
      setStatusMessage({ type: 'error', text: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  const continueSession = async (session: VehicleSessionRecord) => {
    try {
      const latest = await getVehicleSession(session.session_id);
      const locked = await acquireVehicleSessionLock(latest.session_id, guardName, userRole === 'Admin', latest.sessionVersion);
      setActiveSessionId(locked.session_id);
      setSelectedSession(locked);
      setEntryForm({
        card_number: locked.card_number,
        vehicle_plate: locked.vehicle_plate || '',
        vehicle_type: locked.vehicle_type || 'รถยนต์',
        visitor_name: locked.visitor_name || '',
        visitor_phone: locked.visitor_phone || '',
        target_room: locked.target_room || '',
        target_unit_id: locked.target_unit_id || '',
        target_building: locked.target_building || '',
        unit_lookup_status: locked.unit_lookup_status,
        purpose: locked.purpose || 'เยี่ยมญาติ',
        note: locked.note || '',
      });
      setEntryPlatePhoto(locked.entry_plate_photo_url || '');
      setEntryVehiclePhoto(locked.entry_vehicle_photo_url || '');
      setStatusMessage({ type: 'success', text: `โหลดข้อมูลล่าสุดของ Session ${locked.card_number} แล้ว` });
    } catch (reason) {
      setStatusMessage({ type: 'error', text: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  useEffect(() => {
    const requestedSessionId = sessionStorage.getItem('vehicle_session_to_continue');
    if (!requestedSessionId) return;
    const requestedSession = pendingSessions.find(item => item.session_id === requestedSessionId)
      || insideSessions.find(item => item.session_id === requestedSessionId);
    if (!requestedSession) return;
    sessionStorage.removeItem('vehicle_session_to_continue');
    void continueSession(requestedSession);
  }, [pendingSessions, insideSessions]);

  const handleEntrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (entrySubmitRunningRef.current) return;
    if (!entryForm.card_number || !entryForm.vehicle_plate || !entryForm.target_room) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกเลขบัตร ทะเบียนรถ และห้อง/ปลายทาง' });
      return;
    }

    entrySubmitRunningRef.current = true;
    setLoading(true);
    setStatusMessage(null);

    try {
      const patch = {
        vehicle_plate: entryForm.vehicle_plate, vehicle_type: entryForm.vehicle_type,
        visitor_name: entryForm.visitor_name, visitor_phone: entryForm.visitor_phone,
        target_room: entryForm.target_room, target_unit_id: entryForm.target_unit_id || undefined,
        target_building: entryForm.target_building || undefined,
        unit_lookup_status: entryForm.unit_lookup_status, purpose: entryForm.purpose,
        note: entryForm.note,
      };
      if (!navigator.onLine || activeSessionId.startsWith('OFFLINE_')) {
        const localId = activeSessionId || `OFFLINE_${crypto.randomUUID()}`;
        await queueOfflineVehicleSession({
          localId, cardValue: entryForm.card_number,
          siteId: sessionStorage.getItem('selected_site_id') || 'site-01',
          operatorName: guardName, actorRole: userRole, patch,
          platePhotoDataUrl: entryPlatePhoto || undefined,
          vehiclePhotoDataUrl: entryVehiclePhoto || undefined,
          queuedAt: new Date().toISOString(),
        });
        setActiveSessionId(localId);
        setStatusMessage({ type: 'success', text: 'เก็บ QR รูปภาพ และข้อมูลผู้มาติดต่อไว้ในเครื่องแล้ว จะซิงก์อัตโนมัติเมื่อออนไลน์' });
        return;
      }
      const sessionId = await getOrCreateVehicleSession(entryForm.card_number);

      // Upload all required evidence before the atomic Firestore transaction.
      let platePhotoUrl = entryPlatePhoto && !entryPlatePhoto.startsWith('data:') ? entryPlatePhoto : '';
      let vehiclePhotoUrl = entryVehiclePhoto && !entryVehiclePhoto.startsWith('data:') ? entryVehiclePhoto : '';
      const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';

      if (entryPlatePhoto.startsWith('data:')) {
        platePhotoUrl = await uploadImageToDrive(entryPlatePhoto, `plate_in_${entryForm.vehicle_plate}_${Date.now()}.jpg`, { moduleName: 'VehicleLogs', recordId: sessionId, siteId, uploadedBy: guardName, mediaType: 'entry_plate' });
      }
      if (entryVehiclePhoto.startsWith('data:')) {
        vehiclePhotoUrl = await uploadImageToDrive(entryVehiclePhoto, `vehicle_in_${entryForm.vehicle_plate}_${Date.now()}.jpg`, { moduleName: 'VehicleLogs', recordId: sessionId, siteId, uploadedBy: guardName, mediaType: 'entry_vehicle' });
      }
      const latest = await getVehicleSession(sessionId);
      if (['Completed', 'Cancelled'].includes(latest.stage)) {
        throw new Error('Vehicle Session นี้ปิดแล้ว');
      }
      const entryPatch = {
        ...patch, entry_plate_photo_url: platePhotoUrl || undefined,
        entry_vehicle_photo_url: vehiclePhotoUrl || undefined,
      };
      const nextVersion = latest.stage === 'Active'
        ? await updateActiveVehicleSession(sessionId, entryPatch, guardName, userRole, latest.sessionVersion)
        : await updateVehicleSession(sessionId, entryPatch, 'Ready', 'Ready', guardName, userRole, latest.sessionVersion);
      const saved = await getVehicleSession(sessionId);
      setSelectedSession({ ...saved, sessionVersion: nextVersion });
      setStatusMessage({
        type: 'success',
        text: latest.stage === 'Active'
          ? 'อัปเดตข้อมูลรถที่อยู่ในพื้นที่และ Vehicle Log แล้ว'
          : 'บันทึกข้อมูลแล้ว กรุณาตรวจสอบและกด “รถเข้าพื้นที่แล้ว” เพื่อยืนยัน',
      });
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof SessionConflictError) {
        try {
          const latest = await getVehicleSession(err.sessionId);
          setSelectedSession(latest);
          setStatusMessage({ type: 'error', text: 'ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว โหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจสอบก่อนบันทึกใหม่' });
          return;
        } catch {
          // Preserve the original conflict when the refresh itself fails.
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${message}` });
    } finally {
      entrySubmitRunningRef.current = false;
      setLoading(false);
    }
  };

  const confirmVehicleInside = async () => {
    if (entrySubmitRunningRef.current || !activeSessionId) return;
    entrySubmitRunningRef.current = true;
    setLoading(true);
    try {
      const latest = await getVehicleSession(activeSessionId);
      if (latest.stage === 'Active' && latest.status === 'InProgress') {
        setSelectedSession(latest);
        setStatusMessage({ type: 'success', text: 'รถคันนี้อยู่ในพื้นที่แล้ว' });
        return;
      }
      const result = await completeVehicleSession(latest.session_id, guardName, userRole, latest.sessionVersion);
      setStatusMessage({ type: 'success', text: result.alreadyActive ? 'รถคันนี้อยู่ในพื้นที่แล้ว' : `ยืนยันรถเข้าพื้นที่แล้ว: ${latest.vehicle_plate}` });
      setActiveSessionId('');
      setSelectedSession(null);
    } catch (reason) {
      if (reason instanceof SessionConflictError) {
        const latest = await getVehicleSession(reason.sessionId);
        setSelectedSession(latest);
        setStatusMessage({ type: 'error', text: 'Session มีข้อมูลใหม่กว่า โหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจสอบก่อนยืนยันอีกครั้ง' });
      } else {
        setStatusMessage({ type: 'error', text: reason instanceof Error ? reason.message : String(reason) });
      }
    } finally {
      entrySubmitRunningRef.current = false;
      setLoading(false);
    }
  };

  const handleExitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExitVehicle) return;
    setShowExitModal(true);
  };

  const handleConfirmExit = async () => {
    if (!selectedExitVehicle) return;
    setShowExitModal(false);

    setLoading(true);
    setStatusMessage(null);

    try {
      let exitPlateUrl = '';
      let exitVehicleUrl = '';

      if (exitPlatePhoto) {
        exitPlateUrl = await uploadImageToDrive(exitPlatePhoto, `plate_out_${selectedExitVehicle.vehicle_plate}_${Date.now()}.jpg`, { moduleName: 'VehicleLogs', recordId: selectedExitVehicle.log_id, siteId: selectedExitVehicle.site_id, uploadedBy: guardName, mediaType: 'exit_plate' });
      }
      if (exitVehiclePhoto) {
        exitVehicleUrl = await uploadImageToDrive(exitVehiclePhoto, `vehicle_out_${selectedExitVehicle.vehicle_plate}_${Date.now()}.jpg`, { moduleName: 'VehicleLogs', recordId: selectedExitVehicle.log_id, siteId: selectedExitVehicle.site_id, uploadedBy: guardName, mediaType: 'exit_vehicle' });
      }

      await completeVehicleExit(selectedExitVehicle, {
        exitPlatePhotoUrl: exitPlateUrl, exitVehiclePhotoUrl: exitVehicleUrl, exitNote, abnormalNote, lostCard, lostCardReason,
      }, { operatorName: guardName, role: userRole });

      setStatusMessage({ type: 'success', text: `Vehicle ${selectedExitVehicle.vehicle_plate} exited successfully. Card ${selectedExitVehicle.card_number} is now ${lostCard ? 'Lost' : 'available'}.` });
      setSelectedExitVehicle(null);
      setExitPlatePhoto('');
      setExitVehiclePhoto('');
      setExitNote(''); setAbnormalNote(''); setLostCard(false); setLostCardReason(''); setExitSearchQuery('');
      fetchInitialData();
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const normalizedSearch = exitSearchQuery.trim().toLocaleLowerCase();
  const compactSearch = normalizedSearch.replace(/\s+/g, '');
  const filteredParked = parkedVehicles.filter(v => [v.vehicle_plate, v.card_number, v.visitor_name, v.visitor_phone, v.target_room]
    .some(value => value.toLocaleLowerCase().includes(normalizedSearch) || value.toLocaleLowerCase().replace(/\s+/g, '').includes(compactSearch)));
  const activeSession = selectedSession
    ?? pendingSessions.find(session => session.session_id === activeSessionId)
    ?? insideSessions.find(session => session.session_id === activeSessionId);

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-5 px-1 pb-10">
      
      {/* Tab Switcher */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => { setActiveTab('entry'); setStatusMessage(null); }}
          className={`flex-1 py-4 text-center font-bold text-sm border-b-2 flex justify-center items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'entry' 
              ? 'border-indigo-600 text-indigo-600 bg-white' 
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <ArrowUpRight className="w-4 h-4 text-emerald-600" />
          บันทึกรถเข้าอาคาร (Vehicle Entry)
        </button>
        <button
          onClick={() => { setActiveTab('exit'); setStatusMessage(null); }}
          className={`flex-1 py-4 text-center font-bold text-sm border-b-2 flex justify-center items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'exit' 
              ? 'border-indigo-600 text-indigo-600 bg-white' 
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <ArrowDownLeft className="w-4 h-4 text-slate-500" />
          บันทึกรถออกอาคาร (Vehicle Exit)
        </button>
      </div>

      {statusMessage && (
        <div className={`p-4 rounded-xl flex items-start gap-2 text-sm font-semibold shadow-sm ${
          statusMessage.type === 'success' 
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' 
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {statusMessage.type === 'error' ? <AlertTriangle className="w-5 h-5 shrink-0" /> : <Check className="w-5 h-5 shrink-0" />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {activeTab === 'entry' ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs font-bold text-amber-700">งานค้าง</p><p className="text-2xl font-black text-amber-900">{pendingSessions.length}</p></div>
            <div className="sm:col-span-2 rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-xs font-black text-slate-700">ดำเนินการ Session ต่อ</p>
              <div className="flex gap-2 overflow-x-auto">
                {pendingSessions.slice(0, 6).map(session => <button type="button" key={session.session_id} onClick={() => void continueSession(session)} className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">{session.card_number} · {session.stage}</button>)}
                {!pendingSessions.length && <span className="text-xs text-slate-400">ไม่มีรายการค้าง</span>}
              </div>
            </div>
          </div>
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-emerald-900">รถอยู่ในพื้นที่ ({insideSessions.length})</h3>
              <span className="text-[10px] font-bold text-emerald-700">Active / InProgress</span>
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {insideSessions.slice(0, 12).map(session => (
                <button type="button" key={session.session_id} onClick={() => void continueSession(session)} className="shrink-0 rounded-lg bg-emerald-700 px-3 py-2 text-left text-xs font-bold text-white">
                  {session.vehicle_plate || session.card_number}<br />
                  <span className="font-normal opacity-80">{session.target_room || 'ไม่ระบุปลายทาง'}</span>
                </button>
              ))}
              {!insideSessions.length && <span className="text-xs text-emerald-700">ยังไม่มีรถอยู่ในพื้นที่</span>}
            </div>
          </section>
          {activeSessionId && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs font-bold text-indigo-800">Session กำลังทำงาน: {activeSessionId} <button type="button" className="ml-2 underline" onClick={() => { void releaseVehicleSessionLock(activeSessionId); setActiveSessionId(''); setSelectedSession(null); }}>พักไว้ก่อน</button></div>}
          {activeSession && <VehicleSessionTimeline session={activeSession} actorName={guardName} actorRole={userRole} />}
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-black text-slate-800">ข้อมูลผู้มาติดต่อเข้าพื้นที่</h2>
            <button
              onClick={() => setShowQRScanner(!showQRScanner)}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              สแกน QR บัตรจอดรถ
            </button>
          </div>

          {showQRScanner && (
            <QRScanner 
              onScanSuccess={handleQRScanSuccess}
              onClose={() => setShowQRScanner(false)}
              title="สแกนบัตรจอดรถ"
              placeholderText="เช่น P001, P002"
            />
          )}

          {blacklistWarning && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-300 rounded-xl text-red-800 font-bold text-sm shadow-sm">
              <ShieldX className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
              <span>{blacklistWarning}</span>
            </div>
          )}

          <form onSubmit={handleEntrySubmit} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Card Number */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">หมายเลขบัตรจอดรถ *</label>
                <input
                  type="text"
                  value={entryForm.card_number}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, card_number: e.target.value }))}
                  placeholder="เช่น P001"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold font-mono"
                  required
                />
              </div>

              {/* License Plate */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ทะเบียนรถ (และจังหวัด) *</label>
                <input
                  type="text"
                  value={entryForm.vehicle_plate}
                  onChange={(e) => handlePlateChange(e.target.value)}
                  placeholder="เช่น กข 1234 กรุงเทพฯ"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                  required
                />
              </div>

              {/* Vehicle Type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ประเภทรถยนต์</label>
                <select
                  value={entryForm.vehicle_type}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, vehicle_type: e.target.value as any }))}
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none bg-white focus:border-indigo-600 text-sm font-semibold"
                >
                  <option value="รถยนต์">🚗 รถยนต์</option>
                  <option value="จักรยานยนต์">🏍️ จักรยานยนต์</option>
                  <option value="รถส่งของ">🚚 รถส่งของ</option>
                  <option value="อื่นๆ">🚲 อื่นๆ</option>
                </select>
              </div>

              {/* Visitor Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ชื่อผู้มาติดต่อ / ขับขี่</label>
                <input
                  type="text"
                  value={entryForm.visitor_name}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, visitor_name: e.target.value }))}
                  placeholder="เช่น นายอัญชัน แสวงหา"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                />
              </div>

              {/* Visitor Phone */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">เบอร์โทรศัพท์ติดต่อ</label>
                <input
                  type="tel"
                  value={entryForm.visitor_phone}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, visitor_phone: e.target.value }))}
                  placeholder="เช่น 0812345678"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold font-mono"
                />
              </div>

              <UnitSearchSelect value={entryForm.target_room} selectedUnitId={entryForm.target_unit_id}
                label="ห้อง/พื้นที่มาติดต่อ" required allowManualEntry
                statusFilter="Active"
                onSelect={unit => setEntryForm(prev => ({ ...prev, target_room: unit?.room_number || '', target_unit_id: unit?.unit_id || '', target_building: unit?.building || '', unit_lookup_status: unit ? (unit.unit_id ? 'matched' : 'manual') : undefined }))} />

              {/* Purpose */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">วัตถุประสงค์ติดต่อ</label>
                <select
                  value={entryForm.purpose}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, purpose: e.target.value }))}
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none bg-white focus:border-indigo-600 text-sm font-semibold"
                >
                  <option value="เยี่ยมญาติ">เยี่ยมญาติ / เพื่อนบ้าน</option>
                  <option value="ส่งอาหาร/พัสดุ">ส่งอาหาร / ส่งพัสดุ</option>
                  <option value="ซ่อมแซมห้องพัก">ซ่อมแซมห้องพัก / ต่อเติม</option>
                  <option value="ติดต่อนิติบุคคล">ติดต่อนิติบุคคล</option>
                  <option value="อื่นๆ">อื่นๆ (บันทึกหมายเหตุเพิ่ม)</option>
                </select>
              </div>

              {/* Purpose Note */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">หมายเหตุเพิ่มเติม</label>
                <input
                  type="text"
                  value={entryForm.note}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="เช่น แบกสัมภาระชิ้นใหญ่"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                />
              </div>
            </div>

            {/* Photo Capture Section - Uses Native mobile integration with file type inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              {/* Plate Photo */}
              <div className="flex flex-col gap-2 border border-slate-200 rounded-xl p-4 bg-slate-50">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                  <Camera className="w-4 h-4 text-indigo-600" />
                  ถ่ายรูปป้ายทะเบียนรถเข้า
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handlePhotoUpload(e, setEntryPlatePhoto)}
                  className="hidden"
                  id="entry-plate-upload"
                />
                <label
                  htmlFor="entry-plate-upload"
                  className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-slate-100 transition-colors"
                >
                  {entryPlatePhoto ? (
                    <AuthenticatedEvidenceImage mediaReference={entryPlatePhoto} alt="License plate" className="h-full w-full object-cover rounded-lg" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <Camera className="w-8 h-8" />
                      <span className="text-xs font-bold">กดเพื่อใช้กล้องถ่ายรูปทะเบียน</span>
                    </div>
                  )}
                </label>
              </div>

              {/* Vehicle Photo */}
              <div className="flex flex-col gap-2 border border-slate-200 rounded-xl p-4 bg-slate-50">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                  <Camera className="w-4 h-4 text-indigo-600" />
                  ถ่ายรูปสภาพตัวรถเข้า
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handlePhotoUpload(e, setEntryVehiclePhoto)}
                  className="hidden"
                  id="entry-vehicle-upload"
                />
                <label
                  htmlFor="entry-vehicle-upload"
                  className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-slate-100 transition-colors"
                >
                  {entryVehiclePhoto ? (
                    <AuthenticatedEvidenceImage mediaReference={entryVehiclePhoto} alt="Vehicle context" className="h-full w-full object-cover rounded-lg" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <Camera className="w-8 h-8" />
                      <span className="text-xs font-bold">กดเพื่อใช้กล้องถ่ายรูปสภาพรถ</span>
                    </div>
                  )}
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
            >
              {loading ? 'กำลังบันทึกลงฐานข้อมูล...' : '💾 บันทึกข้อมูลรถเข้า'}
            </button>
            {activeSession?.stage === 'Ready' && activeSession.status === 'Ready' && (
              <button
                type="button"
                disabled={loading || !activeSession.vehicle_plate || !activeSession.target_room}
                onClick={() => void confirmVehicleInside()}
                className="w-full rounded-xl bg-emerald-700 py-4 text-sm font-black text-white shadow-sm disabled:opacity-40"
              >
                รถเข้าพื้นที่แล้ว
              </button>
            )}
          </form>
        </div>
      ) : (
        /* EXIT TAB */
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          <h2 className="text-lg font-black text-slate-800">ค้นหาและบันทึกข้อมูลรถออกอาคาร</h2>

          <button type="button" onClick={() => setShowExitScanner(true)} className="min-h-14 w-full rounded-xl bg-indigo-600 px-5 py-4 text-base font-black text-white shadow active:scale-[0.99]">
            สแกนบัตรที่คืน (Scan Returned Card)
          </button>
          {showExitScanner && <QRScanner onScanSuccess={code => void handleReturnedCardLookup(code.trim(), true)} onClose={() => setShowExitScanner(false)} />}
          <div className="text-center text-xs font-bold text-slate-400">หรือกรอก Card Number / QR Code</div>
          
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3.5 text-slate-400 w-5 h-5" />
              <input type="text" value={exitSearchQuery} onChange={(e) => setExitSearchQuery(e.target.value)} placeholder="ทะเบียนรถ, Card/QR, ชื่อ, โทรศัพท์ หรือห้อง" className="w-full pl-11 pr-4 py-3 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold" />
            </div>
            <button type="button" disabled={loading || !exitSearchQuery.trim()} onClick={() => void handleReturnedCardLookup()} className="min-h-12 rounded-xl bg-slate-900 px-5 text-sm font-black text-white disabled:opacity-40">Find Active Vehicle</button>
          </div>

          {exitLoadError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">Firestore query failed: {exitLoadError}</div>}

          {loading && (
            <div className="py-10 text-center font-bold text-slate-500 animate-pulse text-sm">
              กำลังค้นหาข้อมูลยานพาหนะในพื้นที่...
            </div>
          )}

          {!loading && !exitLoadError && parkedVehicles.length === 0 && (
            <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
              <Car className="w-12 h-12 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-bold">ไม่มีรถยนต์จอดอยู่ในระบบ ณ ขณะนี้</p>
            </div>
          )}

          {!loading && !exitLoadError && parkedVehicles.length > 0 && filteredParked.length === 0 && !selectedExitVehicle && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-500">Search returned no active vehicle match.</div>}

          {!loading && parkedVehicles.length > 0 && !selectedExitVehicle && (
            <div className="flex flex-col gap-2.5 max-h-96 overflow-y-auto">
              {filteredParked.map((v) => (
                <div
                  key={v.log_id}
                  className="flex flex-col justify-between gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl transition-all sm:flex-row sm:items-center"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-white border border-slate-200 rounded-xl text-slate-700 font-black font-mono text-sm">
                      {v.card_number}
                    </div>
                    <div>
                      <span className="text-base font-black text-slate-800">{v.vehicle_plate}</span>
                      <p className="text-xs text-slate-500 font-medium">
                        {v.vehicle_type} • {v.visitor_name || 'ไม่ระบุชื่อ'} • {v.visitor_phone || 'ไม่มีเบอร์'} • ห้อง {v.target_room}
                      </p>
                      <p className="text-xs text-slate-500">{v.purpose} • โดย {v.recorded_by || v.operator_name || 'ไม่ระบุ'}</p>
                      {!v.site_id && <span className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Legacy / Missing Site</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs bg-indigo-100 text-indigo-800 font-bold px-2.5 py-0.5 rounded-full">
                      จอดแล้ว
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      เข้า: {new Date(v.entry_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                    </span>
                    <button type="button" onClick={() => void openVehicleExit(v)} className="mt-1 min-h-10 rounded-lg bg-indigo-600 px-3 text-xs font-black text-white">{userRole === 'Admin' && !v.site_id ? 'Close Legacy Test Vehicle' : 'Process Exit'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedExitVehicle && (
            <div className="border border-slate-200 rounded-xl p-5 bg-indigo-50/30 flex flex-col gap-5">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <span className="text-xs font-bold text-indigo-600 uppercase">ทำรายการรถออก</span>
                  <h3 className="text-base font-black text-slate-800">
                    บัตร: {selectedExitVehicle.card_number} • ทะเบียน: {selectedExitVehicle.vehicle_plate}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedExitVehicle(null)}
                  className="text-xs text-slate-500 font-bold hover:text-slate-800 cursor-pointer"
                >
                  เปลี่ยนคัน
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-semibold text-slate-600">
                <div>👥 ผู้ขับขี่: <span className="font-bold text-slate-800">{selectedExitVehicle.visitor_name || 'ไม่ระบุ'}</span></div>
                <div>📞 เบอร์โทรศัพท์: <span className="font-bold text-slate-800">{selectedExitVehicle.visitor_phone || 'ไม่ระบุ'}</span></div>
                <div>🏢 ห้องติดต่อ: <span className="font-bold text-slate-800">{selectedExitVehicle.target_room}</span></div>
                <div>⏱️ เวลาเข้า: <span className="font-bold text-slate-800">{new Date(selectedExitVehicle.entry_time).toLocaleString('th-TH')}</span></div>
                <div>🕒 เวลาที่จอด: <span className="font-bold text-slate-800">{Math.max(0, Math.floor((Date.now() - new Date(selectedExitVehicle.entry_time).getTime()) / 60000))} นาที</span></div>
                <div>🛡️ ผู้บันทึกเข้า: <span className="font-bold text-slate-800">{selectedExitVehicle.recorded_by || selectedExitVehicle.operator_name || 'ไม่ระบุ'}</span></div>
                <div>📝 วัตถุประสงค์: <span className="font-bold text-slate-800">{selectedExitVehicle.purpose || 'ไม่ระบุ'}</span></div>
                <div>📌 หมายเหตุเข้า: <span className="font-bold text-slate-800">{selectedExitVehicle.note || 'ไม่มี'}</span></div>
              </div>

              {(selectedExitVehicle.entry_plate_photo_url || selectedExitVehicle.entry_vehicle_photo_url) && <div className="grid grid-cols-2 gap-3">{selectedExitVehicle.entry_plate_photo_url && <AuthenticatedEvidenceImage mediaReference={selectedExitVehicle.entry_plate_photo_url} alt="Entry plate" className="h-28 w-full rounded-xl object-cover" />}{selectedExitVehicle.entry_vehicle_photo_url && <AuthenticatedEvidenceImage mediaReference={selectedExitVehicle.entry_vehicle_photo_url} alt="Entry vehicle" className="h-28 w-full rounded-xl object-cover" />}</div>}

              <form onSubmit={handleExitSubmit} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Exit Plate Photo */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-600">ถ่ายรูปป้ายทะเบียนรถออก (ไม่บังคับ)</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handlePhotoUpload(e, setExitPlatePhoto)}
                      className="hidden"
                      id="exit-plate-upload"
                    />
                    <label
                      htmlFor="exit-plate-upload"
                      className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-slate-100 transition-colors"
                    >
                      {exitPlatePhoto ? (
                        <img src={exitPlatePhoto} alt="Exit plate" className="h-full w-full object-cover rounded-lg" />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-slate-400">
                          <Camera className="w-7 h-7" />
                          <span className="text-[10px] font-bold">กดเพื่อใช้กล้องถ่ายรูปทะเบียน</span>
                        </div>
                      )}
                    </label>
                  </div>

                  {/* Exit Vehicle Photo */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-600">ถ่ายรูปสภาพตัวรถออก (ไม่บังคับ)</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handlePhotoUpload(e, setExitVehiclePhoto)}
                      className="hidden"
                      id="exit-vehicle-upload"
                    />
                    <label
                      htmlFor="exit-vehicle-upload"
                      className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-slate-100 transition-colors"
                    >
                      {exitVehiclePhoto ? (
                        <img src={exitVehiclePhoto} alt="Exit vehicle" className="h-full w-full object-cover rounded-lg" />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-slate-400">
                          <Camera className="w-7 h-7" />
                          <span className="text-[10px] font-bold">กดเพื่อใช้กล้องถ่ายรูปสภาพรถ</span>
                        </div>
                      )}
                    </label>
                  </div>
                </div>

                <textarea value={exitNote} onChange={event => setExitNote(event.target.value)} placeholder="Exit Note (optional)" className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm" />
                <textarea value={abnormalNote} onChange={event => setAbnormalNote(event.target.value)} placeholder="Abnormal Note (optional)" className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm" />
                <label className="flex min-h-12 items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-black text-amber-900"><input type="checkbox" checked={lostCard} onChange={event => setLostCard(event.target.checked)} className="h-5 w-5" /> Card Not Returned / Lost Card</label>
                {lostCard && <textarea required value={lostCardReason} onChange={event => setLostCardReason(event.target.value)} placeholder="Lost Card Note *" className="w-full rounded-xl border-2 border-amber-400 bg-white p-3 text-sm" />}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
                >
                  {loading ? 'กำลังปิดรายการ...' : 'ยืนยันรถออกและปิดรายการ (Confirm Vehicle Exit)'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={showExitModal}
        title="ยืนยันบันทึกรถออก"
        message={`Vehicle Plate: ${selectedExitVehicle?.vehicle_plate}\nParking Card: ${selectedExitVehicle?.card_number}\nEntry Time: ${selectedExitVehicle?.entry_time ? new Date(selectedExitVehicle.entry_time).toLocaleString('th-TH') : '-'}\nCurrent Time: ${new Date().toLocaleString('th-TH')}\n\nThis will close the active transaction${lostCard ? ' and mark the card Lost' : ' and release the card'}.`}
        confirmText="ยืนยันบันทึกออก"
        cancelText="ยกเลิก"
        onConfirm={handleConfirmExit}
        onCancel={() => setShowExitModal(false)}
      />
    </div>
  );
}
