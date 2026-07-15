/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Car, Search, Check, AlertTriangle, ShieldAlert,
  ArrowUpRight, ArrowDownLeft, Camera, ShieldX, HelpCircle
} from 'lucide-react';
import { readSheet, appendSheetRow, updateSheetRow, uploadImageToDrive } from '../googleApi';
import { VehicleLogRecord, ParkingCardRecord, BlacklistRecord } from '../types';
import QRScanner from './QRScanner';
import ConfirmModal from './ConfirmModal';

interface VehicleEntryExitProps {
  guardName: string;
}

export default function VehicleEntryExit({ guardName }: VehicleEntryExitProps) {
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
    purpose: 'เยี่ยมญาติ',
    note: ''
  });
  const [entryPlatePhoto, setEntryPlatePhoto] = useState<string>('');
  const [entryVehiclePhoto, setEntryVehiclePhoto] = useState<string>('');
  const [showQRScanner, setShowQRScanner] = useState(false);

  // Exit Form State
  const [parkedVehicles, setParkedVehicles] = useState<VehicleLogRecord[]>([]);
  const [exitSearchQuery, setExitSearchQuery] = useState('');
  const [selectedExitVehicle, setSelectedExitVehicle] = useState<VehicleLogRecord | null>(null);
  const [exitPlatePhoto, setExitPlatePhoto] = useState<string>('');
  const [exitVehiclePhoto, setExitVehiclePhoto] = useState<string>('');

  useEffect(() => {
    fetchInitialData();
  }, [activeTab]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [blList, allVehicles] = await Promise.all([
        readSheet<BlacklistRecord>('Blacklist'),
        readSheet<VehicleLogRecord>('VehicleLogs')
      ]);
      setBlacklist(blList.filter(b => b.status === 'Active'));
      setParkedVehicles(allVehicles.filter(v => v.status === 'กำลังจอด'));
    } catch (err) {
      console.error('Failed to load vehicle data:', err);
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

  const handleQRScanSuccess = (code: string) => {
    // Check if code contains prefix or is card number
    const cardNumber = code.replace('_QR', '').trim();
    setEntryForm(prev => ({ ...prev, card_number: cardNumber }));
    setShowQRScanner(false);
  };

  const handleEntrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryForm.card_number || !entryForm.vehicle_plate) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกเลขบัตรจอดรถและทะเบียนรถ' });
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      // 1. Upload photos if they exist
      let platePhotoUrl = '';
      let vehiclePhotoUrl = '';

      if (entryPlatePhoto) {
        platePhotoUrl = await uploadImageToDrive(entryPlatePhoto, `plate_in_${entryForm.vehicle_plate}_${Date.now()}.jpg`);
      }
      if (entryVehiclePhoto) {
        vehiclePhotoUrl = await uploadImageToDrive(entryVehiclePhoto, `vehicle_in_${entryForm.vehicle_plate}_${Date.now()}.jpg`);
      }

      const nowStr = new Date().toISOString();
      const logId = 'V' + Math.floor(Math.random() * 1000000);

      // 2. Write to VehicleLogs
      const newLog: VehicleLogRecord = {
        log_id: logId,
        card_number: entryForm.card_number,
        vehicle_plate: entryForm.vehicle_plate,
        vehicle_type: entryForm.vehicle_type,
        visitor_name: entryForm.visitor_name,
        visitor_phone: entryForm.visitor_phone,
        target_room: entryForm.target_room,
        purpose: entryForm.purpose,
        entry_time: nowStr,
        entry_plate_photo_url: platePhotoUrl,
        entry_vehicle_photo_url: vehiclePhotoUrl,
        status: 'กำลังจอด',
        recorded_by: guardName,
        note: entryForm.note,
        created_at: nowStr,
        updated_at: nowStr
      };

      await appendSheetRow('VehicleLogs', newLog);

      // 3. Update ParkingCard Status
      try {
        await updateSheetRow<ParkingCardRecord>('ParkingCards', 'card_number', entryForm.card_number, {
          status: 'ใช้งานอยู่',
          current_vehicle_plate: entryForm.vehicle_plate,
          updated_at: nowStr
        });
      } catch (err) {
        console.warn('Could not update card row. Seeding missing cards...', err);
      }

      // Add audit log
      await appendSheetRow('AuditLogs', {
        audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
        user_name: guardName,
        action: 'บันทึกรถเข้าอาคาร',
        module_name: 'VehicleLogs',
        record_id: logId,
        old_value: '',
        new_value: entryForm.vehicle_plate,
        created_at: nowStr
      });

      setStatusMessage({ type: 'success', text: `บันทึกรถเข้าสำเร็จ! เลขทะเบียน: ${entryForm.vehicle_plate}` });
      
      // Reset
      setEntryForm({
        card_number: '',
        vehicle_plate: '',
        vehicle_type: 'รถยนต์',
        visitor_name: '',
        visitor_phone: '',
        target_room: '',
        purpose: 'เยี่ยมญาติ',
        note: ''
      });
      setEntryPlatePhoto('');
      setEntryVehiclePhoto('');
      setBlacklistWarning(null);
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
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
        exitPlateUrl = await uploadImageToDrive(exitPlatePhoto, `plate_out_${selectedExitVehicle.vehicle_plate}_${Date.now()}.jpg`);
      }
      if (exitVehiclePhoto) {
        exitVehicleUrl = await uploadImageToDrive(exitVehiclePhoto, `vehicle_out_${selectedExitVehicle.vehicle_plate}_${Date.now()}.jpg`);
      }

      const nowStr = new Date().toISOString();

      // Update Vehicle Log to OUT
      await updateSheetRow<VehicleLogRecord>('VehicleLogs', 'log_id', selectedExitVehicle.log_id, {
        exit_time: nowStr,
        exit_plate_photo_url: exitPlateUrl,
        exit_vehicle_photo_url: exitVehicleUrl,
        status: 'ออกแล้ว',
        updated_at: nowStr
      });

      // Update Parking Card to Available
      try {
        await updateSheetRow<ParkingCardRecord>('ParkingCards', 'card_number', selectedExitVehicle.card_number, {
          status: 'ว่าง',
          current_vehicle_plate: '',
          updated_at: nowStr
        });
      } catch (err) {
        console.warn('Card card_number not found in database', err);
      }

      // Add audit log
      await appendSheetRow('AuditLogs', {
        audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
        user_name: guardName,
        action: 'บันทึกรถออกอาคาร',
        module_name: 'VehicleLogs',
        record_id: selectedExitVehicle.log_id,
        old_value: 'กำลังจอด',
        new_value: 'ออกแล้ว',
        created_at: nowStr
      });

      setStatusMessage({ type: 'success', text: `บันทึกรถออกเสร็จสมบูรณ์! ทะเบียน: ${selectedExitVehicle.vehicle_plate}` });
      setSelectedExitVehicle(null);
      setExitPlatePhoto('');
      setExitVehiclePhoto('');
      fetchInitialData();
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const filteredParked = parkedVehicles.filter(v => 
    v.vehicle_plate.includes(exitSearchQuery) || 
    v.card_number.includes(exitSearchQuery) ||
    v.visitor_name.includes(exitSearchQuery)
  );

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
          <Check className="w-5 h-5 shrink-0" />
          <span>{statusMessage.text}</span>
        </div>
      )}

      {activeTab === 'entry' ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-6">
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

              {/* Target Room */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ห้อง/พื้นที่มาติดต่อ *</label>
                <input
                  type="text"
                  value={entryForm.target_room}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, target_room: e.target.value }))}
                  placeholder="เช่น 101/45 ชั้น 5"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                  required
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

            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
            >
              {loading ? 'กำลังบันทึกลงฐานข้อมูล...' : '💾 ยืนยันบันทึกข้อมูลรถเข้าอาคาร'}
            </button>
          </form>
        </div>
      ) : (
        /* EXIT TAB */
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          <h2 className="text-lg font-black text-slate-800">ค้นหาและบันทึกข้อมูลรถออกอาคาร</h2>
          
          <div className="relative">
            <Search className="absolute left-3.5 top-3.5 text-slate-400 w-5 h-5" />
            <input
              type="text"
              value={exitSearchQuery}
              onChange={(e) => setExitSearchQuery(e.target.value)}
              placeholder="พิมพ์ทะเบียนรถ, เลขบัตร หรือชื่อผู้มาติดต่อเพื่อค้นหา..."
              className="w-full pl-11 pr-4 py-3 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
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
                  onClick={() => setSelectedExitVehicle(v)}
                  className="flex justify-between items-center p-4 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-white border border-slate-200 rounded-xl text-slate-700 font-black font-mono text-sm">
                      {v.card_number}
                    </div>
                    <div>
                      <span className="text-base font-black text-slate-800">{v.vehicle_plate}</span>
                      <p className="text-xs text-slate-500 font-medium">
                        {v.vehicle_type} • {v.visitor_name || 'ไม่ระบุชื่อ'} • ไปห้อง {v.target_room}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs bg-indigo-100 text-indigo-800 font-bold px-2.5 py-0.5 rounded-full">
                      จอดแล้ว
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      เข้า: {new Date(v.entry_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
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
              </div>

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

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
                >
                  {loading ? 'กำลังบันทึกออกจากพื้นที่...' : '🚪 บันทึกรถออกจากอาคารและคืนบัตรสำเร็จ'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={showExitModal}
        title="ยืนยันบันทึกรถออก"
        message={`คุณต้องการยืนยันบันทึกรถยนต์ทะเบียน "${selectedExitVehicle?.vehicle_plate}" ทำการออกจากพื้นที่โครงการและรับคืนบัตรจอดรถหมายเลข "${selectedExitVehicle?.card_number}" หรือไม่?`}
        confirmText="ยืนยันบันทึกออก"
        cancelText="ยกเลิก"
        onConfirm={handleConfirmExit}
        onCancel={() => setShowExitModal(false)}
      />
    </div>
  );
}
