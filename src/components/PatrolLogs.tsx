/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, ShieldAlert, Camera, MapPin, Check, 
  Clock, AlertTriangle, RefreshCw, Eye, X, FileText, Info
} from 'lucide-react';
import { readSheet, appendSheetRow, uploadImageToDrive } from '../googleApi';
import { PatrolLogRecord, PatrolPointRecord, IncidentReportRecord } from '../types';
import QRScanner from './QRScanner';

interface PatrolLogsProps {
  guardName: string;
}

export default function PatrolLogs({ guardName }: PatrolLogsProps) {
  const [activeTab, setActiveTab] = useState<'scan' | 'dashboard'>('scan');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Patrol Points & Logs State
  const [patrolPoints, setPatrolPoints] = useState<PatrolPointRecord[]>([]);
  const [patrolLogs, setPatrolLogs] = useState<PatrolLogRecord[]>([]);

  // QR Scanning State
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [scannedPoint, setScannedPoint] = useState<PatrolPointRecord | null>(null);

  // Point Specific History State (For Patrol Monitor)
  const [selectedPointForHistory, setSelectedPointForHistory] = useState<PatrolPointRecord | null>(null);

  // Form State - Upgraded with Sprint 1 specifications
  const [shiftType, setShiftType] = useState<'เช้า' | 'กลางคืน'>('เช้า');
  const [patrolStatus, setPatrolStatus] = useState<'ปกติ' | 'ผิดปกติ' | 'ต้องติดตาม'>('ปกติ');
  const [patrolDetail, setPatrolDetail] = useState('');
  const [abnormalDetail, setAbnormalDetail] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [createIncident, setCreateIncident] = useState(true);
  const [patrolPhoto, setPatrolPhoto] = useState('');
  const [abnormalPhoto, setAbnormalPhoto] = useState('');

  useEffect(() => {
    fetchInitialPatrolData();
  }, [activeTab]);

  const fetchInitialPatrolData = async () => {
    setLoading(true);
    try {
      const [points, logs] = await Promise.all([
        readSheet<PatrolPointRecord>('PatrolPoints'),
        readSheet<PatrolLogRecord>('PatrolLogs')
      ]);
      setPatrolPoints(points.length > 0 ? points : [
        { patrol_point_id: 'PP001', point_name: 'จุดตรวจ Lobby ชั้น 1', location_detail: 'เสาด้านหน้าทางเข้าหลักหน้าเคาน์เตอร์นิติ', qr_code_value: 'PP001_QR', required_interval_minutes: 60, status: 'Active', created_at: '', updated_at: '' },
        { patrol_point_id: 'PP002', point_name: 'จุดตรวจ ลานจอดรถ B1 เสา B12', location_detail: 'เสาโครงสร้างใกล้พัดลมดูดอากาศตัวใหญ่', qr_code_value: 'PP002_QR', required_interval_minutes: 120, status: 'Active', created_at: '', updated_at: '' },
        { patrol_point_id: 'PP003', point_name: 'จุดตรวจ ห้องควบคุมไฟฟ้าชั้น M', location_detail: 'หน้าประตูห้องควบคุมควบคุมไฟฟ้าประธาน', qr_code_value: 'PP003_QR', required_interval_minutes: 120, status: 'Active', created_at: '', updated_at: '' },
        { patrol_point_id: 'PP004', point_name: 'จุดตรวจ ดาดฟ้า ชั้น 32', location_detail: 'หน้าบานประตูกันไฟ ทางหนีทีไล่ ทิศเหนือ', qr_code_value: 'PP004_QR', required_interval_minutes: 240, status: 'Active', created_at: '', updated_at: '' }
      ]);
      setPatrolLogs(logs);
    } catch (err) {
      console.error('Failed to fetch patrol data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleQRScanSuccess = (code: string) => {
    const matchedPoint = patrolPoints.find(p => p.qr_code_value === code || p.patrol_point_id === code);
    if (matchedPoint) {
      setScannedPoint(matchedPoint);
      setStatusMessage(null);
    } else {
      setStatusMessage({ type: 'error', text: `❌ ไม่พบจุดตรวจที่ระบุรหัส: ${code}` });
    }
    setShowQRScanner(false);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, setPhoto: (url: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handlePatrolSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scannedPoint) return;

    if (patrolStatus !== 'ปกติ' && !abnormalDetail) {
      setStatusMessage({ type: 'error', text: '❌ กรุณาระบุรายละเอียดข้อบกพร่อง/เหตุผิดปกติ' });
      return;
    }

    if (patrolStatus === 'ต้องติดตาม' && !followUpNote) {
      setStatusMessage({ type: 'error', text: '❌ กรุณาระบุแผนงานติดตามผลสำหรับจุดตรวจที่มีสถานะติดตาม' });
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      let mainPhotoUrl = '';
      let incidentPhotoUrl = '';

      if (patrolPhoto) {
        mainPhotoUrl = await uploadImageToDrive(patrolPhoto, `patrol_${scannedPoint.patrol_point_id}_${Date.now()}.jpg`);
      }
      if (abnormalPhoto) {
        incidentPhotoUrl = await uploadImageToDrive(abnormalPhoto, `patrol_abn_${scannedPoint.patrol_point_id}_${Date.now()}.jpg`);
      }

      const nowStr = new Date().toISOString();
      const patrolLogId = 'PL' + Math.floor(Math.random() * 1000000);
      const incidentId = 'INC' + Math.floor(Math.random() * 1000000);

      const triggerIncident = patrolStatus !== 'ปกติ' && createIncident;

      // Construct dynamic checkin record
      const newLog: PatrolLogRecord = {
        patrol_log_id: patrolLogId,
        patrol_point_id: scannedPoint.patrol_point_id,
        point_name: scannedPoint.point_name,
        guard_name: guardName,
        shift_type: shiftType,
        checkin_time: nowStr,
        photo_url: mainPhotoUrl,
        status: patrolStatus,
        abnormal_detail: patrolStatus !== 'ปกติ' ? abnormalDetail : '',
        incident_photo_url: patrolStatus !== 'ปกติ' ? incidentPhotoUrl : '',
        note: patrolStatus === 'ปกติ' ? patrolDetail : '',
        created_at: nowStr,
        // Added fields from specifications
        patrol_detail: patrolDetail || '',
        follow_up_note: patrolStatus === 'ต้องติดตาม' ? followUpNote : '',
        action_taken: patrolStatus !== 'ปกติ' ? actionTaken : '',
        requires_follow_up: patrolStatus === 'ต้องติดตาม',
        incident_created: triggerIncident,
        source_incident_id: triggerIncident ? incidentId : ''
      };

      await appendSheetRow('PatrolLogs', newLog);

      // Audit Log
      await appendSheetRow('AuditLogs', {
        audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
        user_name: guardName,
        action: 'สแกนตรวจจุดอาคาร',
        module_name: 'PatrolLogs',
        record_id: patrolLogId,
        old_value: '',
        new_value: `${scannedPoint.point_name} [สถานะ: ${patrolStatus}]`,
        created_at: nowStr
      });

      // If abnormal/follow-up and create_incident is selected, automatically register an Incident Report
      if (triggerIncident) {
        const incidentDesc = `[รายงานตรวจจุด: ${scannedPoint.point_name}] พบเหตุผิดปกติ: ${abnormalDetail}${actionTaken ? ` | แก้ไขเบื้องต้น: ${actionTaken}` : ''}${followUpNote ? ` | ข้อเสนอแนะติดตาม: ${followUpNote}` : ''}`;
        
        await appendSheetRow('IncidentReports', {
          incident_id: incidentId,
          incident_datetime: nowStr,
          location: scannedPoint.point_name,
          incident_type: 'เหตุผิดปกติจากการเดินตรวจ',
          description: incidentDesc,
          photo_url: incidentPhotoUrl || mainPhotoUrl,
          reported_by: guardName,
          shift_leader: guardName,
          status: 'แจ้งแล้ว',
          created_at: nowStr,
          updated_at: nowStr,
          source_patrol_log_id: patrolLogId,
          patrol_point_id: scannedPoint.patrol_point_id
        });
      }

      setStatusMessage({ 
        type: 'success', 
        text: `บันทึกเช็คอินจุดตรวจ "${scannedPoint.point_name}" สำเร็จเสร็จสิ้น! ${triggerIncident ? `(ส่งแจ้งเหตุใบงาน ${incidentId} อัตโนมัติแล้ว)` : ''}` 
      });

      // Reset
      setScannedPoint(null);
      setPatrolPhoto('');
      setAbnormalPhoto('');
      setAbnormalDetail('');
      setPatrolDetail('');
      setFollowUpNote('');
      setActionTaken('');
      setPatrolStatus('ปกติ');
      setCreateIncident(true);
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  // Helper calculations for patrol status overview
  const todayStr = new Date().toISOString().split('T')[0];
  const logsToday = patrolLogs.filter(l => l.checkin_time.startsWith(todayStr));

  // Point Specific History filter
  const pointHistoryLogs = selectedPointForHistory
    ? patrolLogs.filter(l => l.patrol_point_id === selectedPointForHistory.patrol_point_id)
    : [];

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-5 px-1 pb-10">
      
      {/* Tab Switcher */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => { setActiveTab('scan'); setStatusMessage(null); }}
          className={`flex-1 py-4 text-center font-bold text-sm border-b-2 flex justify-center items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'scan' 
              ? 'border-indigo-600 text-indigo-600 bg-white' 
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          🚨 บันทึกสแกนตรวจจุด (Check-in)
        </button>
        <button
          onClick={() => { setActiveTab('dashboard'); setStatusMessage(null); }}
          className={`flex-1 py-4 text-center font-bold text-sm border-b-2 flex justify-center items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'dashboard' 
              ? 'border-indigo-600 text-indigo-600 bg-white' 
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          📊 แดชบอร์ดเดินตรวจอาคาร (Patrol Monitor)
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

      {activeTab === 'scan' ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          {!scannedPoint ? (
            <div className="flex flex-col items-center gap-5 py-6">
              <div className="text-center max-w-sm">
                <MapPin className="w-12 h-12 text-indigo-600 mx-auto mb-2" />
                <h3 className="text-lg font-black text-slate-800">โปรดสแกน QR Code ประจำจุดตรวจ</h3>
                <p className="text-xs text-slate-500 font-medium mt-1">
                  เมื่อเดินไปถึงตำแหน่งที่กำหนด ให้ใช้กล้องสแกนป้ายคิวอาร์เพื่อยืนยันพิกัดและเวลาทำงาน
                </p>
              </div>

              <button
                onClick={() => setShowQRScanner(!showQRScanner)}
                className="w-full max-w-xs h-[60px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer text-sm flex justify-center items-center gap-2"
              >
                <Camera className="w-5 h-5" />
                {showQRScanner ? 'ปิดระบบสแกน' : 'เริ่มสแกน QR Code'}
              </button>

              {showQRScanner && (
                <QRScanner 
                  onScanSuccess={handleQRScanSuccess}
                  onClose={() => setShowQRScanner(false)}
                  title="สแกนรหัสจุดตรวจ"
                  placeholderText="พิมพ์รหัส เช่น PP001, PP002"
                />
              )}

              {/* Demo Fast Sandbox selection */}
              <div className="border-t border-slate-100 pt-5 w-full mt-4">
                <span className="text-xs font-bold text-slate-400 block mb-2.5 text-center">ตัวเลือกทดสอบด่วน (Sandbox Bypass)</span>
                <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
                  {patrolPoints.map(p => (
                    <button
                      key={p.patrol_point_id}
                      onClick={() => handleQRScanSuccess(p.qr_code_value)}
                      className="px-3 py-2 border border-slate-200 hover:border-indigo-300 text-[11px] font-bold text-slate-600 hover:text-indigo-600 rounded-lg text-center cursor-pointer bg-slate-50 hover:bg-indigo-50/20"
                    >
                      📌 {p.point_name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* POINT SCANNED FORM - UPGRADED SIZING */
            <div className="border-2 border-indigo-200 rounded-2xl p-6 bg-indigo-50/30 flex flex-col gap-5">
              <div className="flex justify-between items-start pb-4 border-b border-indigo-100">
                <div>
                  <span className="text-xs font-black text-indigo-600 uppercase tracking-wide block">ตำแหน่งยืนยันพิกัดสำเร็จ</span>
                  <h3 className="text-[19px] font-black text-slate-800 leading-tight">{scannedPoint.point_name}</h3>
                  <p className="text-xs text-slate-500 font-bold mt-0.5">{scannedPoint.location_detail}</p>
                </div>
                <button
                  onClick={() => setScannedPoint(null)}
                  className="text-xs text-slate-500 font-extrabold hover:text-slate-800 cursor-pointer border border-slate-300 bg-white px-2.5 py-1.5 rounded-lg shrink-0"
                >
                  สแกนจุดอื่น
                </button>
              </div>

              <form onSubmit={handlePatrolSubmit} className="flex flex-col gap-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Shift type */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[15px] font-bold text-slate-700">กะการทำงาน *</label>
                    <select
                      value={shiftType}
                      onChange={(e) => setShiftType(e.target.value as any)}
                      className="p-4 border-2 border-slate-200 bg-white rounded-xl text-[17px] font-semibold outline-none focus:border-indigo-600"
                    >
                      <option value="เช้า">☀️ กะเช้า (06:00 - 18:00)</option>
                      <option value="กลางคืน">🌙 กะกลางคืน (18:00 - 06:00)</option>
                    </select>
                  </div>

                  {/* Status selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[15px] font-bold text-slate-700">ประเมินสถานะความปลอดภัยจุดตรวจ *</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setPatrolStatus('ปกติ')}
                        className={`h-[56px] text-sm font-bold rounded-xl border-2 text-center transition-all cursor-pointer flex items-center justify-center ${
                          patrolStatus === 'ปกติ' 
                            ? 'bg-emerald-100 border-emerald-500 text-emerald-800 font-black' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        🟢 ปกติ
                      </button>
                      <button
                        type="button"
                        onClick={() => setPatrolStatus('ผิดปกติ')}
                        className={`h-[56px] text-sm font-bold rounded-xl border-2 text-center transition-all cursor-pointer flex items-center justify-center ${
                          patrolStatus === 'ผิดปกติ' 
                            ? 'bg-red-100 border-red-500 text-red-800 font-black' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        🔴 ผิดปกติ
                      </button>
                      <button
                        type="button"
                        onClick={() => setPatrolStatus('ต้องติดตาม')}
                        className={`h-[56px] text-sm font-bold rounded-xl border-2 text-center transition-all cursor-pointer flex items-center justify-center ${
                          patrolStatus === 'ต้องติดตาม' 
                            ? 'bg-amber-100 border-amber-500 text-amber-800 font-black' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        🟡 ติดตาม
                      </button>
                    </div>
                  </div>
                </div>

                {/* Normal / General detail note input */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[15px] font-bold text-slate-700">บันทึกรายละเอียดตรวจการณ์ทั่วไป (รอบตรวจทั่วไป)</label>
                  <textarea
                    value={patrolDetail}
                    onChange={(e) => setPatrolDetail(e.target.value)}
                    placeholder="ระบุ เช่น สภาพโดยทั่วไปปกติเรียบร้อยดี, ล็อคประตูตู้ไฟแล้ว..."
                    className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] bg-white h-[90px]"
                  />
                </div>

                {/* Dynamic Fields for Abnormal / Follow-up Statuses */}
                {patrolStatus !== 'ปกติ' && (
                  <div className="flex flex-col gap-4 border border-red-200 bg-red-50/40 p-5 rounded-2xl">
                    <span className="text-xs font-black text-red-800 uppercase tracking-wider flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      รายงานตรวจพบข้อบกพร่อง / ปัญหาผิดปกติพิกัดตรวจ
                    </span>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[15px] font-bold text-red-800">ระบุรายละเอียดความผิดปกติชำรุด *</label>
                      <textarea
                        value={abnormalDetail}
                        onChange={(e) => setAbnormalDetail(e.target.value)}
                        placeholder="เช่น พบน้ำซึมจากเพดานห้องใกล้ตู้สายส่งสัญญาณ, ตู้คีย์ล็อคไม่ได้..."
                        className="p-4 border-2 border-red-200 rounded-xl outline-none focus:border-red-500 text-[17px] bg-white"
                        rows={3}
                        required
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[15px] font-bold text-slate-700">บันทึกการดำเนินการแก้ไขเบื้องต้นแล้ว (Action Taken)</label>
                      <textarea
                        value={actionTaken}
                        onChange={(e) => setActionTaken(e.target.value)}
                        placeholder="ระบุ เช่น นำกรวยส้มมากั้นเขตและปิดวาล์วน้ำหลักเพื่อลดการรั่วไหลซึมชั่วคราว..."
                        className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-red-500 text-[17px] bg-white h-[86px]"
                      />
                    </div>

                    {patrolStatus === 'ต้องติดตาม' && (
                      <div className="flex flex-col gap-1.5 border-t border-red-200/50 pt-3.5">
                        <label className="text-[15px] font-bold text-amber-800">บันทึกแผนและข้อความติดตามผล (Follow-up Action Note) *</label>
                        <textarea
                          value={followUpNote}
                          onChange={(e) => setFollowUpNote(e.target.value)}
                          placeholder="แผนงานติดตามผล เช่น ต้องประสานงานช่างอาคารมาเปลี่ยนอะไหล่สายท่อรั่วในวันถัดไป..."
                          className="p-4 border-2 border-amber-300 rounded-xl outline-none focus:border-amber-500 text-[17px] bg-white"
                          rows={2}
                          required
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2.5 mt-1 p-1 bg-white border border-red-200/50 rounded-xl p-3 shadow-sm">
                      <input
                        type="checkbox"
                        id="auto-incident-checkbox"
                        checked={createIncident}
                        onChange={(e) => setCreateIncident(e.target.checked)}
                        className="w-5 h-5 accent-indigo-600 rounded cursor-pointer shrink-0"
                      />
                      <label htmlFor="auto-incident-checkbox" className="text-xs font-black text-slate-700 cursor-pointer">
                        🚨 สร้างใบแจ้งเหตุส่งต่อศูนย์ควบคุมหลักโดยอัตโนมัติ (Create Incident Report)
                      </label>
                    </div>

                    <div className="flex flex-col gap-1.5 mt-1">
                      <label className="text-[15px] font-bold text-red-800">ถ่ายรูปประกอบความชำรุดชำรุด (เพื่อส่งใบแจ้งเหตุ)</label>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handlePhotoUpload(e, setAbnormalPhoto)}
                        className="hidden"
                        id="abnormal-photo"
                      />
                      <label
                        htmlFor="abnormal-photo"
                        className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-red-300 bg-white rounded-xl cursor-pointer hover:bg-slate-50 transition-all"
                      >
                        {abnormalPhoto ? (
                          <img src={abnormalPhoto} alt="Abnormal report" className="h-full w-full object-cover rounded-xl" />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-red-400">
                            <Camera className="w-6 h-6" />
                            <span className="text-[11px] font-bold">กดเพื่อถ่ายรูปภาพยืนยันปัญหา</span>
                          </div>
                        )}
                      </label>
                    </div>
                  </div>
                )}

                {/* Primary Patrol Photo */}
                <div className="flex flex-col gap-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <span className="text-[15px] font-bold text-slate-700">ถ่ายรูปพยานหลักฐานจุดตรวจเพื่อเช็คอินยืนยันพิกัด</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => handlePhotoUpload(e, setPatrolPhoto)}
                    className="hidden"
                    id="patrol-main-photo"
                  />
                  <label
                    htmlFor="patrol-main-photo"
                    className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-slate-300 bg-white rounded-xl cursor-pointer hover:bg-slate-50 transition-all"
                  >
                    {patrolPhoto ? (
                      <img src={patrolPhoto} alt="Patrol checkin" className="h-full w-full object-cover rounded-xl" />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-slate-400">
                        <Camera className="w-6 h-6" />
                        <span className="text-xs font-bold">กดถ่ายภาพพิกัดและพัสดุสิ่งของโดยรอบ</span>
                      </div>
                    )}
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[60px] flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer text-[17px]"
                >
                  {loading ? 'กำลังเชื่อมโยงโครงข่ายและบันทึก...' : '💾 บันทึกสแกนตรวจจุดสำเร็จเสร็จสิ้น'}
                </button>
              </form>
            </div>
          )}
        </div>
      ) : (
        /* PATROL MONITOR DASHBOARD TAB */
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-black text-slate-800">สรุปความเรียบร้อยรอบพื้นที่ประจำวัน (วันนี้)</h2>
            <button
              onClick={fetchInitialPatrolData}
              className="p-2 border border-slate-200 hover:border-slate-300 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors shrink-0"
            >
              <RefreshCw className="w-4 h-4 text-slate-600" />
            </button>
          </div>

          {/* Grid Layout of Patrol Points */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {patrolPoints.map(point => {
              // Find latest log for this point today
              const ptLogs = logsToday.filter(l => l.patrol_point_id === point.patrol_point_id);
              const isChecked = ptLogs.length > 0;
              const lastLog = isChecked ? ptLogs[ptLogs.length - 1] : null;

              return (
                <div 
                  key={point.patrol_point_id}
                  onClick={() => setSelectedPointForHistory(point)}
                  className={`border-2 rounded-2xl p-5 flex flex-col justify-between min-h-[150px] shadow-sm relative overflow-hidden transition-all cursor-pointer hover:shadow-md ${
                    isChecked 
                      ? lastLog?.status === 'ปกติ' 
                        ? 'bg-emerald-50/50 border-emerald-300 hover:border-emerald-400'
                        : lastLog?.status === 'ต้องติดตาม'
                          ? 'bg-amber-50/40 border-amber-300 hover:border-amber-400'
                          : 'bg-red-50/40 border-red-300 hover:border-red-400'
                      : 'bg-slate-50/50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div>
                    <span className="text-[10px] font-black text-slate-400 block tracking-wider uppercase font-mono">{point.patrol_point_id}</span>
                    <h3 className="text-sm font-black text-slate-800 mt-1 line-clamp-1">{point.point_name}</h3>
                    <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5 font-semibold">{point.location_detail}</p>
                  </div>

                  <div className="flex justify-between items-center mt-3 border-t border-slate-100 pt-2.5">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                      isChecked 
                        ? lastLog?.status === 'ปกติ' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : lastLog?.status === 'ต้องติดตาม'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {isChecked 
                        ? lastLog?.status === 'ปกติ' 
                          ? '🟢 ตรวจแล้ว' 
                          : lastLog?.status === 'ต้องติดตาม'
                            ? '🟡 ต้องติดตาม'
                            : '🔴 มีปัญหา' 
                        : '⚪ รอตรวจ'}
                    </span>
                    {isChecked && lastLog && (
                      <span className="text-[10px] font-mono font-bold text-slate-400">
                        {new Date(lastLog.checkin_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive instruction banner */}
          <div className="bg-indigo-50 border border-indigo-100 p-3.5 rounded-xl text-xs font-semibold text-indigo-800 flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0" />
            <span>💡 แตะที่การ์ดจุดตรวจด้านบน เพื่อเปิดประวัติเดินตรวจรายพิกัด และแสดงข้อความติดตามผล รูปภาพ หรือ แผนการดำเนินการอย่างละเอียด</span>
          </div>

          {/* Hourly logs timeline (Today Global) */}
          <div className="border-t border-slate-100 pt-5 mt-3">
            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-1.5">
              <Clock className="w-4.5 h-4.5 text-slate-500" />
              รายงานประวัติและพยานการเดินตรวจอาคารล่าสุดของวันนี้ (ภาพรวม)
            </h3>

            {logsToday.length === 0 ? (
              <div className="py-10 text-center text-slate-400 border border-dashed border-slate-100 rounded-xl">
                ยังไม่มีการตรวจตราจุดตรวจในรอบวันปัจจุบัน
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-72 overflow-y-auto pr-1">
                {logsToday.slice().reverse().map((log, idx) => (
                  <div 
                    key={log.patrol_log_id || idx}
                    className="flex justify-between items-start p-3 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-slate-800">{log.point_name}</span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                          log.status === 'ปกติ' 
                            ? 'bg-emerald-100 text-emerald-800' 
                            : log.status === 'ต้องติดตาม'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}>
                          {log.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-bold mt-0.5">
                        โดย: <span className="text-slate-700 font-extrabold">{log.guard_name}</span> • กะ: {log.shift_type}
                      </p>
                      
                      {log.patrol_detail && (
                        <p className="text-[11px] text-slate-600 bg-white p-2 border border-slate-100 rounded-lg mt-1 font-medium leading-relaxed">
                          📝 ตรวจทั่วไป: {log.patrol_detail}
                        </p>
                      )}

                      {log.abnormal_detail && (
                        <div className="text-[11px] text-red-800 bg-red-50 p-2.5 rounded-lg border border-red-100 mt-2 font-bold flex flex-col gap-1">
                          <span>⚠️ พบความชำรุด: {log.abnormal_detail}</span>
                          {log.action_taken && (
                            <span className="text-emerald-700 font-semibold">🛠️ แก้ไขเบื้องต้น: {log.action_taken}</span>
                          )}
                          {log.follow_up_note && (
                            <span className="text-amber-700 font-semibold">📌 ติดตาม: {log.follow_up_note}</span>
                          )}
                          {log.source_incident_id && (
                            <span className="text-indigo-600 font-mono text-[10px] uppercase">🚨 ส่งใบแจ้งเหตุเลขที่: {log.source_incident_id}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-mono font-bold text-slate-400">
                      {new Date(log.checkin_time).toLocaleTimeString('th-TH')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* POINT-SPECIFIC HISTORY INTERACTIVE DIALOG */}
      {selectedPointForHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedPointForHistory(null)} />
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl z-10 w-full max-w-2xl text-left relative flex flex-col gap-4 max-h-[85vh] overflow-hidden">
            
            {/* Header */}
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-black text-indigo-600 font-mono block tracking-wider uppercase">
                  รหัสจุดตรวจ: {selectedPointForHistory.patrol_point_id}
                </span>
                <h3 className="text-lg font-black text-slate-800">{selectedPointForHistory.point_name}</h3>
                <p className="text-xs text-slate-500 font-bold mt-0.5">{selectedPointForHistory.location_detail}</p>
              </div>
              <button
                onClick={() => setSelectedPointForHistory(null)}
                className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List area */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-3.5 pr-1.5">
              <span className="text-xs font-black text-slate-400 block">ประวัติการตรวจเช็คอินจุดตรวจนี้ย้อนหลัง</span>

              {pointHistoryLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-xl">
                  ไม่พบข้อมูลประวัติการสแกนเช็คอินย้อนหลังของพิกัดตรวจนี้ในระบบ
                </div>
              ) : (
                pointHistoryLogs.slice().reverse().map((log, idx) => (
                  <div 
                    key={log.patrol_log_id || idx}
                    className={`border p-4 rounded-xl flex flex-col gap-3 ${
                      log.status === 'ปกติ' 
                        ? 'bg-slate-50/50 border-slate-200' 
                        : log.status === 'ต้องติดตาม'
                          ? 'bg-amber-50/30 border-amber-200'
                          : 'bg-red-50/30 border-red-200'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                          log.status === 'ปกติ' 
                            ? 'bg-emerald-100 text-emerald-800' 
                            : log.status === 'ต้องติดตาม'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}>
                          {log.status === 'ปกติ' ? '🟢 ตรวจปกติ' : log.status === 'ต้องติดตาม' ? '🟡 แผนติดตาม' : '🔴 พบข้อขัดข้อง'}
                        </span>
                        <span className="text-xs font-semibold text-slate-400 font-mono">
                          {new Date(log.checkin_time).toLocaleString('th-TH')}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-slate-500">
                        รปภ: <span className="font-extrabold text-slate-700">{log.guard_name}</span> • กะ: {log.shift_type}
                      </span>
                    </div>

                    {/* Patrol Detail */}
                    {log.patrol_detail && (
                      <p className="text-xs text-slate-600 font-medium leading-relaxed bg-white p-2.5 rounded-lg border border-slate-100">
                        <strong>📝 ตรวจทั่วไป:</strong> {log.patrol_detail}
                      </p>
                    )}

                    {/* Abnormal & incident details */}
                    {log.status !== 'ปกติ' && (
                      <div className="p-3 bg-white border border-slate-200/60 rounded-lg flex flex-col gap-2">
                        {log.abnormal_detail && (
                          <p className="text-xs text-red-800 font-bold leading-relaxed">
                            <strong>⚠️ รายละเอียดบกพร่อง:</strong> {log.abnormal_detail}
                          </p>
                        )}
                        {log.action_taken && (
                          <p className="text-xs text-emerald-700 font-bold leading-relaxed">
                            <strong>🛠️ การจัดการเบื้องต้น:</strong> {log.action_taken}
                          </p>
                        )}
                        {log.follow_up_note && (
                          <p className="text-xs text-amber-700 font-bold leading-relaxed">
                            <strong>📌 แผนงานติดตามผล:</strong> {log.follow_up_note}
                          </p>
                        )}
                        {log.source_incident_id && (
                          <div className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-1.5 rounded-md inline-block uppercase font-bold self-start mt-1">
                            🚨 ส่งแจ้งเหตุในระบบย่อย: {log.source_incident_id}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Render Photos if they exist */}
                    {(log.photo_url || log.incident_photo_url) && (
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        {log.photo_url && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-slate-400 font-bold">📷 รูปยืนยันพิกัด</span>
                            <img 
                              src={log.photo_url} 
                              alt="Patrol main" 
                              className="h-28 w-full object-cover rounded-lg border border-slate-200 shadow-sm"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                        {log.incident_photo_url && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-red-400 font-bold">📸 รูปหลักฐานปัญหา</span>
                            <img 
                              src={log.incident_photo_url} 
                              alt="Patrol incident" 
                              className="h-28 w-full object-cover rounded-lg border border-red-200 shadow-sm"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 pt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedPointForHistory(null)}
                className="px-5 py-3 border border-slate-200 rounded-xl hover:bg-slate-50 font-bold text-slate-700 cursor-pointer text-sm"
              >
                ปิดหน้าต่างประวัติ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
