/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Users, Search, Check, AlertTriangle, ShieldAlert,
  ArrowUpRight, ArrowDownLeft, Camera, ShieldX, Clock
} from 'lucide-react';
import { readSheet, appendSheetRow, updateSheetRow, uploadImageToDrive } from '../googleApi';
import { ContractorLogRecord, BlacklistRecord } from '../types';
import ConfirmModal from './ConfirmModal';
import UnitSearchSelect from './UnitSearchSelect';

interface ContractorLogsProps {
  guardName: string;
}

export default function ContractorLogs({ guardName }: ContractorLogsProps) {
  const [activeTab, setActiveTab] = useState<'entry' | 'exit'>('entry');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Exit Confirmation Modal State
  const [showExitModal, setShowExitModal] = useState(false);
  const [contractorToExit, setContractorToExit] = useState<ContractorLogRecord | null>(null);

  // Blacklist
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const [blacklistWarning, setBlacklistWarning] = useState<string | null>(null);

  // Entry Form State
  const [entryForm, setEntryForm] = useState({
    contractor_name: '',
    id_card_number: '',
    phone: '',
    company: '',
    target_room: '',
    target_unit_id: '',
    unit_lookup_status: undefined as 'matched' | 'manual' | undefined,
    owner_name: '',
    work_type: 'ซ่อมระบบแสงสว่าง',
    note: ''
  });
  const [idCardPhoto, setIdCardPhoto] = useState<string>('');
  const [facePhoto, setFacePhoto] = useState<string>('');

  // Exit State
  const [workingContractors, setWorkingContractors] = useState<ContractorLogRecord[]>([]);
  const [exitSearchQuery, setExitSearchQuery] = useState('');

  useEffect(() => {
    fetchInitialData();
  }, [activeTab]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [blList, allLogs] = await Promise.all([
        readSheet<BlacklistRecord>('Blacklist'),
        readSheet<ContractorLogRecord>('ContractorLogs')
      ]);
      setBlacklist(blList.filter(b => b.status === 'Active'));
      setWorkingContractors(allLogs.filter(c => c.status === 'กำลังปฏิบัติงาน'));
    } catch (err) {
      console.error('Failed to load contractor data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Check Blacklist whenever ID card changes
  const handleIDCardChange = (id: string) => {
    setEntryForm(prev => ({ ...prev, id_card_number: id }));
    if (!id) {
      setBlacklistWarning(null);
      return;
    }

    const matched = blacklist.find(b => 
      b.type === 'เลขบัตรประชาชน' && 
      b.id_card_number && 
      id.replace(/\s+/g, '') === b.id_card_number.replace(/\s+/g, '')
    );

    if (matched) {
      setBlacklistWarning(`🚨 เตือนภัยบัญชีดำบุคคลแบล็กลิสต์: ช่างคนนี้ถูกห้ามเข้าพื้นที่! เหตุผล: ${matched.reason} (${matched.severity})`);
    } else {
      setBlacklistWarning(null);
    }
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

  const handleEntrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryForm.contractor_name || !entryForm.id_card_number) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกชื่อและเลขบัตรประชาชนของผู้รับเหมา' });
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      let idPhotoUrl = '';
      let facePhotoUrl = '';
      const contractorLogId = 'CON' + Math.floor(Math.random() * 1000000);

      if (idCardPhoto) {
        idPhotoUrl = await uploadImageToDrive(idCardPhoto, `contractor_id_${entryForm.id_card_number}_${Date.now()}.jpg`, { moduleName: 'ContractorLogs', recordId: contractorLogId, siteId: 'smart-guard', uploadedBy: guardName });
      }
      if (facePhoto) {
        facePhotoUrl = await uploadImageToDrive(facePhoto, `contractor_face_${entryForm.id_card_number}_${Date.now()}.jpg`, { moduleName: 'ContractorLogs', recordId: contractorLogId, siteId: 'smart-guard', uploadedBy: guardName });
      }

      const nowStr = new Date().toISOString();

      // Append Contractor Log
      const newLog: ContractorLogRecord = {
        contractor_log_id: contractorLogId,
        contractor_name: entryForm.contractor_name,
        id_card_number: entryForm.id_card_number,
        phone: entryForm.phone,
        company: entryForm.company,
        target_room: entryForm.target_room,
        target_unit_id: entryForm.target_unit_id || undefined,
        unit_lookup_status: entryForm.unit_lookup_status,
        owner_name: entryForm.owner_name,
        work_type: entryForm.work_type,
        entry_time: nowStr,
        id_card_photo_url: idPhotoUrl,
        face_photo_url: facePhotoUrl,
        status: 'กำลังปฏิบัติงาน',
        recorded_by: guardName,
        note: entryForm.note,
        created_at: nowStr,
        updated_at: nowStr
      };

      await appendSheetRow('ContractorLogs', newLog);

      // Write Audit log
      await appendSheetRow('AuditLogs', {
        audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
        user_name: guardName,
        action: 'ลงทะเบียนผู้รับเหมาเข้าทำงาน',
        module_name: 'ContractorLogs',
        record_id: contractorLogId,
        old_value: '',
        new_value: entryForm.contractor_name,
        created_at: nowStr
      });

      setStatusMessage({ type: 'success', text: `ลงทะเบียนผู้รับเหมา "${entryForm.contractor_name}" สำเร็จ!` });

      // Reset
      setEntryForm({
        contractor_name: '',
        id_card_number: '',
        phone: '',
        company: '',
        target_room: '',
        target_unit_id: '',
        unit_lookup_status: undefined,
        owner_name: '',
        work_type: 'ซ่อมระบบแสงสว่าง',
        note: ''
      });
      setIdCardPhoto('');
      setFacePhoto('');
      setBlacklistWarning(null);
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleExitClick = async (contractor: ContractorLogRecord) => {
    setContractorToExit(contractor);
    setShowExitModal(true);
  };

  const handleConfirmExit = async () => {
    if (!contractorToExit) return;
    const contractor = contractorToExit;
    setShowExitModal(false);
    setContractorToExit(null);

    setLoading(true);
    setStatusMessage(null);

    try {
      const nowStr = new Date().toISOString();

      await updateSheetRow<ContractorLogRecord>('ContractorLogs', 'contractor_log_id', contractor.contractor_log_id, {
        exit_time: nowStr,
        status: 'ออกแล้ว',
        updated_at: nowStr
      });

      // Write Audit log
      await appendSheetRow('AuditLogs', {
        audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
        user_name: guardName,
        action: 'บันทึกผู้รับเหมาออกจากอาคาร',
        module_name: 'ContractorLogs',
        record_id: contractor.contractor_log_id,
        old_value: 'กำลังปฏิบัติงาน',
        new_value: 'ออกแล้ว',
        created_at: nowStr
      });

      setStatusMessage({ type: 'success', text: `บันทึกผู้รับเหมา "${contractor.contractor_name}" ออกจากพื้นที่เรียบร้อย` });
      fetchInitialData();
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const filteredContractors = workingContractors.filter(c => 
    c.contractor_name.includes(exitSearchQuery) || 
    c.company.includes(exitSearchQuery) ||
    c.target_room.includes(exitSearchQuery)
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
          ผู้รับเหมาเข้า (Contractor Entry)
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
          ผู้รับเหมาออก (Contractor Exit)
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
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          <h2 className="text-lg font-black text-slate-800">ลงทะเบียนรายละเอียดผู้รับเหมา / ช่างเข้ามาทำงาน</h2>

          {blacklistWarning && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-300 rounded-xl text-red-800 font-bold text-sm shadow-sm">
              <ShieldX className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
              <span>{blacklistWarning}</span>
            </div>
          )}

          <form onSubmit={handleEntrySubmit} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ชื่อ-นามสกุลช่าง *</label>
                <input
                  type="text"
                  value={entryForm.contractor_name}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, contractor_name: e.target.value }))}
                  placeholder="เช่น นายมานะ ยอดฝีมือ"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                  required
                />
              </div>

              {/* National ID */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">เลขบัตรประจำตัวประชาชน *</label>
                <input
                  type="text"
                  value={entryForm.id_card_number}
                  onChange={(e) => handleIDCardChange(e.target.value)}
                  placeholder="เช่น 1209900123456 (13 หลัก)"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold font-mono"
                  required
                />
              </div>

              {/* Phone */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">เบอร์โทรศัพท์ช่าง *</label>
                <input
                  type="tel"
                  value={entryForm.phone}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="เช่น 0891234567"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold font-mono"
                  required
                />
              </div>

              {/* Company */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ชื่อบริษัท / ห้างร้านที่สังกัด</label>
                <input
                  type="text"
                  value={entryForm.company}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, company: e.target.value }))}
                  placeholder="เช่น บจก. ซ่อมแอร์จำกัด"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                />
              </div>

              <UnitSearchSelect value={entryForm.target_room} selectedUnitId={entryForm.target_unit_id}
                label="ห้องที่จะเข้าปฏิบัติงาน" required allowManualEntry
                onSelect={unit => setEntryForm(prev => ({ ...prev, target_room: unit?.room_number || '', owner_name: unit?.owner_name || '', target_unit_id: unit?.unit_id || '', unit_lookup_status: unit ? (unit.unit_id ? 'matched' : 'manual') : undefined }))} />

              {/* Room Owner Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ชื่อเจ้าของห้อง / ผู้ว่าจ้าง</label>
                <input
                  type="text"
                  value={entryForm.owner_name}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, owner_name: e.target.value }))}
                  placeholder="เช่น คุณรัตนา หรือ นิติบุคคล"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                />
              </div>

              {/* Work Type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ประเภทงานช่าง</label>
                <select
                  value={entryForm.work_type}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, work_type: e.target.value }))}
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none bg-white focus:border-indigo-600 text-sm font-semibold"
                >
                  <option value="ซ่อมระบบไฟ">⚡ ซ่อมระบบไฟฟ้า</option>
                  <option value="ซ่อมประปา">💧 ซ่อมประปา/สุขภัณฑ์</option>
                  <option value="ติดตั้งอินเทอร์เน็ต">🌐 ติดตั้งสายอินเทอร์เน็ต/ทีวี</option>
                  <option value="ล้างแอร์">❄️ ล้างเครื่องปรับอากาศ</option>
                  <option value="ตกแต่งต่อเติม">🛠️ ตกแต่งอินทีเรีย/ต่อเติมโครงสร้าง</option>
                  <option value="อื่นๆ">🔨 อื่นๆ (ระบุด้านล่าง)</option>
                </select>
              </div>

              {/* Note */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">หมายเหตุเพิ่มเติม</label>
                <input
                  type="text"
                  value={entryForm.note}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="เช่น ขนย้ายแผ่นไม้ขึ้นบันไดหนีไฟ"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                />
              </div>
            </div>

            {/* Photos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              {/* ID Card Photo */}
              <div className="flex flex-col gap-2 border border-slate-200 rounded-xl p-4 bg-slate-50">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                  <Camera className="w-4 h-4 text-indigo-600" />
                  ถ่ายรูปบัตรประชาชน / ใบขับขี่ *
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handlePhotoUpload(e, setIdCardPhoto)}
                  className="hidden"
                  id="contractor-id-upload"
                />
                <label
                  htmlFor="contractor-id-upload"
                  className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-slate-100 transition-colors"
                >
                  {idCardPhoto ? (
                    <img src={idCardPhoto} alt="Contractor ID" className="h-full w-full object-cover rounded-lg" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <Camera className="w-8 h-8" />
                      <span className="text-xs font-bold">กดสแกน/ถ่ายรูปบัตรประจำตัว</span>
                    </div>
                  )}
                </label>
              </div>

              {/* Face Photo */}
              <div className="flex flex-col gap-2 border border-slate-200 rounded-xl p-4 bg-slate-50">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                  <Camera className="w-4 h-4 text-indigo-600" />
                  ถ่ายรูปภาพใบหน้าผู้รับเหมา *
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handlePhotoUpload(e, setFacePhoto)}
                  className="hidden"
                  id="contractor-face-upload"
                />
                <label
                  htmlFor="contractor-face-upload"
                  className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-slate-100 transition-colors"
                >
                  {facePhoto ? (
                    <img src={facePhoto} alt="Contractor Face" className="h-full w-full object-cover rounded-lg" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <Camera className="w-8 h-8" />
                      <span className="text-xs font-bold">กดเพื่อถ่ายภาพใบหน้า</span>
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
              {loading ? 'กำลังอัปโหลดและบันทึกข้อมูล...' : '💾 บันทึกลงทะเบียนผู้รับเหมาเสร็จสมบูรณ์'}
            </button>
          </form>
        </div>
      ) : (
        /* EXIT TAB */
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          <h2 className="text-lg font-black text-slate-800">ผู้รับเหมา / ช่างที่กำลังปฏิบัติงานในอาคาร</h2>
          
          <div className="relative">
            <Search className="absolute left-3.5 top-3.5 text-slate-400 w-5 h-5" />
            <input
              type="text"
              value={exitSearchQuery}
              onChange={(e) => setExitSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อช่าง, บริษัท หรือห้องที่มาซ่อม..."
              className="w-full pl-11 pr-4 py-3 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
            />
          </div>

          {loading && (
            <div className="py-10 text-center font-bold text-slate-500 animate-pulse text-sm">
              กำลังเชื่อมต่อฐานข้อมูลรายชื่อช่าง...
            </div>
          )}

          {!loading && workingContractors.length === 0 && (
            <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
              <Users className="w-12 h-12 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-bold">ไม่มีผู้รับเหมาจดแจ้งทำงานในระบบ ณ ขณะนี้</p>
            </div>
          )}

          {!loading && workingContractors.length > 0 && (
            <div className="flex flex-col gap-3">
              {filteredContractors.map((c) => (
                <div
                  key={c.contractor_log_id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl gap-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl shrink-0 mt-1">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-base font-black text-slate-800">{c.contractor_name}</span>
                      <p className="text-xs text-slate-500 font-bold mt-0.5">
                        {c.company || 'ไม่ระบุบริษัท'} • ซ่อม: <span className="text-indigo-600">{c.work_type}</span>
                      </p>
                      <p className="text-[11px] text-slate-400 font-medium mt-1">
                        📍 ปฏิบัติงานห้อง: <span className="text-slate-700 font-bold">{c.target_room}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex sm:flex-col items-end gap-3 justify-between sm:justify-center border-t sm:border-t-0 border-slate-200 pt-2 sm:pt-0">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-mono">
                        เข้า: {new Date(c.entry_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                      </span>
                    </div>
                    <button
                      onClick={() => handleExitClick(c)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      🚪 สิ้นสุดงานและออกจากพื้นที่
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={showExitModal}
        title="ยืนยันบันทึกเวลาออก"
        message={`คุณต้องการบันทึกผู้รับเหมา "${contractorToExit?.contractor_name}" สิ้นสุดการปฏิบัติงานและออกจากพื้นที่โครงการหรือไม่?`}
        confirmText="ยืนยันบันทึกออก"
        cancelText="ยกเลิก"
        onConfirm={handleConfirmExit}
        onCancel={() => {
          setShowExitModal(false);
          setContractorToExit(null);
        }}
      />
    </div>
  );
}
