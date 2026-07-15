/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, ShieldAlert, Camera, MapPin, Check, 
  Clock, AlertTriangle, RefreshCw, Eye
} from 'lucide-react';
import { readSheet, appendSheetRow, uploadImageToDrive } from '../googleApi';
import { PatrolLogRecord, PatrolPointRecord } from '../types';
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

  // Form State
  const [shiftType, setShiftType] = useState<'เช้า' | 'กลางคืน'>('เช้า');
  const [patrolStatus, setPatrolStatus] = useState<'ปกติ' | 'ผิดปกติ' | 'ต้องติดตาม'>('ปกติ');
  const [abnormalDetail, setAbnormalDetail] = useState('');
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
        created_at: nowStr
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
        new_value: `${scannedPoint.point_name} [${patrolStatus}]`,
        created_at: nowStr
      });

      // If abnormal, we can automatically trigger an Incident Report!
      if (patrolStatus !== 'ปกติ') {
        const incidentId = 'INC' + Math.floor(Math.random() * 1000000);
        await appendSheetRow('IncidentReports', {
          incident_id: incidentId,
          incident_datetime: nowStr,
          location: scannedPoint.point_name,
          incident_type: 'อุปกรณ์ชำรุด',
          description: `แจ้งเหตุผิดปกติจากการเดินตรวจ: ${abnormalDetail}`,
          photo_url: incidentPhotoUrl || mainPhotoUrl,
          reported_by: guardName,
          shift_leader: guardName,
          status: 'แจ้งแล้ว',
          created_at: nowStr,
          updated_at: nowStr
        });
      }

      setStatusMessage({ type: 'success', text: `บันทึกเช็คอินจุดตรวจ "${scannedPoint.point_name}" เรียบร้อยดี!` });
      setScannedPoint(null);
      setPatrolPhoto('');
      setAbnormalPhoto('');
      setAbnormalDetail('');
      setPatrolStatus('ปกติ');
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  // Helper calculation for patrol status overview
  const todayStr = new Date().toISOString().split('T')[0];
  const logsToday = patrolLogs.filter(l => l.checkin_time.startsWith(todayStr));

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
                className="w-full max-w-xs py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer text-sm flex justify-center items-center gap-2"
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
            /* POINT SCANNED FORM */
            <div className="border border-indigo-200 rounded-xl p-5 bg-indigo-50/30 flex flex-col gap-5">
              <div className="flex justify-between items-start pb-3 border-b border-indigo-100">
                <div>
                  <span className="text-xs font-bold text-indigo-600 uppercase">ตำแหน่งยืนยันพิกัดสำเร็จ</span>
                  <h3 className="text-lg font-black text-slate-800">{scannedPoint.point_name}</h3>
                  <p className="text-xs text-slate-500 font-medium">{scannedPoint.location_detail}</p>
                </div>
                <button
                  onClick={() => setScannedPoint(null)}
                  className="text-xs text-slate-500 font-bold hover:text-slate-800 cursor-pointer"
                >
                  สแกนจุดอื่น
                </button>
              </div>

              <form onSubmit={handlePatrolSubmit} className="flex flex-col gap-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Shift type */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-600">กะการทำงาน</label>
                    <select
                      value={shiftType}
                      onChange={(e) => setShiftType(e.target.value as any)}
                      className="p-3 border border-slate-300 bg-white rounded-xl text-sm font-semibold"
                    >
                      <option value="เช้า">☀️ กะเช้า (06:00 - 18:00)</option>
                      <option value="กลางคืน">🌙 กะกลางคืน (18:00 - 06:00)</option>
                    </select>
                  </div>

                  {/* Status selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-600">ประเมินความปลอดภัยจุดตรวจ</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setPatrolStatus('ปกติ')}
                        className={`py-2 px-1 text-xs font-bold rounded-xl border text-center transition-all cursor-pointer ${
                          patrolStatus === 'ปกติ' 
                            ? 'bg-emerald-100 border-emerald-400 text-emerald-800 font-extrabold' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        🟢 ปกติ
                      </button>
                      <button
                        type="button"
                        onClick={() => setPatrolStatus('ผิดปกติ')}
                        className={`py-2 px-1 text-xs font-bold rounded-xl border text-center transition-all cursor-pointer ${
                          patrolStatus === 'ผิดปกติ' 
                            ? 'bg-red-100 border-red-400 text-red-800 font-extrabold' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        🔴 ผิดปกติ
                      </button>
                      <button
                        type="button"
                        onClick={() => setPatrolStatus('ต้องติดตาม')}
                        className={`py-2 px-1 text-xs font-bold rounded-xl border text-center transition-all cursor-pointer ${
                          patrolStatus === 'ต้องติดตาม' 
                            ? 'bg-amber-100 border-amber-400 text-amber-800 font-extrabold' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        🟡 ติดตาม
                      </button>
                    </div>
                  </div>
                </div>

                {patrolStatus !== 'ปกติ' && (
                  <div className="flex flex-col gap-3 border border-red-100 bg-red-50/50 p-4 rounded-xl">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-red-800">ระบุรายละเอียดความผิดปกติ *</label>
                      <textarea
                        value={abnormalDetail}
                        onChange={(e) => setAbnormalDetail(e.target.value)}
                        placeholder="เช่น พบประกายไฟกะพริบจากสะพานไฟตัวคุม, แม่กุญแจโดนงัดแงะชำรุด..."
                        className="p-3 border-2 border-red-200 rounded-xl outline-none focus:border-red-500 text-sm bg-white"
                        rows={3}
                        required
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-red-800">ถ่ายรูปประกอบความชำรุดชำรุด (ไม่บังคับ)</label>
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
                        className="flex flex-col items-center justify-center h-24 border-2 border-dashed border-red-300 bg-white rounded-lg cursor-pointer"
                      >
                        {abnormalPhoto ? (
                          <img src={abnormalPhoto} alt="Abnormal report" className="h-full w-full object-cover rounded-lg" />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-red-400">
                            <Camera className="w-6 h-6" />
                            <span className="text-[10px] font-bold">กดเพื่อถ่ายรูปภาพยืนยัน</span>
                          </div>
                        )}
                      </label>
                    </div>
                  </div>
                )}

                {/* Primary Patrol Photo */}
                <div className="flex flex-col gap-1.5 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-600">ถ่ายรูปจุดตรวจพัสดุ/ความสงบเรียบร้อยเพื่อเช็คอิน</span>
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
                    className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-slate-300 bg-white rounded-lg cursor-pointer"
                  >
                    {patrolPhoto ? (
                      <img src={patrolPhoto} alt="Patrol checkin" className="h-full w-full object-cover rounded-lg" />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-slate-400">
                        <Camera className="w-6 h-6" />
                        <span className="text-xs font-bold">กดถ่ายภาพเพื่อบันทึกพยานหลักฐาน</span>
                      </div>
                    )}
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
                >
                  {loading ? 'กำลังบันทึกข้อมูลและรายงาน...' : '💾 บันทึกสแกนตรวจจุดสำเร็จเสร็จสิ้น'}
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
              className="p-2 border border-slate-200 hover:border-slate-300 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className="w-4 h-4 text-slate-600" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {patrolPoints.map(point => {
              // Find latest log for this point today
              const ptLogs = logsToday.filter(l => l.patrol_point_id === point.patrol_point_id);
              const isChecked = ptLogs.length > 0;
              const lastLog = isChecked ? ptLogs[ptLogs.length - 1] : null;

              return (
                <div 
                  key={point.patrol_point_id}
                  className={`border rounded-2xl p-5 flex flex-col justify-between min-h-36 shadow-sm relative overflow-hidden transition-all ${
                    isChecked 
                      ? lastLog?.status === 'ปกติ' 
                        ? 'bg-emerald-50/50 border-emerald-200 hover:border-emerald-300'
                        : 'bg-red-50/40 border-red-200 hover:border-red-300'
                      : 'bg-slate-50/50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 block tracking-wider uppercase font-mono">{point.patrol_point_id}</span>
                    <h3 className="text-sm font-black text-slate-800 mt-1 line-clamp-1">{point.point_name}</h3>
                    <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{point.location_detail}</p>
                  </div>

                  <div className="flex justify-between items-center mt-3 border-t border-slate-100 pt-2.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isChecked 
                        ? lastLog?.status === 'ปกติ' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : 'bg-red-100 text-red-800'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {isChecked ? lastLog?.status === 'ปกติ' ? '🟢 ตรวจแล้ว' : '🔴 มีปัญหา' : '⚪ รอตรวจ'}
                    </span>
                    {isChecked && lastLog && (
                      <span className="text-[10px] font-mono text-slate-400">
                        {new Date(lastLog.checkin_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hourly logs timeline */}
          <div className="border-t border-slate-100 pt-5 mt-3">
            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-1.5">
              <Clock className="w-4.5 h-4.5 text-slate-500" />
              รายงานประวัติและพยานการเดินตรวจอาคารล่าสุด (วันนี้)
            </h3>

            {logsToday.length === 0 ? (
              <div className="py-10 text-center text-slate-400 border border-dashed border-slate-100 rounded-xl">
                ยังไม่มีการตรวจตราจุดตรวจในรอบวันปัจจุบัน
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-72 overflow-y-auto">
                {logsToday.slice().reverse().map((log, idx) => (
                  <div 
                    key={log.patrol_log_id || idx}
                    className="flex justify-between items-start p-3 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-800">{log.point_name}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          log.status === 'ปกติ' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {log.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                        โดย รปภ: <span className="font-bold">{log.guard_name}</span> • กะ: {log.shift_type}
                      </p>
                      {log.abnormal_detail && (
                        <p className="text-[11px] text-red-700 bg-red-50 p-1.5 rounded border border-red-100 mt-1.5 font-bold">
                          ⚠️ รายละเอียดปัญหา: {log.abnormal_detail}
                        </p>
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
    </div>
  );
}
