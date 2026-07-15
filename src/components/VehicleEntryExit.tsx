/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Car, Search, Check, AlertTriangle, ShieldAlert,
  ArrowUpRight, ArrowDownLeft, Camera, ShieldX, HelpCircle,
  Home, X, Clock, Sparkles, AlertCircle, Building, Phone, User
} from 'lucide-react';
import { readSheet, appendSheetRow, updateSheetRow, uploadImageToDrive } from '../googleApi';
import { VehicleLogRecord, ParkingCardRecord, BlacklistRecord, UnitRecord } from '../types';
import QRScanner from './QRScanner';
import ConfirmModal from './ConfirmModal';
import { UnitSearchSelect } from './UnitSearchSelect';
import { collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface VehicleEntryExitProps {
  guardName: string;
}

const safeText = (value: any) => String(value ?? '');

const formatThaiDateTime = (value: any) => {
  const text = safeText(value);
  if (!text) return '-';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('th-TH');
};

const formatThaiTime = (value: any) => {
  const text = safeText(value);
  if (!text) return '-';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
};

function withTimeout<T>(promise: Promise<T>, ms: number = 15000, errorMessage = 'Operation timed out'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export default function VehicleEntryExit({ guardName }: VehicleEntryExitProps) {
  const [activeTab, setActiveTab] = useState<'entry' | 'exit'>('entry');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Exit Confirmation Modal State
  const [showExitModal, setShowExitModal] = useState(false);

  // Blacklist
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const [blacklistWarning, setBlacklistWarning] = useState<string | null>(null);

  // Entry Form State
  const [entryForm, setEntryForm] = useState<{
    card_number: string;
    vehicle_plate: string;
    vehicle_type: any;
    visitor_name: string;
    visitor_phone: string;
    target_room: string;
    purpose: string;
    note: string;
    visitor_category: string;
    abnormal_note: string;
    target_unit_id?: string;
    unit_lookup_status?: 'matched' | 'manual';
  }>({
    card_number: '',
    vehicle_plate: '',
    vehicle_type: 'รถยนต์' as any,
    visitor_name: '',
    visitor_phone: '',
    target_room: '',
    purpose: 'เยี่ยมญาติ',
    note: '',
    visitor_category: 'ผู้มาติดต่อ',
    abnormal_note: '',
    target_unit_id: '',
    unit_lookup_status: undefined
  });
  const [entryPlatePhoto, setEntryPlatePhoto] = useState<string>('');
  const [entryVehiclePhoto, setEntryVehiclePhoto] = useState<string>('');
  const [showQRScanner, setShowQRScanner] = useState(false);

  // Searchable Unit State
  const [units, setUnits] = useState<UnitRecord[]>([]);
  const [unitSearchQuery, setUnitSearchQuery] = useState('');
  const [showUnitDropdown, setShowUnitDropdown] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<UnitRecord | null>(null);

  // Two-Guard Workflow State
  const [selectedPendingLog, setSelectedPendingLog] = useState<VehicleLogRecord | null>(null);

  // Exit Form State
  const [parkedVehicles, setParkedVehicles] = useState<VehicleLogRecord[]>([]);
  const [exitSearchQuery, setExitSearchQuery] = useState('');
  const [selectedExitVehicle, setSelectedExitVehicle] = useState<VehicleLogRecord | null>(null);
  const [exitPlatePhoto, setExitPlatePhoto] = useState<string>('');
  const [exitVehiclePhoto, setExitVehiclePhoto] = useState<string>('');
  const [showExitQRScanner, setShowExitQRScanner] = useState(false);

  // Active Abnormal Note editing
  const [activeAbnormalNote, setActiveAbnormalNote] = useState('');
  const [updatingAbnormal, setUpdatingAbnormal] = useState(false);

  // Lost Card Mode State
  const [isLostCardExit, setIsLostCardExit] = useState(false);
  const [lostCardNote, setLostCardNote] = useState('');

  useEffect(() => {
    fetchInitialData();
  }, [activeTab]);

  const fetchInitialData = async () => {
    setLoading(true);
    setPageError(null);
    console.log('[VehicleEntryExit] loading data');
    try {
      const blList = await readSheet<BlacklistRecord>('Blacklist');
      console.log('[VehicleEntryExit] blacklist loaded', blList?.length);
      const allVehicles = await readSheet<VehicleLogRecord>('VehicleLogs');
      console.log('[VehicleEntryExit] vehicle logs loaded', allVehicles?.length);
      const unList = await readSheet<UnitRecord>('Units');
      console.log('[VehicleEntryExit] units loaded', unList?.length);
      
      setBlacklist((blList || []).filter(b => b && b.status === 'Active'));
      setParkedVehicles((allVehicles || []).filter(v => v && v.status === 'กำลังจอด'));
      setUnits(unList || []);
    } catch (err: any) {
      console.error('[VehicleEntryExit] error:', err);
      setPageError(err.message || String(err));
    } finally {
      setLoading(false);
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
      b &&
      safeText(b.type) === 'ทะเบียนรถ' && 
      b.vehicle_plate && 
      safeText(plate).replace(/\s+/g, '').includes(safeText(b.vehicle_plate).replace(/\s+/g, ''))
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

  const handleQRScanSuccess = (code: string) => {
    // Check if code contains prefix or is card number
    const cardNumber = code.replace('_QR', '').trim();
    setEntryForm(prev => ({ ...prev, card_number: cardNumber }));
    setShowQRScanner(false);
  };

  const handleExitQRScanSuccess = (code: string) => {
    const cleanCard = code.replace('_QR', '').trim();
    const found = parkedVehicles.find(v => 
      (v.card_number || '').toLowerCase() === cleanCard.toLowerCase() ||
      (v.vehicle_plate || '').toLowerCase() === cleanCard.toLowerCase()
    );
    if (found) {
      setSelectedExitVehicle(found);
      setShowExitQRScanner(false);
      setStatusMessage(null);
    } else {
      setStatusMessage({ type: 'error', text: `ไม่พบประวัติรถที่ยังจอดอยู่ในโครงการสำหรับเลขบัตร/ทะเบียน: ${cleanCard}` });
      setShowExitQRScanner(false);
    }
  };

  const handleEntrySubmit = async (e: React.FormEvent, mode: 'quick' | 'full') => {
    e.preventDefault();
    
    // Validations based on mode/step
    if (selectedPendingLog) {
      if (!entryForm.vehicle_plate) {
        setStatusMessage({ type: 'error', text: 'กรุณากรอกเลขทะเบียนรถสำหรับการบันทึกแบบสมบูรณ์' });
        return;
      }
      if (!selectedUnit) {
        setStatusMessage({ type: 'error', text: 'กรุณาเลือกข้อมูลยูนิตห้องพักอาศัยก่อนบันทึกแบบสมบูรณ์' });
        return;
      }
    } else {
      if (!entryForm.card_number) {
        setStatusMessage({ type: 'error', text: 'กรุณากรอกเลขบัตรจอดรถ' });
        return;
      }
      if (mode === 'full' && !entryForm.vehicle_plate) {
        setStatusMessage({ type: 'error', text: 'กรุณากรอกเลขทะเบียนรถสำหรับการบันทึกเต็มรูปแบบ' });
        return;
      }
      if (mode === 'full' && !selectedUnit) {
        setStatusMessage({ type: 'error', text: 'กรุณาเลือกข้อมูลยูนิตห้องพักอาศัยก่อนบันทึกแบบสมบูรณ์' });
        return;
      }
    }

    // Prevent double active job with the same card
    if (!selectedPendingLog) {
      const cardNumToCheck = entryForm.card_number;
      const alreadyParked = parkedVehicles.some(v => v.card_number.toLowerCase() === cardNumToCheck.toLowerCase());
      if (alreadyParked) {
        setStatusMessage({ type: 'error', text: `ไม่สามารถเปิดงานเข้าซ้ำได้: บัตรจอดรถหมายเลข "${cardNumToCheck}" มีรายการกำลังจอดค้างอยู่ในระบบแล้ว` });
        return;
      }
    }

    setLoading(true);
    setStatusMessage(null);
    console.log('[VehicleEntryExit] submit started, mode:', mode);

    try {
      let platePhotoUrl = '';
      let vehiclePhotoUrl = '';

      // Upload photos if present (either during full new entry or completion)
      if (mode === 'full' || selectedPendingLog) {
        if (entryPlatePhoto) {
          console.log('[VehicleEntryExit] uploading entry plate photo');
          try {
            platePhotoUrl = await withTimeout(
              uploadImageToDrive(entryPlatePhoto, `plate_in_${entryForm.vehicle_plate}_${Date.now()}.jpg`),
              12000,
              'ดาวน์โหลดรูปภาพป้ายทะเบียนล้มเหลวเนื่องจากหมดเวลา'
            );
          } catch (uploadErr: any) {
            console.warn('[VehicleEntryExit] entry plate photo upload error:', uploadErr);
            setStatusMessage({ type: 'error', text: `ไม่สามารถอัปโหลดรูปภาพทะเบียนได้ (ดำเนินการต่อโดยไม่มีภาพถ่าย): ${uploadErr.message || uploadErr}` });
          }
        }
        if (entryVehiclePhoto) {
          console.log('[VehicleEntryExit] uploading entry vehicle photo');
          try {
            vehiclePhotoUrl = await withTimeout(
              uploadImageToDrive(entryVehiclePhoto, `vehicle_in_${entryForm.vehicle_plate}_${Date.now()}.jpg`),
              12000,
              'ดาวน์โหลดรูปภาพรถยนต์ล้มเหลวเนื่องจากหมดเวลา'
            );
          } catch (uploadErr: any) {
            console.warn('[VehicleEntryExit] entry vehicle photo upload error:', uploadErr);
            setStatusMessage({ type: 'error', text: `ไม่สามารถอัปโหลดรูปภาพรถยนต์ได้ (ดำเนินการต่อโดยไม่มีภาพถ่าย): ${uploadErr.message || uploadErr}` });
          }
        }
      }

      const nowStr = new Date().toISOString();
      let logId = '';

      if (selectedPendingLog) {
        // --- Scenario 1: COMPLETE PENDING LOG (Guard 2 completion) ---
        logId = selectedPendingLog.log_id;
        
        console.log('[Smart Guard Entry Completion]', {
          log_id: logId,
          card_number: selectedPendingLog.card_number,
          vehicle_plate: entryForm.vehicle_plate,
          vehicle_type: entryForm.vehicle_type,
          visitor_name: entryForm.visitor_name,
          visitor_phone: entryForm.visitor_phone,
          visitor_category: entryForm.visitor_category,
          target_unit_id: selectedUnit?.unit_id || '',
          target_room: selectedUnit?.room_number || '',
          purpose: entryForm.purpose,
          note: entryForm.note,
          abnormal_note: entryForm.abnormal_note,
          entry_plate_photo_url: platePhotoUrl || selectedPendingLog.entry_plate_photo_url || '',
          entry_vehicle_photo_url: vehiclePhotoUrl || selectedPendingLog.entry_vehicle_photo_url || ''
        });

        await withTimeout(
          updateSheetRow<VehicleLogRecord>('VehicleLogs', 'log_id', logId, {
            vehicle_plate: entryForm.vehicle_plate,
            vehicle_type: entryForm.vehicle_type,
            visitor_name: entryForm.visitor_name,
            visitor_phone: entryForm.visitor_phone,
            target_unit_id: selectedUnit?.unit_id || '',
            target_room: selectedUnit?.room_number || '',
            purpose: entryForm.purpose,
            visitor_category: entryForm.visitor_category,
            entry_plate_photo_url: platePhotoUrl || selectedPendingLog.entry_plate_photo_url || '',
            entry_vehicle_photo_url: vehiclePhotoUrl || selectedPendingLog.entry_vehicle_photo_url || '',
            workflow_status: 'completed',
            note: entryForm.note,
            abnormal_note: entryForm.abnormal_note,
            updated_at: nowStr
          }),
          15000,
          'บันทึกข้อมูลรถเข้าล้มเหลวเนื่องจากหมดเวลา'
        );

        // Update ParkingCard current_vehicle_plate
        console.log('[VehicleEntryExit] updating parkingCard plate on completion');
        try {
          const q = query(collection(db, 'parkingCards'), where('card_number', '==', selectedPendingLog.card_number));
          const querySnapshot = await withTimeout(getDocs(q), 10000, 'ค้นหาบัตรจอดรถหมดเวลา');
          if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            await withTimeout(
              updateDoc(docSnap.ref, {
                current_vehicle_plate: entryForm.vehicle_plate,
                updated_at: nowStr
              }),
              10000,
              'อัปเดตทะเบียนในบัตรหมดเวลา'
            );
          }
        } catch (err: any) {
          console.warn('[VehicleEntryExit] Could not update card status on completion:', err);
        }

      } else {
        // --- Scenario 2: NEW ENTRY (Quick or Full) ---
        logId = 'V' + Math.floor(Math.random() * 1000000);
        
        let cardIdFromDb = '';
        let qrCodeValueFromDb = '';
        
        // Query card details to populate card_id and qr_code_value correctly
        try {
          const q = query(collection(db, 'parkingCards'), where('card_number', '==', entryForm.card_number));
          const querySnapshot = await withTimeout(getDocs(q), 10000, 'ค้นหาบัตรจอดรถหมดเวลา');
          if (!querySnapshot.empty) {
            const cardData = querySnapshot.docs[0].data();
            cardIdFromDb = cardData.card_id || '';
            qrCodeValueFromDb = cardData.qr_code_value || '';
          } else {
            cardIdFromDb = 'CARD_' + entryForm.card_number;
            qrCodeValueFromDb = entryForm.card_number + '_QR';
          }
        } catch (err) {
          console.warn('[VehicleEntryExit] failed to query card, using fallback:', err);
          cardIdFromDb = 'CARD_' + entryForm.card_number;
          qrCodeValueFromDb = entryForm.card_number + '_QR';
        }

        console.log('[Smart Guard Quick Entry]', {
          card_number: entryForm.card_number,
          card_id: cardIdFromDb,
          qr_code_value: qrCodeValueFromDb,
          log_id: logId,
          entry_time: nowStr,
          operator_name: sessionStorage.getItem('selected_operator_name') || guardName,
          login_email: auth.currentUser?.email || sessionStorage.getItem('selected_login_email') || ''
        });
        
        const newLog: VehicleLogRecord = {
          log_id: logId,
          card_id: cardIdFromDb,
          card_number: entryForm.card_number,
          qr_code_value: qrCodeValueFromDb,
          vehicle_plate: mode === 'full' ? entryForm.vehicle_plate : '',
          vehicle_type: mode === 'full' ? entryForm.vehicle_type : 'รถยนต์',
          visitor_name: mode === 'full' ? entryForm.visitor_name : '',
          visitor_phone: mode === 'full' ? entryForm.visitor_phone : '',
          target_room: mode === 'full' ? (selectedUnit?.room_number || '') : '',
          target_unit_id: mode === 'full' ? (selectedUnit?.unit_id || '') : '',
          unit_lookup_status: mode === 'full' ? entryForm.unit_lookup_status : undefined,
          purpose: mode === 'full' ? entryForm.purpose : '',
          visitor_category: mode === 'full' ? entryForm.visitor_category : '',
          entry_time: nowStr,
          entry_plate_photo_url: platePhotoUrl,
          entry_vehicle_photo_url: vehiclePhotoUrl,
          status: 'กำลังจอด',
          workflow_status: mode === 'quick' ? 'opened' : 'completed',
          recorded_by: guardName,
          note: entryForm.note,
          abnormal_note: '',
          created_at: nowStr,
          updated_at: nowStr,
          login_email: auth.currentUser?.email || sessionStorage.getItem('selected_login_email') || '',
          operator_name: sessionStorage.getItem('selected_operator_name') || guardName
        };

        await withTimeout(
          appendSheetRow('VehicleLogs', newLog),
          15000,
          'บันทึกข้อมูลรถเข้า (VehicleLogs) ล้มเหลวเนื่องจากหมดเวลา'
        );

        // Update ParkingCard Status
        console.log('[VehicleEntryExit] updating parkingCards');
        try {
          const q = query(collection(db, 'parkingCards'), where('card_number', '==', entryForm.card_number));
          const querySnapshot = await withTimeout(getDocs(q), 10000, 'ค้นหาบัตรจอดรถหมดเวลา');
          if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            await withTimeout(
              updateDoc(docSnap.ref, {
                status: 'ใช้งานอยู่',
                current_vehicle_log_id: logId,
                current_vehicle_plate: mode === 'full' ? entryForm.vehicle_plate : '',
                updated_at: nowStr
              }),
              10000,
              'อัปเดตสถานะบัตรหมดเวลา'
            );
          } else {
            console.warn(`[VehicleEntryExit] parking card with card_number ${entryForm.card_number} not found`);
          }
        } catch (err: any) {
          console.warn('[VehicleEntryExit] Could not update card status:', err);
        }
      }

      // Add audit log
      console.log('[VehicleEntryExit] writing auditLogs');
      try {
        await withTimeout(
          appendSheetRow('AuditLogs', {
            audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
            user_name: guardName,
            action: selectedPendingLog ? 'ระบุข้อมูลผู้มาติดต่อเพิ่ม' : (mode === 'quick' ? 'เปิดใบเข้าด่วน' : 'บันทึกรถเข้าอาคารแบบเต็ม'),
            module_name: 'VehicleLogs',
            record_id: logId,
            old_value: '',
            new_value: entryForm.vehicle_plate,
            created_at: nowStr
          }),
          5000,
          'บันทึกประวัติการใช้งาน (AuditLogs) หมดเวลา'
        );
      } catch (err: any) {
        console.warn('[VehicleEntryExit] Could not write audit log:', err);
      }

      console.log('[VehicleEntryExit] submit success');
      const successText = selectedPendingLog 
        ? `ระบุรายละเอียดผู้มาติดต่อเรียบร้อยแล้ว!` 
        : (mode === 'quick' ? 'เปิดงานรถเข้าแล้ว รอกรอกข้อมูลรถ' : `บันทึกรถเข้าสำเร็จ! เลขทะเบียน: ${entryForm.vehicle_plate}`);
      
      setStatusMessage({ type: 'success', text: successText });
      
      // Reset
      setEntryForm({
        card_number: '',
        vehicle_plate: '',
        vehicle_type: 'รถยนต์',
        visitor_name: '',
        visitor_phone: '',
        target_room: '',
        purpose: 'เยี่ยมญาติ',
        note: '',
        visitor_category: 'ผู้มาติดต่อ',
        abnormal_note: '',
        target_unit_id: '',
        unit_lookup_status: undefined
      });
      setEntryPlatePhoto('');
      setEntryVehiclePhoto('');
      setSelectedUnit(null);
      setUnitSearchQuery('');
      setSelectedPendingLog(null);
      setBlacklistWarning(null);
      fetchInitialData();
    } catch (err: any) {
      console.log('[VehicleEntryExit] submit error');
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAbnormalNoteOnly = async () => {
    if (!selectedExitVehicle) return;
    setUpdatingAbnormal(true);
    try {
      const nowStr = new Date().toISOString();
      await withTimeout(
        updateSheetRow<VehicleLogRecord>('VehicleLogs', 'log_id', selectedExitVehicle.log_id, {
          abnormal_note: activeAbnormalNote,
          updated_at: nowStr
        }),
        10000,
        'บันทึกเหตุผิดปกติหมดเวลา'
      );
      
      // Update local state
      setParkedVehicles(prev => prev.map(v => 
        v.log_id === selectedExitVehicle.log_id 
          ? { ...v, abnormal_note: activeAbnormalNote, updated_at: nowStr } 
          : v
      ));
      setSelectedExitVehicle(prev => prev ? { ...prev, abnormal_note: activeAbnormalNote, updated_at: nowStr } : null);
      
      // Add audit log
      try {
        await appendSheetRow('AuditLogs', {
          audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
          user_name: guardName,
          action: 'อัปเดตเหตุผิดปกติระหว่างจอด',
          module_name: 'VehicleLogs',
          record_id: selectedExitVehicle.log_id,
          old_value: selectedExitVehicle.abnormal_note || '',
          new_value: activeAbnormalNote,
          created_at: nowStr
        });
      } catch (e) {
        console.warn(e);
      }
      
      setStatusMessage({ type: 'success', text: 'บันทึกเหตุการณ์ผิดปกติระหว่างจอดสำเร็จ!' });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `บันทึกไม่สำเร็จ: ${err.message || err}` });
    } finally {
      setUpdatingAbnormal(false);
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
        try {
          exitPlateUrl = await withTimeout(
            uploadImageToDrive(exitPlatePhoto, `plate_out_${selectedExitVehicle.vehicle_plate}_${Date.now()}.jpg`),
            12000,
            'ดาวน์โหลดรูปภาพป้ายทะเบียนขาออกล้มเหลวเนื่องจากหมดเวลา'
          );
        } catch (uploadErr: any) {
          console.warn('[VehicleEntryExit] exit plate photo upload error, continuing without photo:', uploadErr);
          setStatusMessage({ type: 'error', text: `ไม่สามารถอัปโหลดรูปภาพทะเบียนได้ (ดำเนินการบันทึกข้อมูลรถออกต่อโดยไม่มีภาพถ่าย): ${uploadErr.message || uploadErr}` });
        }
      }
      if (exitVehiclePhoto) {
        try {
          exitVehicleUrl = await withTimeout(
            uploadImageToDrive(exitVehiclePhoto, `vehicle_out_${selectedExitVehicle.vehicle_plate}_${Date.now()}.jpg`),
            12000,
            'ดาวน์โหลดรูปภาพรถยนต์ขาออกล้มเหลวเนื่องจากหมดเวลา'
          );
        } catch (uploadErr: any) {
          console.warn('[VehicleEntryExit] exit vehicle photo upload error, continuing without photo:', uploadErr);
          setStatusMessage({ type: 'error', text: `ไม่สามารถอัปโหลดรูปภาพรถยนต์ได้ (ดำเนินการบันทึกข้อมูลรถออกต่อโดยไม่มีภาพถ่าย): ${uploadErr.message || uploadErr}` });
        }
      }

      const nowStr = new Date().toISOString();

      // Update Vehicle Log to OUT
      await withTimeout(
        updateSheetRow<VehicleLogRecord>('VehicleLogs', 'log_id', selectedExitVehicle.log_id, {
          exit_time: nowStr,
          exit_plate_photo_url: exitPlateUrl,
          exit_vehicle_photo_url: exitVehicleUrl,
          status: 'ออกแล้ว',
          lost_card: isLostCardExit ? true : undefined,
          lost_card_note: isLostCardExit ? lostCardNote : undefined,
          updated_at: nowStr
        }),
        15000,
        'บันทึกข้อมูลรถออก (VehicleLogs) ล้มเหลวเนื่องจากหมดเวลา'
      );

      // Update Parking Card to Available (or Suspended if lost)
      try {
        const q = query(collection(db, 'parkingCards'), where('card_number', '==', selectedExitVehicle.card_number));
        const querySnapshot = await withTimeout(getDocs(q), 10000, 'ค้นหาบัตรจอดรถหมดเวลา');
        if (!querySnapshot.empty) {
          const docSnap = querySnapshot.docs[0];
          await withTimeout(
            updateDoc(docSnap.ref, {
              status: isLostCardExit ? 'ระงับ' : 'ว่าง',
              current_vehicle_plate: '',
              updated_at: nowStr
            }),
            10000,
            'อัปเดตสถานะบัตรหมดเวลา'
          );
        } else {
          console.warn(`[VehicleEntryExit] parking card with card_number ${selectedExitVehicle.card_number} not found`);
        }
      } catch (err) {
        console.warn('[VehicleEntryExit] Card card_number not found in database', err);
      }

      // Add audit log
      try {
        await withTimeout(
          appendSheetRow('AuditLogs', {
            audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
            user_name: guardName,
            action: isLostCardExit ? 'บันทึกรถออก (บัตรสูญหาย)' : 'บันทึกรถออกอาคาร',
            module_name: 'VehicleLogs',
            record_id: selectedExitVehicle.log_id,
            old_value: 'กำลังจอด',
            new_value: 'ออกแล้ว',
            created_at: nowStr
          }),
          5000,
          'บันทึกประวัติการใช้งาน (AuditLogs) หมดเวลา'
        );
      } catch (err) {
        console.warn('[VehicleEntryExit] Could not write audit log:', err);
      }

      const successText = isLostCardExit
        ? `บันทึกรถออก (กรณีบัตรสูญหาย) สำเร็จ! ทะเบียน: ${selectedExitVehicle.vehicle_plate}`
        : `บันทึกรถออกเสร็จสมบูรณ์! ทะเบียน: ${selectedExitVehicle.vehicle_plate}`;
      setStatusMessage(prev => prev && prev.type === 'error' ? { type: 'success', text: `${prev.text} | แต่ ${successText}` } : { type: 'success', text: successText });
      
      setSelectedExitVehicle(null);
      setExitPlatePhoto('');
      setExitVehiclePhoto('');
      setIsLostCardExit(false);
      setLostCardNote('');
      fetchInitialData();
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  const filteredParked = parkedVehicles.filter(v => {
    const q = safeText(exitSearchQuery).toLowerCase();
    return (
      safeText(v.vehicle_plate).toLowerCase().includes(q) ||
      safeText(v.card_number).toLowerCase().includes(q) ||
      safeText(v.visitor_name).toLowerCase().includes(q)
    );
  });

  if (pageError) {
    return (
      <div className="w-full max-w-4xl mx-auto p-6 bg-red-50 border border-red-200 rounded-2xl flex flex-col gap-4 text-center mt-5">
        <ShieldAlert className="w-12 h-12 text-red-500 mx-auto animate-bounce" />
        <h3 className="text-lg font-black text-red-800">เกิดข้อผิดพลาดในการโหลดข้อมูล</h3>
        <p className="text-sm text-slate-600 font-mono bg-white p-4 rounded-xl border border-red-100 break-all whitespace-pre-wrap">
          {pageError}
        </p>
        <button
          onClick={fetchInitialData}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all cursor-pointer text-sm w-fit mx-auto shadow-sm"
        >
          ลองใหม่อีกครั้ง
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-5 px-1 pb-10">
      
      {/* Tab Switcher */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
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
          type="button"
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
          <Check className="w-5 h-5 shrink-0" />
          <span>{statusMessage.text}</span>
        </div>
      )}

      {activeTab === 'entry' ? (
        <div className="flex flex-col gap-6">
          
          {/* Two-Guard Workflow: Pending Logs List */}
          {parkedVehicles.filter(v => v.workflow_status === 'opened').length > 0 && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-black text-amber-800 uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-4 h-4 text-amber-600 animate-pulse" />
                  มีรายการเดินรถเข้าด่วน ที่รอกรอกประวัติผู้มาติดต่อ ({parkedVehicles.filter(v => v.workflow_status === 'opened').length} คัน)
                </span>
                <span className="text-[10px] bg-amber-200 text-amber-900 font-bold px-2.5 py-0.5 rounded-full">
                  Guard 1 ได้เปิดบัตรไว้แล้ว
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {parkedVehicles
                  .filter(v => v.workflow_status === 'opened')
                  .map(v => (
                    <div
                      key={v.log_id}
                      onClick={() => {
                        setSelectedPendingLog(v);
                        setEntryForm({
                          card_number: v.card_number || '',
                          vehicle_plate: v.vehicle_plate || '',
                          vehicle_type: v.vehicle_type || 'รถยนต์',
                          visitor_name: v.visitor_name || '',
                          visitor_phone: v.visitor_phone || '',
                          target_room: v.target_room || '',
                          purpose: v.purpose || 'เยี่ยมญาติ',
                          note: v.note || '',
                          visitor_category: v.visitor_category || 'ผู้มาติดต่อ',
                          abnormal_note: v.abnormal_note || ''
                        });
                        setSelectedUnit(null);
                        setUnitSearchQuery('');
                        // Clear photos
                        setEntryPlatePhoto('');
                        setEntryVehiclePhoto('');
                      }}
                      className={`p-3.5 border rounded-xl cursor-pointer transition-all flex flex-col gap-1.5 ${
                        selectedPendingLog?.log_id === v.log_id
                          ? 'bg-amber-100 border-amber-400 shadow-md ring-2 ring-amber-400'
                          : 'bg-white hover:bg-amber-50 border-amber-200'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded font-mono">
                          บัตร: {v.card_number}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {formatThaiTime(v.entry_time)} น.
                        </span>
                      </div>
                      <span className="text-sm font-black text-slate-800 block">
                        ทะเบียน: {v.vehicle_plate || '(ยังไม่ระบุ)'}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        ประเภท: {v.vehicle_type}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Main Entry Form Container */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-6">
            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-black text-slate-800 flex items-center gap-1.5">
                  <Car className="w-5 h-5 text-indigo-600" />
                  {selectedPendingLog ? 'กรอกข้อมูลผู้มาติดต่อค้างบันทึก (Step 2)' : 'บันทึกประวัติผู้ขับขี่และยานพาหนะเข้าพื้นที่'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedPendingLog 
                    ? 'ดำเนินการระบุยูนิตเป้าหมายและข้อมูลบุคคลเพื่อปิดจบเอกสารรถเข้า' 
                    : 'แสกนคิวอาร์หรือพิมพ์บัตรจอดรถเพื่อทำรายการเปิดบันทึกรถเข้า'}
                </p>
              </div>
              
              {!selectedPendingLog && (
                <button
                  type="button"
                  onClick={() => setShowQRScanner(!showQRScanner)}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-all cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  สแกน QR บัตรจอดรถ
                </button>
              )}
            </div>

            {selectedPendingLog && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-600 shrink-0" />
                  <span className="text-xs font-bold">
                    กำลังระบุข้อมูลเพิ่มเติมของทะเบียน: <span className="underline font-black text-slate-900 font-mono">{selectedPendingLog.vehicle_plate || '(รอกรอกทะเบียน)'}</span> (บัตรหมายเลข: {selectedPendingLog.card_number})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPendingLog(null);
                    setEntryForm({
                      card_number: '',
                      vehicle_plate: '',
                      vehicle_type: 'รถยนต์',
                      visitor_name: '',
                      visitor_phone: '',
                      target_room: '',
                      purpose: 'เยี่ยมญาติ',
                      note: '',
                      visitor_category: 'ผู้มาติดต่อ',
                      abnormal_note: ''
                    });
                    setSelectedUnit(null);
                    setUnitSearchQuery('');
                  }}
                  className="text-xs font-bold text-amber-950 hover:underline flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-amber-300 cursor-pointer shadow-xs"
                >
                  <X className="w-4 h-4" /> ยกเลิกเลือกคันนี้
                </button>
              </div>
            )}

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

            <form onSubmit={(e) => handleEntrySubmit(e, 'full')} className="flex flex-col gap-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Card Number */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600">หมายเลขบัตรจอดรถ *</label>
                  <input
                    type="text"
                    value={entryForm.card_number}
                    onChange={(e) => setEntryForm(prev => ({ ...prev, card_number: e.target.value }))}
                    placeholder="เช่น P001"
                    className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold font-mono bg-slate-50 disabled:text-slate-400"
                    required
                    disabled={!!selectedPendingLog}
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
                    className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold bg-slate-50"
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
                    <option value="รถบรรทุก">🚚 รถบรรทุก/ส่งของ</option>
                    <option value="อื่นๆ">❓ อื่นๆ</option>
                  </select>
                </div>

                {/* Visitor Name */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600">ชื่อผู้มาติดต่อ *</label>
                  <input
                    type="text"
                    value={entryForm.visitor_name}
                    onChange={(e) => setEntryForm(prev => ({ ...prev, visitor_name: e.target.value }))}
                    placeholder="เช่น สมชาย ใจดี"
                    className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                    required
                  />
                </div>

                {/* Visitor Phone */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600">เบอร์โทรศัพท์ผู้ติดต่อ *</label>
                  <input
                    type="text"
                    value={entryForm.visitor_phone}
                    onChange={(e) => setEntryForm(prev => ({ ...prev, visitor_phone: e.target.value }))}
                    placeholder="เช่น 0812345678"
                    className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold font-mono"
                    required
                  />
                </div>

                 {/* Searchable Unit Selector */}
                 <div className="flex flex-col gap-1.5 relative">
                   <UnitSearchSelect
                     value={unitSearchQuery}
                     selectedUnitId={selectedUnit?.unit_id}
                     allowManualEntry={true}
                     label="ยูนิตห้องที่มาติดต่อ"
                     placeholder="พิมพ์เพื่อค้นหาเลขห้อง, เจ้าของ หรือเบอร์โทร..."
                     required={true}
                     onSelect={(unit) => {
                       if (unit) {
                         setSelectedUnit(unit);
                         setEntryForm(prev => ({
                           ...prev,
                           target_room: unit.room_number,
                           target_unit_id: unit.unit_id || '',
                           unit_lookup_status: unit.unit_id ? 'matched' : 'manual'
                         }));
                         setUnitSearchQuery(unit.unit_id ? `ห้อง ${unit.room_number} (คุณ ${unit.owner_name || 'ไม่ทราบชื่อ'})` : unit.room_number);
                       } else {
                         setSelectedUnit(null);
                         setEntryForm(prev => ({
                           ...prev,
                           target_room: '',
                           target_unit_id: '',
                           unit_lookup_status: undefined
                         }));
                         setUnitSearchQuery('');
                       }
                     }}
                   />
                 </div>

                {/* Purpose */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600">วัตถุประสงค์ติดต่อ</label>
                  <select
                    value={entryForm.purpose}
                    onChange={(e) => setEntryForm(prev => ({ ...prev, purpose: e.target.value }))}
                    className="p-3.5 border-2 border-slate-200 rounded-xl outline-none bg-white focus:border-indigo-600 text-sm font-semibold"
                  >
                    <option value="พักอาศัย">🏠 พักอาศัย</option>
                    <option value="เยี่ยมญาติ">👥 เยี่ยมญาติ</option>
                    <option value="ส่งอาหาร/พัสดุ">📦 ส่งอาหาร/พัสดุ</option>
                    <option value="ซ่อมแซมห้องพัก">🛠️ ซ่อมแซมห้องพัก</option>
                    <option value="ติดต่อนิติบุคคล">🏢 ติดต่อนิติบุคคล</option>
                    <option value="อื่นๆ">❓ อื่นๆ</option>
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

                {/* Abnormal Note */}
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-xs font-bold text-slate-600">รายละเอียดเพิ่มเติม / เหตุผิดปกติระหว่างจอด</label>
                  <textarea
                    value={entryForm.abnormal_note || ''}
                    onChange={(e) => setEntryForm(prev => ({ ...prev, abnormal_note: e.target.value }))}
                    placeholder="ระบุรายละเอียดเพิ่มเติม หรือเหตุการณ์ผิดปกติระหว่างจอดรถ (ถ้ามี)"
                    className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold h-20 resize-none"
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
                      <img src={entryPlatePhoto} alt="License plate" className="h-full w-full object-cover rounded-lg" />
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
                      <img src={entryVehiclePhoto} alt="Vehicle context" className="h-full w-full object-cover rounded-lg" />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-slate-400">
                        <Camera className="w-8 h-8" />
                        <span className="text-xs font-bold">กดเพื่อใช้กล้องถ่ายรูปสภาพรถ</span>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              {selectedPendingLog ? (
                <button
                  type="button"
                  onClick={(e) => handleEntrySubmit(e, 'full')}
                  disabled={loading}
                  className="mt-4 w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer text-sm flex justify-center items-center gap-2"
                >
                  {loading ? 'กำลังบันทึกลงฐานข้อมูล...' : (
                    <>
                      <Check className="w-5 h-5" /> 
                      💾 บันทึกรายละเอียดผู้มาติดต่อครบถ้วน (Complete Entry Log)
                    </>
                  )}
                </button>
              ) : (
                <div className="flex flex-col sm:flex-row gap-4 mt-4">
                  <button
                    type="button"
                    onClick={(e) => handleEntrySubmit(e, 'quick')}
                    disabled={loading}
                    className="flex-1 py-4 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer text-sm flex justify-center items-center gap-2"
                  >
                    <Clock className="w-5 h-5" />
                    🚗 เปิดบันทึกรถเข้าด่วน (Quick Entry)
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleEntrySubmit(e, 'full')}
                    disabled={loading}
                    className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer text-sm flex justify-center items-center gap-2"
                  >
                    <Sparkles className="w-5 h-5" />
                    ✨ บันทึกเต็มรูปแบบทันที (Full Entry)
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      ) : (
        /* EXIT TAB */
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex justify-between items-center pb-2 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-black text-slate-800">ค้นหาและบันทึกข้อมูลรถออกอาคาร (Exit Control)</h2>
              <p className="text-xs text-slate-500 mt-0.5">พิมพ์ค้นหาหรือใช้ QR สแกนเพื่อเรียกดูประวัติตัวรถที่จอดในโครงการ</p>
            </div>
            <button
              onClick={() => setShowExitQRScanner(!showExitQRScanner)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              สแกน QR บัตรขาออก
            </button>
          </div>

          {showExitQRScanner && (
            <QRScanner 
              onScanSuccess={handleExitQRScanSuccess}
              onClose={() => setShowExitQRScanner(false)}
              title="สแกนบัตรเพื่อออก"
              placeholderText="เช่น P001 หรือทะเบียนรถ"
            />
          )}
          
          <div className="relative">
            <Search className="absolute left-3.5 top-3.5 text-slate-400 w-5 h-5" />
            <input
              type="text"
              value={exitSearchQuery}
              onChange={(e) => setExitSearchQuery(e.target.value)}
              placeholder="พิมพ์ทะเบียนรถ, เลขบัตร หรือชื่อผู้มาติดต่อเพื่อค้นหา..."
              className="w-full pl-11 pr-4 py-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
            />
          </div>

          {loading && (
            <div className="py-10 text-center font-bold text-slate-500 animate-pulse text-sm">
              กำลังค้นหาข้อมูลยานพาหนะในพื้นที่...
            </div>
          )}

          {!loading && parkedVehicles.length === 0 && (
            <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
              <Car className="w-12 h-12 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-bold">ไม่มีรถยนต์จอดอยู่ในระบบ ณ ขณะนี้</p>
            </div>
          )}

          {!loading && parkedVehicles.length > 0 && !selectedExitVehicle && (
            <div className="flex flex-col gap-2.5 max-h-96 overflow-y-auto">
              {filteredParked.map((v) => (
                <div
                  key={v.log_id}
                  onClick={() => {
                    setSelectedExitVehicle(v);
                    setIsLostCardExit(false);
                    setLostCardNote('');
                  }}
                  className="flex justify-between items-center p-4 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-white border border-slate-200 rounded-xl text-slate-700 font-black font-mono text-sm">
                      {safeText(v.card_number)}
                    </div>
                    <div>
                      <span className="text-base font-black text-slate-800">{safeText(v.vehicle_plate)}</span>
                      <p className="text-xs text-slate-500 font-medium">
                        {safeText(v.vehicle_type)} • {safeText(v.visitor_name) || 'ไม่ระบุชื่อ'} • ไปยูนิตห้อง: {safeText(v.target_room) || '-'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                      v.workflow_status === 'opened' 
                        ? 'bg-amber-100 text-amber-800' 
                        : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {v.workflow_status === 'opened' ? 'เข้าด่วน (ยังไม่กรอกประวัติ)' : 'จอดปกติ'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      เข้า: {formatThaiTime(v.entry_time)} น.
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedExitVehicle && (
            <div className="border border-slate-200 rounded-xl p-5 bg-indigo-50/30 flex flex-col gap-5">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <span className="text-xs font-bold text-indigo-600 uppercase">ทำรายการรถออก (Active)</span>
                  <h3 className="text-base font-black text-slate-800">
                    บัตร: {safeText(selectedExitVehicle.card_number)} • ทะเบียน: {safeText(selectedExitVehicle.vehicle_plate)}
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setSelectedExitVehicle(null);
                    setIsLostCardExit(false);
                    setLostCardNote('');
                  }}
                  className="text-xs text-indigo-600 font-bold hover:underline cursor-pointer"
                >
                  เปลี่ยนคัน/ยกเลิก
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-semibold text-slate-600 bg-white p-4 rounded-xl border border-indigo-100">
                <div>👥 ผู้ขับขี่: <span className="font-bold text-slate-800">{safeText(selectedExitVehicle.visitor_name) || 'ไม่ระบุชื่อ'}</span></div>
                <div>📞 เบอร์โทรศัพท์: <span className="font-bold text-slate-800">{safeText(selectedExitVehicle.visitor_phone) || 'ไม่ระบุ'}</span></div>
                <div>🏢 ห้องติดต่อ: <span className="font-bold text-slate-800">{safeText(selectedExitVehicle.target_room) || '-'}</span></div>
                <div>⏱️ เวลาเข้า: <span className="font-bold text-slate-800">{formatThaiDateTime(selectedExitVehicle.entry_time)}</span></div>
              </div>

              {selectedExitVehicle.abnormal_note && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-800 flex flex-col gap-1">
                  <span>⚠️ รายละเอียดเพิ่มเติม / เหตุผิดปกติระหว่างจอด:</span>
                  <p className="font-semibold text-red-950 font-sans">{selectedExitVehicle.abnormal_note}</p>
                </div>
              )}

              {/* Abnormal note editor while parked */}
              <div className="flex flex-col gap-2 bg-white p-4 rounded-xl border border-slate-200">
                <label className="text-xs font-black text-slate-700">✏️ รายละเอียดเพิ่มเติม / เหตุผิดปกติระหว่างจอด</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={activeAbnormalNote}
                    onChange={(e) => setActiveAbnormalNote(e.target.value)}
                    placeholder="ระบุข้อความ เช่น จอดคร่อมเลน, น้ำมันรั่วซึม..."
                    className="flex-1 p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-600 text-xs font-semibold"
                  />
                  <button
                    type="button"
                    onClick={handleUpdateAbnormalNoteOnly}
                    disabled={updatingAbnormal}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {updatingAbnormal ? 'กำลังบันทึก...' : 'บันทึกเหตุ'}
                  </button>
                </div>
              </div>

              {/* Lost Card Checkbox and note form */}
              <div className="border border-amber-200 bg-amber-50/40 p-4 rounded-xl flex flex-col gap-3">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isLostCardExit}
                    onChange={(e) => setIsLostCardExit(e.target.checked)}
                    className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-black text-amber-900 block">⚠️ แจ้งกรณีบัตรจอดรถสูญหาย / ไม่มีบัตรคืนโครงการ</span>
                    <span className="text-[10px] text-amber-700">ระบบจะทำการระงับหมายเลขบัตรจอดรถนี้ทันที เพื่อความปลอดภัย</span>
                  </div>
                </label>

                {isLostCardExit && (
                  <div className="flex flex-col gap-2 border-t border-amber-200 pt-3">
                    <label className="text-xs font-black text-amber-900">
                      รายละเอียดสาเหตุการสูญหาย / ค่าปรับอนุมัติปล่อยรถ *
                    </label>
                    <textarea
                      value={lostCardNote}
                      onChange={(e) => setLostCardNote(e.target.value)}
                      placeholder="เช่น บัตรหายที่ห้าง, ชำระค่าปรับบัตรหาย 300 บาท ตามใบเสร็จเลขที่ xxxx, ได้รับอนุมัติปล่อยรถจากหัวหน้าหน้างาน..."
                      className="w-full p-2.5 border border-amber-300 rounded-lg outline-none bg-white focus:ring-2 focus:ring-amber-500 text-xs font-bold font-sans h-20 resize-none"
                      required={isLostCardExit}
                    />
                  </div>
                )}
              </div>

              <form onSubmit={handleExitSubmit} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Exit Plate Photo */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                      <Camera className="w-4 h-4 text-indigo-600" />
                      ถ่ายรูปป้ายทะเบียนรถออก (ไม่บังคับ)
                    </span>
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
                    <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                      <Camera className="w-4 h-4 text-indigo-600" />
                      ถ่ายรูปสภาพตัวรถออก (ไม่บังคับ)
                    </span>
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

                <button
                  type="submit"
                  disabled={loading || (isLostCardExit && !lostCardNote.trim())}
                  className={`w-full py-3.5 text-white font-bold rounded-xl transition-all shadow active:scale-95 disabled:opacity-50 cursor-pointer text-sm ${
                    isLostCardExit 
                      ? 'bg-amber-600 hover:bg-amber-700' 
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {loading ? 'กำลังบันทึกออกจากพื้นที่...' : (
                    isLostCardExit 
                      ? '⚠️ บันทึกรถออกจากอาคาร (กรณีบัตรสูญหาย/ระงับบัตร)' 
                      : '🚪 บันทึกรถออกจากอาคารและคืนบัตรสำเร็จ'
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={showExitModal}
        title={isLostCardExit ? '⚠️ ยืนยันปล่อยรถออก (กรณีบัตรสูญหาย)' : 'ยืนยันบันทึกรถออก'}
        message={isLostCardExit 
          ? `คุณต้องการยืนยันบันทึกรถยนต์ทะเบียน "${safeText(selectedExitVehicle?.vehicle_plate)}" ออกจากพื้นที่โครงการ โดยมีสาเหตุบัตรสูญหายหรือไม่? (คำเตือน: บัตรหมายเลข "${safeText(selectedExitVehicle?.card_number)}" จะถูกระงับการใช้งานทันที!)` 
          : `คุณต้องการยืนยันบันทึกรถยนต์ทะเบียน "${safeText(selectedExitVehicle?.vehicle_plate)}" ทำการออกจากพื้นที่โครงการและรับคืนบัตรจอดรถหมายเลข "${safeText(selectedExitVehicle?.card_number)}" หรือไม่?`
        }
        confirmText={isLostCardExit ? 'ยืนยันระงับบัตรและบันทึกออก' : 'ยืนยันบันทึกออก'}
        cancelText="ยกเลิก"
        onConfirm={handleConfirmExit}
        onCancel={() => setShowExitModal(false)}
      />
    </div>
  );
}
