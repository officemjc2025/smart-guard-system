/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, Check, Camera, Search, RefreshCw, 
  Clock, ShieldAlert, Edit, User
} from 'lucide-react';
import { IncidentReportRecord } from '../types';
import { createIncident, listIncidents, updateIncident } from '../services/incidentService';
import { createAuditLog } from '../services/auditService';
import { uploadImageToDrive } from '../services/mediaUploadService';
import ConfirmModal from './ConfirmModal';
import UnitSearchSelect from './UnitSearchSelect';

interface IncidentReportsProps {
  guardName: string;
}

export default function IncidentReports({ guardName }: IncidentReportsProps) {
  const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';
  const [activeTab, setActiveTab] = useState<'report' | 'list'>('report');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  
  // Custom Confirmation Dialog State
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  // Form State
  const [incidentForm, setIncidentForm] = useState({
    location: '',
    target_unit_id: '',
    unit_lookup_status: undefined as 'matched' | 'manual' | undefined,
    incident_type: 'อุปกรณ์ชำรุด' as any,
    description: '',
    shift_leader: ''
  });
  const [incidentPhoto, setIncidentPhoto] = useState<string>('');

  // List State
  const [incidents, setIncidents] = useState<IncidentReportRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIncident, setSelectedIncident] = useState<IncidentReportRecord | null>(null);
  const [managementNote, setManagementNote] = useState('');
  const [updateStatus, setUpdateStatus] = useState<any>('กำลังดำเนินการ');

  useEffect(() => {
    fetchIncidents();
  }, [activeTab]);

  const fetchIncidents = async () => {
    setLoading(true);
    try {
      const allInc = await listIncidents(siteId);
      setIncidents(allInc.reverse());
    } catch (err) {
      console.error('Failed to load incident reports:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setIncidentPhoto(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incidentForm.location || !incidentForm.description) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกสถานที่เกิดเหตุและรายละเอียด' });
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      let photoUrl = '';
      const incidentId = 'INC' + Math.floor(Math.random() * 1000000);
      if (incidentPhoto) {
        photoUrl = await uploadImageToDrive(incidentPhoto, `incident_${incidentForm.incident_type}_${Date.now()}.jpg`, { moduleName: 'IncidentReports', recordId: incidentId, siteId: 'smart-guard', uploadedBy: guardName });
      }

      const nowStr = new Date().toISOString();

      const newReport = {
        incident_id: incidentId,
        incident_datetime: nowStr,
        location: incidentForm.location,
        target_unit_id: incidentForm.target_unit_id || undefined,
        unit_lookup_status: incidentForm.unit_lookup_status,
        incident_type: incidentForm.incident_type,
        description: incidentForm.description,
        photo_url: photoUrl,
        reported_by: guardName,
        shift_leader: incidentForm.shift_leader || guardName,
        status: 'แจ้งแล้ว' as const
      };

      await createIncident(siteId, newReport);

      // Audit Log
      await createAuditLog(siteId, {
        audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
        user_name: guardName,
        action: 'แจ้งเหตุการณ์ไม่ปกติ',
        module_name: 'IncidentReports',
        record_id: incidentId,
        old_value: '',
        new_value: incidentForm.incident_type
      });

      setStatusMessage({ type: 'success', text: `บันทึกแจ้งรายงานเหตุการณ์ "${incidentForm.incident_type}" เรียบร้อยแล้ว!` });
      setIncidentForm({
        location: '',
        target_unit_id: '',
        unit_lookup_status: undefined,
        incident_type: 'อุปกรณ์ชำรุด',
        description: '',
        shift_leader: ''
      });
      setIncidentPhoto('');
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident) return;
    setShowUpdateModal(true);
  };

  const handleConfirmUpdateStatus = async () => {
    if (!selectedIncident) return;
    setShowUpdateModal(false);

    setLoading(true);
    setStatusMessage(null);

    try {
      const nowStr = new Date().toISOString();

      await updateIncident(siteId, selectedIncident.incident_id, {
        status: updateStatus,
        management_note: managementNote
      });

      // Audit Log
      await createAuditLog(siteId, {
        audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
        user_name: guardName,
        action: 'อัปเดตสถานะเหตุการณ์ผิดปกติ',
        module_name: 'IncidentReports',
        record_id: selectedIncident.incident_id,
        old_value: selectedIncident.status,
        new_value: updateStatus
      });

      setStatusMessage({ type: 'success', text: `อัปเดตรายงานสถานะเหตุการณ์ #${selectedIncident.incident_id} สำเร็จ` });
      setSelectedIncident(null);
      setManagementNote('');
      fetchIncidents();
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const filteredIncidents = incidents.filter(i => 
    i.location.includes(searchQuery) || 
    i.description.includes(searchQuery) ||
    i.incident_type.includes(searchQuery)
  );

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-5 px-1 pb-10">
      
      {/* Tab Switcher */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => { setActiveTab('report'); setStatusMessage(null); }}
          className={`flex-1 py-4 text-center font-bold text-sm border-b-2 flex justify-center items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'report' 
              ? 'border-indigo-600 text-indigo-600 bg-white' 
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-red-600" />
          เขียนรายงานแจ้งเหตุการณ์ (New Incident)
        </button>
        <button
          onClick={() => { setActiveTab('list'); setStatusMessage(null); }}
          className={`flex-1 py-4 text-center font-bold text-sm border-b-2 flex justify-center items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'list' 
              ? 'border-indigo-600 text-indigo-600 bg-white' 
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          📋 รายการประวัติเหตุการณ์ทั้งหมด (Incident Log)
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

      {activeTab === 'report' ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            รายงานเหตุการณ์ไม่ปกติและภัยคุกคามอาคาร
          </h2>

          <form onSubmit={handleSubmitReport} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Incident Type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ประเภทสถานการณ์ภัยคุกคาม</label>
                <select
                  value={incidentForm.incident_type}
                  onChange={(e) => setIncidentForm(prev => ({ ...prev, incident_type: e.target.value as any }))}
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none bg-white focus:border-indigo-600 text-sm font-semibold"
                >
                  <option value="อัคคีภัย">🔥 อัคคีภัย / ควันไฟ / แก๊สรั่ว</option>
                  <option value="น้ำท่วม/ท่อแตก">💧 น้ำท่วม / ท่อระบายน้ำประปาแตก</option>
                  <option value="โจรกรรม/ลักทรัพย์">👮 โจรกรรม / แย่งชิงทรัพย์ / งัดแงะ</option>
                  <option value="ทะเลาะวิวาท">👊 ทะเลาะวิวาท / บุกรุกขัดใจบุคคล</option>
                  <option value="อุปกรณ์ชำรุด">🛠️ อุปกรณ์สำคัญส่วนกลางชำรุด</option>
                  <option value="อื่นๆ">⚠️ อื่นๆ (ระบุด้านล่าง)</option>
                </select>
              </div>

              <UnitSearchSelect value={incidentForm.location} selectedUnitId={incidentForm.target_unit_id}
                label="สถานที่เกิดเหตุ / ยูนิตห้องชุด" required allowManualEntry
                onSelect={unit => setIncidentForm(prev => ({ ...prev, location: unit?.room_number || '', target_unit_id: unit?.unit_id || '', unit_lookup_status: unit ? (unit.unit_id ? 'matched' : 'manual') : undefined }))} />

              {/* Shift leader */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">หัวหน้ากะชุด รปภ. ผู้อนุมัติ</label>
                <input
                  type="text"
                  value={incidentForm.shift_leader}
                  onChange={(e) => setIncidentForm(prev => ({ ...prev, shift_leader: e.target.value }))}
                  placeholder="เช่น หัวหน้ากะประเสริฐ สิงห์โต"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                />
              </div>

              {/* Server user display */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ผู้เขียนผู้รายงานบันทึก</label>
                <input
                  type="text"
                  value={guardName}
                  disabled
                  className="p-3.5 border-2 border-slate-100 bg-slate-50 text-slate-500 rounded-xl text-sm font-bold"
                />
              </div>
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-600">คำบรรยายพฤติการณ์เหตุการณ์ผิดปกติโดยย่อ *</label>
              <textarea
                value={incidentForm.description}
                onChange={(e) => setIncidentForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="กรุณาบรรยายข้อเท็จจริงอย่างตรงไปตรงมา เช่น พบคราบน้ำซึมจากหน้าบานกระจกดาดฟ้าชั้น 30 และพบหยดน้ำกระจายขังพื้นผิวทางเดินค่อนข้างเยอะ..."
                className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm"
                rows={4}
                required
              />
            </div>

            {/* Camera File capture */}
            <div className="flex flex-col gap-2 border border-slate-200 rounded-xl p-4 bg-slate-50">
              <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                <Camera className="w-4 h-4 text-indigo-600" />
                ถ่ายรูปหลักฐานร่องรอยความเสียหาย / ร่องรอยเหตุการณ์
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
                id="incident-photo-upload"
              />
              <label
                htmlFor="incident-photo-upload"
                className="flex flex-col items-center justify-center h-36 border-2 border-dashed border-slate-300 bg-white rounded-lg cursor-pointer"
              >
                {incidentPhoto ? (
                  <img src={incidentPhoto} alt="Incident" className="h-full w-full object-cover rounded-lg" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-slate-400">
                    <Camera className="w-8 h-8" />
                    <span className="text-xs font-bold">กดเพื่อถ่ายรูปความเสียหายทันที</span>
                  </div>
                )}
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
            >
              {loading ? 'กำลังส่งข้อมูลเหตุการณ์ด่วน...' : '🚨 ยืนยันบันทึกแจ้งเหตุการณ์ด่วน'}
            </button>
          </form>
        </div>
      ) : (
        /* LIST TAB */
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-black text-slate-800">ประวัติบันทึกสถานการณ์ความผิดปกติล่าสุด</h2>
            <button
              onClick={fetchIncidents}
              className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-3.5 text-slate-400 w-4.5 h-4.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาตามสถานที่เกิดเหตุ, บรรยายอาการความผิดปกติ..."
              className="w-full pl-10 pr-4 py-3 border-2 border-slate-200 rounded-xl text-sm font-semibold outline-none focus:border-indigo-600"
            />
          </div>

          {loading && (
            <div className="py-10 text-center font-bold text-slate-500 animate-pulse text-sm">
              กำลังรวบรวมประวัติความคืบหน้าเหตุการณ์...
            </div>
          )}

          {!loading && incidents.length === 0 && (
            <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
              <Check className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-bold">ระบบสงบเรียบร้อยดี ยังไม่มีรายงานความเสียหายค้างส่ง</p>
            </div>
          )}

          {!loading && incidents.length > 0 && !selectedIncident && (
            <div className="flex flex-col gap-3">
              {filteredIncidents.map((inc) => (
                <div
                  key={inc.incident_id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl gap-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-red-50 text-red-600 rounded-xl shrink-0 mt-1">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-black text-slate-800">{inc.incident_type}</span>
                        <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {new Date(inc.incident_datetime).toLocaleString('th-TH')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 font-medium mt-1 line-clamp-2">📍 สถานที่: {inc.location}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{inc.description}</p>
                      {inc.management_note && (
                        <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 p-2 rounded-lg mt-2 font-bold">
                          📝 บันทึกฝ่ายจัดการอาคาร: {inc.management_note}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex sm:flex-col items-end gap-3 justify-between sm:justify-center border-t sm:border-t-0 border-slate-200 pt-2 sm:pt-0">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                      inc.status === 'แจ้งแล้ว' ? 'bg-red-100 text-red-800' :
                      inc.status === 'กำลังดำเนินการ' ? 'bg-amber-100 text-amber-800' :
                      'bg-emerald-100 text-emerald-800'
                    }`}>
                      {inc.status}
                    </span>
                    <button
                      onClick={() => {
                        setSelectedIncident(inc);
                        setUpdateStatus(inc.status);
                        setManagementNote(inc.management_note || '');
                      }}
                      className="p-1.5 border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 rounded-lg flex items-center gap-1 text-[11px] font-bold text-slate-600 cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      จัดการเหตุ
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedIncident && (
            <div className="border border-slate-200 bg-slate-50/50 rounded-xl p-5 flex flex-col gap-5">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <div>
                  <span className="text-xs font-bold text-indigo-600 uppercase">อัปเดตและรายงานคืบหน้าเคส #{selectedIncident.incident_id}</span>
                  <h3 className="text-base font-black text-slate-800">{selectedIncident.incident_type}</h3>
                </div>
                <button
                  onClick={() => setSelectedIncident(null)}
                  className="text-xs text-slate-500 font-bold hover:text-slate-800 cursor-pointer"
                >
                  ย้อนกลับ
                </button>
              </div>

              <div className="text-xs text-slate-600 font-semibold space-y-1">
                <div>📍 สถานที่: <span className="font-bold text-slate-800">{selectedIncident.location}</span></div>
                <div>👤 ผู้รายงาน: <span className="font-bold text-slate-800">{selectedIncident.reported_by}</span></div>
                <div>📝 รายละเอียดปัญหา: <span className="font-medium text-slate-700">{selectedIncident.description}</span></div>
              </div>

              <form onSubmit={handleUpdateStatusSubmit} className="flex flex-col gap-4">
                {/* Status selector */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600">เปลี่ยนระดับสถานะเคส</label>
                  <select
                    value={updateStatus}
                    onChange={(e) => setUpdateStatus(e.target.value)}
                    className="p-3 border border-slate-300 bg-white rounded-xl text-sm font-semibold"
                  >
                    <option value="แจ้งแล้ว">🔴 แจ้งแล้ว (รับเรื่องรอการตอบกลับ)</option>
                    <option value="กำลังดำเนินการ">🟡 กำลังดำเนินการ (อยู่ระหว่างแก้ไข)</option>
                    <option value="ปิดงานแล้ว">🟢 ปิดงานแล้ว (การคุ้มครองเรียบร้อยดี)</option>
                  </select>
                </div>

                {/* Management Note */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600">บันทึกความคืบหน้าของเจ้าหน้าที่ / นิติบุคคล *</label>
                  <textarea
                    value={managementNote}
                    onChange={(e) => setManagementNote(e.target.value)}
                    placeholder="ระบุกิจกรรมการเข้าซ่อมแซม พนักงานซับน้ำ หรือกิจกรรมตอบรับความมั่นคง..."
                    className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm bg-white"
                    rows={3}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all shadow cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  {loading ? 'กำลังเขียนบันทึกอัปเดต...' : '💾 อัปเดตและเขียนความคืบหน้าสถานะความปลอดภัย'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={showUpdateModal}
        title="ยืนยันการบันทึกสถานะเหตุการณ์"
        message="คุณยืนยันต้องการบันทึกความคืบหน้าและเปลี่ยนสถานะการระงับเหตุความมั่นคงนี้หรือไม่?"
        confirmText="ยืนยันอัปเดต"
        cancelText="ยกเลิก"
        onConfirm={handleConfirmUpdateStatus}
        onCancel={() => setShowUpdateModal(false)}
      />
    </div>
  );
}
