/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Users, Search, Check, AlertTriangle, ShieldAlert,
  ArrowUpRight, ArrowDownLeft, Camera, ShieldX, Clock, ClipboardCopy, Info
} from 'lucide-react';
import { readSheet, appendSheetRow, updateSheetRow, uploadImageToDrive } from '../googleApi';
import { ContractorLogRecord, BlacklistRecord } from '../types';
import { UnitSearchSelect } from './UnitSearchSelect';

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
  const [exitCount, setExitCount] = useState<number>(1);
  const [exitAll, setExitAll] = useState<boolean>(false);

  // Blacklist
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const [blacklistWarning, setBlacklistWarning] = useState<string | null>(null);

  // Entry Form State - Updated for Team Management
  const [entryForm, setEntryForm] = useState<{
    contractor_name: string;
    id_card_number: string;
    phone: string;
    company: string;
    target_room: string;
    owner_name: string;
    work_type: string;
    note: string;
    target_unit_id?: string;
    unit_lookup_status?: 'matched' | 'manual';
    team_member_count: string;
    team_member_names: string;
    group_note: string;
    work_permit_number: string;
    hiring_party: string;
  }>({
    contractor_name: '',
    id_card_number: '',
    phone: '',
    company: '',
    target_room: '',
    owner_name: '',
    work_type: 'ซ่อมระบบแสงสว่าง',
    note: '',
    target_unit_id: '',
    unit_lookup_status: undefined,
    team_member_count: '0',
    team_member_names: '',
    group_note: '',
    work_permit_number: '',
    hiring_party: ''
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
      let uploadFailed = false;

      if (idCardPhoto) {
        try {
          idPhotoUrl = await uploadImageToDrive(idCardPhoto, `contractor_id_${entryForm.id_card_number}_${Date.now()}.jpg`);
        } catch (uploadErr) {
          console.error('[ContractorLogs] ID card photo upload failed:', uploadErr);
          uploadFailed = true;
          idPhotoUrl = '';
        }
      }
      if (facePhoto) {
        try {
          facePhotoUrl = await uploadImageToDrive(facePhoto, `contractor_face_${entryForm.id_card_number}_${Date.now()}.jpg`);
        } catch (uploadErr) {
          console.error('[ContractorLogs] Face photo upload failed:', uploadErr);
          uploadFailed = true;
          facePhotoUrl = '';
        }
      }

      const nowStr = new Date().toISOString();
      const contractorLogId = 'CON' + Math.floor(Math.random() * 1000000);

      const parsedTeamCount = Math.max(0, parseInt(entryForm.team_member_count, 10) || 0);
      const computedTotalPeople = 1 + parsedTeamCount;

      // Append Contractor Log with new schema fields
      const newLog: ContractorLogRecord = {
        contractor_log_id: contractorLogId,
        contractor_name: entryForm.contractor_name,
        id_card_number: entryForm.id_card_number,
        phone: entryForm.phone,
        company: entryForm.company,
        target_room: entryForm.target_room,
        owner_name: entryForm.owner_name,
        target_unit_id: entryForm.target_unit_id,
        unit_lookup_status: entryForm.unit_lookup_status,
        work_type: entryForm.work_type,
        entry_time: nowStr,
        id_card_photo_url: idPhotoUrl,
        face_photo_url: facePhotoUrl,
        status: 'กำลังปฏิบัติงาน',
        recorded_by: guardName,
        note: entryForm.note,
        created_at: nowStr,
        updated_at: nowStr,
        // Added Team fields
        team_member_count: parsedTeamCount,
        total_people: computedTotalPeople,
        team_member_names: entryForm.team_member_names,
        group_note: entryForm.group_note,
        work_permit_number: entryForm.work_permit_number,
        hiring_party: entryForm.hiring_party,
        people_exited: 0,
        people_remaining: computedTotalPeople,
        exit_all_confirmed: false
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
        new_value: `${entryForm.contractor_name} (รวมกำลังพล ${computedTotalPeople} คน)`,
        created_at: nowStr
      });

      if (uploadFailed) {
        setStatusMessage({ 
          type: 'error', 
          text: `อัปโหลดรูปไม่สำเร็จ แต่บันทึกข้อมูลผู้รับเหมาเรียบร้อย` 
        });
      } else {
        setStatusMessage({ 
          type: 'success', 
          text: `ลงทะเบียนผู้รับเหมา "${entryForm.contractor_name}" สำเร็จ! (กำลังพลทั้งหมดในกลุ่ม: ${computedTotalPeople} คน)` 
        });
      }

      // Reset Form
      setEntryForm({
        contractor_name: '',
        id_card_number: '',
        phone: '',
        company: '',
        target_room: '',
        owner_name: '',
        work_type: 'ซ่อมระบบแสงสว่าง',
        note: '',
        target_unit_id: '',
        unit_lookup_status: undefined,
        team_member_count: '0',
        team_member_names: '',
        group_note: '',
        work_permit_number: '',
        hiring_party: ''
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
    const remaining = contractor.people_remaining ?? contractor.total_people ?? 1;
    setExitCount(remaining);
    setExitAll(remaining <= 1);
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
      const isTeam = (contractor.total_people || 1) > 1;

      let isAllExit = true;
      let finalExitCount = 1;

      if (isTeam) {
        finalExitCount = exitCount;
        isAllExit = exitAll || (finalExitCount === (contractor.people_remaining ?? contractor.total_people ?? 1));
      }

      const oldRemaining = contractor.people_remaining ?? contractor.total_people ?? 1;
      const oldExited = contractor.people_exited ?? 0;
      const newRemaining = Math.max(0, oldRemaining - finalExitCount);
      const newExited = (contractor.total_people || 1) - newRemaining;

      const updatedFields: Partial<ContractorLogRecord> = {
        people_exited: isAllExit ? (contractor.total_people || 1) : newExited,
        people_remaining: isAllExit ? 0 : newRemaining,
        exit_all_confirmed: isAllExit,
        status: isAllExit ? 'ออกแล้ว' : 'กำลังปฏิบัติงาน',
        exit_time: isAllExit ? nowStr : undefined,
        updated_at: nowStr
      };

      await updateSheetRow<ContractorLogRecord>('ContractorLogs', 'contractor_log_id', contractor.contractor_log_id, updatedFields);

      // Write Audit log
      if (isAllExit) {
        await appendSheetRow('AuditLogs', {
          audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
          user_name: guardName,
          action: 'บันทึกผู้รับเหมาออกจากอาคาร',
          module_name: 'ContractorLogs',
          record_id: contractor.contractor_log_id,
          old_value: 'กำลังปฏิบัติงาน',
          new_value: 'ออกแล้ว (ออกครบทั้งหมด)',
          created_at: nowStr
        });
      } else {
        await appendSheetRow('AuditLogs', {
          audit_id: 'AUD' + Math.floor(Math.random() * 1000000),
          user_name: guardName,
          action: 'บันทึกออกจากอาคารบางส่วน',
          module_name: 'ContractorLogs',
          record_id: contractor.contractor_log_id,
          old_value: `คงเหลือ ${oldRemaining} คน`,
          new_value: `ออกเพิ่ม ${finalExitCount} คน, คงเหลือ ${newRemaining} คน`,
          created_at: nowStr
        });
      }

      setStatusMessage({ 
        type: 'success', 
        text: isAllExit 
          ? `บันทึกผู้รับเหมา "${contractor.contractor_name}" ออกจากพื้นที่เรียบร้อย (ครบถ้วนทุกราย)` 
          : `บันทึกออกแบบบางส่วนสำหรับทีมของ "${contractor.contractor_name}" สำเร็จ (ออกเพิ่ม ${finalExitCount} คน, คงเหลือในพื้นที่อีก ${newRemaining} คน)`
      });
      fetchInitialData();
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const filteredContractors = workingContractors.filter(c => 
    c.contractor_name.toLowerCase().includes(exitSearchQuery.toLowerCase()) || 
    (c.company && c.company.toLowerCase().includes(exitSearchQuery.toLowerCase())) ||
    c.target_room.toLowerCase().includes(exitSearchQuery.toLowerCase())
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
                <label className="text-[15px] font-bold text-slate-700">ชื่อ-นามสกุลช่างคุมงาน *</label>
                <input
                  type="text"
                  value={entryForm.contractor_name}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, contractor_name: e.target.value }))}
                  placeholder="เช่น นายมานะ ยอดฝีมือ"
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold"
                  required
                />
              </div>

              {/* National ID */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[15px] font-bold text-slate-700">เลขบัตรประจำตัวประชาชน *</label>
                <input
                  type="text"
                  value={entryForm.id_card_number}
                  onChange={(e) => handleIDCardChange(e.target.value)}
                  placeholder="เช่น 1209900123456 (13 หลัก)"
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold font-mono"
                  required
                />
              </div>

              {/* Phone */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[15px] font-bold text-slate-700">เบอร์โทรศัพท์ช่าง *</label>
                <input
                  type="tel"
                  value={entryForm.phone}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="เช่น 0891234567"
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold font-mono"
                  required
                />
              </div>

              {/* Company */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[15px] font-bold text-slate-700">ชื่อบริษัท / ห้างร้านที่สังกัด</label>
                <input
                  type="text"
                  value={entryForm.company}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, company: e.target.value }))}
                  placeholder="เช่น บจก. ซ่อมแอร์จำกัด"
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold"
                />
              </div>

              {/* Target Room */}
              <div className="flex flex-col gap-1.5">
                <UnitSearchSelect
                  value={entryForm.target_room}
                  selectedUnitId={entryForm.target_unit_id}
                  allowManualEntry={true}
                  label="ห้องที่จะเข้าปฏิบัติงาน"
                  placeholder="พิมพ์ค้นหาเลขห้องชุด, เจ้าของ หรือเบอร์..."
                  required={true}
                  onSelect={(unit) => {
                    if (unit) {
                      setEntryForm(prev => ({
                        ...prev,
                        target_room: unit.room_number,
                        owner_name: unit.owner_name || '',
                        target_unit_id: unit.unit_id || '',
                        unit_lookup_status: unit.unit_id ? 'matched' : 'manual'
                      }));
                    } else {
                      setEntryForm(prev => ({
                        ...prev,
                        target_room: '',
                        owner_name: '',
                        target_unit_id: '',
                        unit_lookup_status: undefined
                      }));
                    }
                  }}
                />
              </div>

              {/* Room Owner Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[15px] font-bold text-slate-700">ชื่อเจ้าของห้องชุด</label>
                <input
                  type="text"
                  value={entryForm.owner_name}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, owner_name: e.target.value }))}
                  placeholder="ดึงข้อมูลอัตโนมัติ หรือระบุชื่อผู้ครอบครองห้อง..."
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold"
                />
              </div>

              {/* Hiring Party (New) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[15px] font-bold text-slate-700">ชื่อผู้ว่าจ้าง / หน่วยงานที่จ้างงาน</label>
                <input
                  type="text"
                  value={entryForm.hiring_party}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, hiring_party: e.target.value }))}
                  placeholder="เช่น นิติบุคคลอาคารชุด, โครงการแกรนด์วิลล์"
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold"
                />
              </div>

              {/* Work Permit Number (New) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[15px] font-bold text-slate-700">เลขที่ใบอนุญาตทำงาน (Work Permit #)</label>
                <input
                  type="text"
                  value={entryForm.work_permit_number}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, work_permit_number: e.target.value }))}
                  placeholder="เช่น WP-2026/089"
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold font-mono"
                />
              </div>

              {/* Work Type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[15px] font-bold text-slate-700">ประเภทงานช่าง</label>
                <select
                  value={entryForm.work_type}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, work_type: e.target.value }))}
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none bg-white focus:border-indigo-600 text-[17px] font-semibold"
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
                <label className="text-[15px] font-bold text-slate-700">หมายเหตุภารกิจเพิ่มเติม</label>
                <input
                  type="text"
                  value={entryForm.note}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="เช่น ขนย้ายแผ่นไม้ขึ้นบันไดหนีไฟ"
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold"
                />
              </div>
            </div>

            {/* UPGRADED: Team & Group Details Section */}
            <div className="border border-slate-200 rounded-xl p-5 bg-indigo-50/20 flex flex-col gap-4 mt-2">
              <span className="text-sm font-black text-indigo-700 uppercase tracking-wider flex items-center gap-1">
                <Users className="w-4 h-4" />
                กำลังพลและรายละเอียดสมาชิกทีมร่วมงาน (Contractor Team Management)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Team member count */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[15px] font-bold text-slate-700">จำนวนผู้ร่วมทีม (ไม่รวมช่างหลัก) *</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={0}
                      value={entryForm.team_member_count}
                      onChange={(e) => {
                        const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                        setEntryForm(prev => ({ ...prev, team_member_count: String(val) }));
                      }}
                      className="flex-1 p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold"
                      required
                    />
                    <div className="px-4 py-3 border border-slate-200 bg-white rounded-xl text-center min-w-[120px] shadow-sm">
                      <span className="text-[11px] font-extrabold text-slate-400 block">กำลังพลรวม</span>
                      <span className="text-lg font-black text-indigo-600">{1 + (parseInt(entryForm.team_member_count, 10) || 0)} คน</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 font-semibold">ระบุจำนวนผู้ติดตามร่วมทำงานที่ไม่ใช่หัวหน้าช่างหลัก</p>
                </div>

                {/* Group work detail note */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[15px] font-bold text-slate-700">ประเภทงานกลุ่มย่อย / แผนผังปฏิบัติการ</label>
                  <textarea
                    value={entryForm.group_note}
                    onChange={(e) => setEntryForm(prev => ({ ...prev, group_note: e.target.value }))}
                    placeholder="ระบุ เช่น ช่างไฟ 1 คน, ช่างประปา 2 คน คุมหน้างานร่วมกัน"
                    className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold h-[86px]"
                  />
                </div>
              </div>

              {/* Team member names */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[15px] font-bold text-slate-700">รายชื่อสมาชิกในทีม (ชื่อ-นามสกุล และ เลขบัตรประชาชน ถ้ามี)</label>
                <textarea
                  value={entryForm.team_member_names}
                  onChange={(e) => setEntryForm(prev => ({ ...prev, team_member_names: e.target.value }))}
                  placeholder="เช่น&#10;1. นายสมศักดิ์ รักดี (1209900445566)&#10;2. นายวิชาญ มั่นคง"
                  className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold font-mono"
                  rows={3}
                />
              </div>
            </div>

            {/* Photos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              {/* ID Card Photo */}
              <div className="flex flex-col gap-2 border border-slate-200 rounded-xl p-4 bg-slate-50">
                <span className="text-[15px] font-bold text-slate-700 flex items-center gap-1">
                  <Camera className="w-4 h-4 text-indigo-600" />
                  ถ่ายรูปบัตรประชาชน / ใบขับขี่คุมงาน *
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
                  className="flex flex-col items-center justify-center h-36 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-slate-100 transition-colors"
                >
                  {idCardPhoto ? (
                    <img src={idCardPhoto} alt="Contractor ID" className="h-full w-full object-cover rounded-lg" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <Camera className="w-8 h-8" />
                      <span className="text-[15px] font-bold">กดสแกน/ถ่ายรูปบัตรช่างหลัก</span>
                    </div>
                  )}
                </label>
              </div>

              {/* Face Photo */}
              <div className="flex flex-col gap-2 border border-slate-200 rounded-xl p-4 bg-slate-50">
                <span className="text-[15px] font-bold text-slate-700 flex items-center gap-1">
                  <Camera className="w-4 h-4 text-indigo-600" />
                  ถ่ายรูปภาพใบหน้าผู้รับเหมาคุมงาน *
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
                  className="flex flex-col items-center justify-center h-36 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-slate-100 transition-colors"
                >
                  {facePhoto ? (
                    <img src={facePhoto} alt="Contractor Face" className="h-full w-full object-cover rounded-lg" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <Camera className="w-8 h-8" />
                      <span className="text-[15px] font-bold">กดเพื่อถ่ายภาพใบหน้าช่างหลัก</span>
                    </div>
                  )}
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full h-[60px] flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer text-[17px]"
            >
              {loading ? 'กำลังส่งข้อมูลและอัปโหลดหลักฐาน...' : '💾 บันทึกลงทะเบียนทีมผู้รับเหมาเข้าพื้นที่'}
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
              placeholder="ค้นหาชื่อช่าง, บริษัท, WP หรือห้องที่มาซ่อม..."
              className="w-full pl-11 pr-4 py-3 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold animate-none"
            />
          </div>

          {loading && (
            <div className="py-10 text-center font-bold text-slate-500 animate-pulse text-sm">
              กำลังเชื่อมต่อฐานข้อมูลรายชื่อทีมช่าง...
            </div>
          )}

          {!loading && workingContractors.length === 0 && (
            <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
              <Users className="w-12 h-12 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-bold">ไม่มีผู้รับเหมาปฏิบัติงานในระบบ ณ ขณะนี้</p>
            </div>
          )}

          {!loading && workingContractors.length > 0 && (
            <div className="flex flex-col gap-4">
              {filteredContractors.map((c) => {
                const isGroup = (c.total_people || 1) > 1;
                const peopleRemaining = c.people_remaining ?? c.total_people ?? 1;
                const peopleExited = c.people_exited ?? 0;

                return (
                  <div
                    key={c.contractor_log_id}
                    className="flex flex-col p-5 bg-slate-50 border border-slate-200 rounded-2xl gap-4 hover:border-slate-300 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl shrink-0 mt-1">
                          <Users className="w-6 h-6" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base font-black text-slate-800">{c.contractor_name}</span>
                            {c.work_permit_number && (
                              <span className="text-[11px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-md font-mono">
                                📄 WP: {c.work_permit_number}
                              </span>
                            )}
                          </div>
                          
                          <p className="text-xs text-slate-500 font-bold">
                            {c.company || 'ไม่ระบุบริษัท'} • ซ่อม: <span className="text-indigo-600">{c.work_type}</span>
                          </p>
                          
                          {/* Room Details & Hiring Party */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 font-medium mt-1">
                            <span>📍 ปฏิบัติงานห้อง: <span className="text-slate-700 font-extrabold">{c.target_room}</span></span>
                            {c.hiring_party && (
                              <span>🏢 ผู้ว่าจ้าง: <span className="text-slate-600 font-extrabold">{c.hiring_party}</span></span>
                            )}
                          </div>

                          {/* Team Info Badge */}
                          {isGroup && (
                            <div className="mt-2.5 p-2 bg-indigo-50/50 border border-indigo-100/50 rounded-xl inline-flex flex-col gap-1.5">
                              <span className="text-xs text-indigo-800 font-extrabold flex items-center gap-1">
                                👥 ข้อมูลกลุ่มทำงาน: ทั้งหมด {c.total_people} คน (ช่างหลัก 1 คน + สมาชิก {c.team_member_count} คน)
                              </span>
                              <div className="flex gap-4 text-[11px] font-extrabold text-slate-500">
                                <span>🚪 ออกแล้ว: <span className="text-emerald-600 font-black">{peopleExited} คน</span></span>
                                <span>🏡 คงเหลือในสนาม: <span className="text-indigo-600 font-black">{peopleRemaining} คน</span></span>
                              </div>
                              {c.team_member_names && (
                                <div className="text-[11px] text-slate-400 border-t border-indigo-100/30 pt-1.5 mt-0.5 font-mono max-h-16 overflow-y-auto whitespace-pre-line leading-relaxed">
                                  <strong>รายชื่อผู้ร่วมทีม:</strong> {c.team_member_names}
                                </div>
                              )}
                              {c.group_note && (
                                <div className="text-[11px] text-slate-400 font-mono leading-relaxed">
                                  <strong>ภารกิจกลุ่ม:</strong> {c.group_note}
                                </div>
                              )}
                            </div>
                          )}

                          {c.note && (
                            <p className="text-xs text-slate-400 italic mt-1 font-medium bg-slate-100/50 p-2 border border-slate-200/50 rounded-lg">
                              📌 หมายเหตุ: {c.note}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-end gap-3 justify-between sm:justify-center border-t sm:border-t-0 border-slate-200 pt-3 sm:pt-0 shrink-0">
                        <div className="text-right">
                          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 justify-end">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            เข้า: {new Date(c.entry_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                          </span>
                        </div>
                        <button
                          onClick={() => handleExitClick(c)}
                          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all shadow-sm cursor-pointer"
                        >
                          🚪 {isGroup ? 'บันทึกออก / ออกบางส่วน' : 'สิ้นสุดงานและออกจากพื้นที่'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CUSTOM POPUP CONFIRM MODAL (Supports partial exit and complete team exits) */}
      {showExitModal && contractorToExit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { setShowExitModal(false); setContractorToExit(null); }} />
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl z-10 w-full max-w-lg text-left relative flex flex-col gap-4 animate-none">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
              บันทึกรายงานการออกจากพื้นที่โครงการ
            </h3>
            
            <div className="flex flex-col gap-1">
              <span className="text-xs font-extrabold text-slate-400 block uppercase">หัวหน้าช่าง / ช่างหลัก</span>
              <span className="text-[17px] font-black text-slate-800 leading-tight">{contractorToExit.contractor_name}</span>
              <span className="text-xs text-slate-500 font-bold">{contractorToExit.company || 'ไม่ระบุบริษัท'}</span>
            </div>
            
            {/* If has team members, offer partial exit option */}
            {((contractorToExit.total_people || 1) > 1) ? (
              <div className="bg-slate-50 p-4 border border-slate-200 rounded-xl flex flex-col gap-3.5">
                <span className="text-xs font-black text-indigo-700 uppercase tracking-wider flex items-center gap-1">
                  <Info className="w-4 h-4" />
                  ระบบจัดการออกแบบรายกลุ่ม (Group Exit Manager)
                </span>
                
                <div className="grid grid-cols-2 gap-4 bg-white p-3 border border-slate-100 rounded-lg">
                  <div>
                    <span className="text-[11px] text-slate-400 block font-bold">จำนวนคนเข้าตั้งต้น</span>
                    <span className="text-base font-black text-slate-800">{contractorToExit.total_people} คน</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block font-bold">คงเหลือในพื้นที่</span>
                    <span className="text-base font-black text-indigo-600">{contractorToExit.people_remaining ?? contractorToExit.total_people} คน</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="text-[15px] font-bold text-slate-700">จำนวนกำลังพลที่ประสงค์จะออกเพิ่มในครั้งนี้ *</label>
                  <input
                    type="number"
                    min={1}
                    max={contractorToExit.people_remaining ?? contractorToExit.total_people ?? 1}
                    value={exitCount}
                    onChange={(e) => {
                      const maxLimit = contractorToExit.people_remaining ?? contractorToExit.total_people ?? 1;
                      const val = Math.min(
                        maxLimit,
                        Math.max(1, parseInt(e.target.value, 10) || 1)
                      );
                      setExitCount(val);
                      if (val === maxLimit) {
                        setExitAll(true);
                      } else {
                        setExitAll(false);
                      }
                    }}
                    className="p-4 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-[17px] font-semibold"
                  />
                  <p className="text-xs text-slate-400 font-semibold">ระบุจำนวนคนที่จะออกในรอบนี้ (รวมหัวหน้าหรือผู้ติดตามกี่คน)</p>
                </div>

                <div className="flex items-center gap-2.5 mt-1 p-1 border-t border-slate-100 pt-3">
                  <input
                    type="checkbox"
                    id="exit-all-checkbox"
                    checked={exitAll}
                    onChange={(e) => {
                      setExitAll(e.target.checked);
                      if (e.target.checked) {
                        setExitCount(contractorToExit.people_remaining ?? contractorToExit.total_people ?? 1);
                      }
                    }}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer shrink-0"
                  />
                  <label htmlFor="exit-all-checkbox" className="text-xs font-extrabold text-slate-700 cursor-pointer">
                    ยืนยันออกครบทั้งหมดทุกคนในกลุ่ม (บันทึกเสร็จสิ้นภารกิจทั้งหมด)
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 font-bold bg-indigo-50 border border-indigo-100 p-3 rounded-lg leading-relaxed">
                ℹ️ บันทึกการปฏิบัติงานแบบช่างรายเดียว จะทำรายการออกจากอาคารเสร็จสมบูรณ์ทันทีโดยไม่แยกชำระออกจากกลุ่ม
              </p>
            )}

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => { setShowExitModal(false); setContractorToExit(null); }}
                className="flex-1 h-[60px] border-2 border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl transition-all text-[15px]"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmExit}
                className="flex-1 h-[60px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all text-[15px] shadow-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                💾 ยืนยันบันทึกออก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
