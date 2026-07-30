/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Clock,
  LogOut,
  Plus,
  Search,
  ShieldX,
  Users,
} from 'lucide-react';
import type {
  BlacklistRecord,
  ContractorActivityType,
  ContractorLogRecord,
} from '../types';
import {
  acquireContractorWorkspace,
  appendContractorActivity,
  completeContractor,
  createContractor,
  getContractor,
  listContractors,
  releaseContractorWorkspace,
  updateContractorWorkspaceRecord,
} from '../services/contractorService';
import { listActiveBlacklist } from '../services/blacklistService';
import { createAuditLog } from '../services/auditService';
import { uploadImageToDrive } from '../services/mediaUploadService';
import {
  activateContractorWorkspace,
  beginContractorWorkspaceRelease,
  CONTRACTOR_ACTIVITY_LABELS,
  contractorFormFromRecord,
  createIdleContractorWorkspace,
  createInitialContractorForm,
  failContractorWorkspaceRelease,
  validateOptionalNationalId,
} from '../services/contractorWorkspace';
import ConfirmModal from './ConfirmModal';
import UnitSearchSelect from './UnitSearchSelect';
import AuthenticatedEvidenceImage from './AuthenticatedEvidenceImage';
import { formatThaiDate, formatThaiTime } from '../utils/dateTime';
import {
  listOfflineContractors,
  queueOfflineContractor,
  removeOfflineContractor,
} from '../services/contractorOfflineQueue';

interface ContractorLogsProps {
  guardName: string;
}

const dateParts = (value?: string) => {
  return {
    date: formatThaiDate(value),
    time: formatThaiTime(value),
  };
};

const isDataImage = (value: string) => value.startsWith('data:image/');

export default function ContractorLogs({ guardName }: ContractorLogsProps) {
  const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const [blacklistWarning, setBlacklistWarning] = useState<string | null>(null);
  const [contractors, setContractors] = useState<ContractorLogRecord[]>([]);
  const [search, setSearch] = useState('');
  const [entryForm, setEntryForm] = useState(createInitialContractorForm);
  const [idCardPhoto, setIdCardPhoto] = useState('');
  const [facePhoto, setFacePhoto] = useState('');
  const [workspace, setWorkspace] = useState(createIdleContractorWorkspace);
  const [activityType, setActivityType] = useState<ContractorActivityType>('remark');
  const [activityNote, setActivityNote] = useState('');
  const [showExitModal, setShowExitModal] = useState(false);
  const offlineSyncRunning = useRef(false);

  const activeContractors = useMemo(
    () => contractors.filter(item => item.status === 'กำลังปฏิบัติงาน'),
    [contractors],
  );
  const exitedCount = contractors.length - activeContractors.length;
  const overtimeCount = activeContractors.filter(item =>
    Date.now() - new Date(item.entry_time).getTime() > 8 * 60 * 60 * 1000).length;
  const filteredContractors = activeContractors.filter(item => {
    const query = search.trim().toLocaleLowerCase();
    return !query || [item.contractor_name, item.company, item.target_room, item.work_type]
      .some(value => String(value || '').toLocaleLowerCase().includes(query));
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [blacklistRecords, contractorRecords] = await Promise.all([
        listActiveBlacklist(siteId),
        listContractors(siteId),
      ]);
      setBlacklist(blacklistRecords);
      setContractors(contractorRecords);
    } catch (reason) {
      setStatusMessage({ type: 'error', text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [siteId]);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      if (!navigator.onLine || offlineSyncRunning.current) return;
      const queued = listOfflineContractors().filter(entry => entry.siteId === siteId);
      if (!queued.length) return;
      offlineSyncRunning.current = true;
      for (const item of queued) {
        if (!active) return;
        try {
          const idPhotoUrl = item.idCardPhotoDataUrl
            ? await uploadImageToDrive(
              item.idCardPhotoDataUrl,
              `contractor_id_offline_${Date.now()}.jpg`,
              { moduleName: 'ContractorLogs', recordId: item.localId, siteId: item.siteId, uploadedBy: item.guardName, mediaType: 'contractor_id' },
            )
            : '';
          const facePhotoUrl = item.facePhotoDataUrl
            ? await uploadImageToDrive(
              item.facePhotoDataUrl,
              `contractor_face_offline_${Date.now()}.jpg`,
              { moduleName: 'ContractorLogs', recordId: item.localId, siteId: item.siteId, uploadedBy: item.guardName, mediaType: 'contractor_face' },
            )
            : '';
          await createContractor(item.siteId, {
            contractor_log_id: item.localId,
            ...item.form,
            target_unit_id: item.form.target_unit_id || undefined,
            id_card_photo_url: idPhotoUrl || undefined,
            face_photo_url: facePhotoUrl || undefined,
            entry_time: item.entryTime,
            status: 'กำลังปฏิบัติงาน',
            recorded_by: item.guardName,
            activities: [{
              activity_id: `CA_${crypto.randomUUID()}`,
              activity_type: 'entered',
              note: 'เข้าพื้นที่ (บันทึก offline)',
              created_at: item.entryTime,
              created_by: item.guardName,
              site_id: item.siteId,
              contractor_id: item.localId,
            }],
          });
          await createAuditLog(item.siteId, {
            audit_id: `AUD_${crypto.randomUUID()}`,
            user_name: item.guardName,
            action: 'ซิงก์ผู้รับเหมาเข้าจาก Offline',
            module_name: 'ContractorLogs',
            record_id: item.localId,
            old_value: 'Offline',
            new_value: item.form.contractor_name,
          });
          removeOfflineContractor(item.localId);
        } catch (reason) {
          console.error('Contractor offline sync failed:', reason);
          offlineSyncRunning.current = false;
          return;
        }
      }
      offlineSyncRunning.current = false;
      if (active) await loadData();
    };
    void sync();
    const handleOnline = () => { void sync(); };
    window.addEventListener('online', handleOnline);
    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
    };
  }, [guardName, siteId]);

  const resetWorkspace = (message?: { type: 'success' | 'error'; text: string }) => {
    setWorkspace(createIdleContractorWorkspace());
    setEntryForm(createInitialContractorForm());
    setIdCardPhoto('');
    setFacePhoto('');
    setBlacklistWarning(null);
    setActivityType('remark');
    setActivityNote('');
    setShowExitModal(false);
    setStatusMessage(message || null);
  };

  const handleIDCardChange = (value: string) => {
    setEntryForm(previous => ({ ...previous, id_card_number: value }));
    const normalized = value.replace(/\s+/g, '');
    const matched = normalized
      ? blacklist.find(item =>
        item.type === 'เลขบัตรประชาชน'
        && item.id_card_number?.replace(/\s+/g, '') === normalized)
      : undefined;
    setBlacklistWarning(matched
      ? `🚨 บัญชีดำ: ${matched.reason} (${matched.severity})`
      : null);
  };

  const handlePhotoUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
    setter: (value: string) => void,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const openWorkspace = async (contractor: ContractorLogRecord) => {
    if (workspace.contractorId && workspace.contractorId !== contractor.contractor_log_id) {
      setStatusMessage({ type: 'error', text: 'กรุณาปลดล็อก Contractor Workspace เดิมก่อนเลือกรายการใหม่' });
      return;
    }
    setLoading(true);
    try {
      const locked = await acquireContractorWorkspace(siteId, contractor.contractor_log_id, guardName);
      setWorkspace(activateContractorWorkspace(locked));
      setEntryForm(contractorFormFromRecord(locked));
      setIdCardPhoto(locked.id_card_photo_url || '');
      setFacePhoto(locked.face_photo_url || '');
      setStatusMessage({ type: 'success', text: `เปิด Workspace ของ ${locked.contractor_name}` });
    } catch (reason) {
      setStatusMessage({ type: 'error', text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setLoading(false);
    }
  };

  const releaseWorkspace = async () => {
    if (!workspace.contractorId) return;
    setLoading(true);
    setWorkspace(previous => beginContractorWorkspaceRelease(previous));
    try {
      await releaseContractorWorkspace(siteId, workspace.contractorId);
      resetWorkspace({ type: 'success', text: 'ปลดล็อก Contractor Workspace แล้ว' });
    } catch (reason) {
      setWorkspace(previous => failContractorWorkspaceRelease(previous, reason));
      setStatusMessage({
        type: 'error',
        text: `ปลดล็อกไม่สำเร็จ ข้อมูลยังอยู่ใน Workspace: ${reason instanceof Error ? reason.message : String(reason)}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const uploadContractorPhotos = async (contractorId: string) => {
    const identity = validateOptionalNationalId(entryForm.id_card_number) || 'no-id';
    const idUrl = isDataImage(idCardPhoto)
      ? await uploadImageToDrive(
        idCardPhoto,
        `contractor_id_${identity}_${Date.now()}.jpg`,
        { moduleName: 'ContractorLogs', recordId: contractorId, siteId, uploadedBy: guardName, mediaType: 'contractor_id' },
      )
      : idCardPhoto;
    const faceUrl = isDataImage(facePhoto)
      ? await uploadImageToDrive(
        facePhoto,
        `contractor_face_${identity}_${Date.now()}.jpg`,
        { moduleName: 'ContractorLogs', recordId: contractorId, siteId, uploadedBy: guardName, mediaType: 'contractor_face' },
      )
      : facePhoto;
    return { idUrl, faceUrl };
  };

  const handleEntrySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (workspace.lifecycle === 'releasing' || workspace.lifecycle === 'release-failed') {
      setStatusMessage({ type: 'error', text: 'ข้อมูลบันทึกแล้วและกำลังรอปลดล็อก กรุณาอย่าบันทึกซ้ำ' });
      return;
    }
    if (!entryForm.contractor_name.trim() || !entryForm.phone.trim() || !entryForm.target_room.trim()) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกชื่อ เบอร์โทร และห้อง/พื้นที่ปฏิบัติงาน' });
      return;
    }
    let contractorSaved = false;
    setLoading(true);
    setStatusMessage(null);
    try {
      const idCardNumber = validateOptionalNationalId(entryForm.id_card_number);
      if (!navigator.onLine) {
        if (workspace.contractorId) {
          throw new Error('ไม่สามารถแก้ไข Contractor ที่ถือ remote lock แบบ offline ได้ กรุณาเชื่อมต่อก่อนบันทึก');
        }
        const localId = `CON_${crypto.randomUUID()}`;
        queueOfflineContractor({
          localId,
          siteId,
          guardName,
          entryTime: new Date().toISOString(),
          form: { ...entryForm, id_card_number: idCardNumber },
          idCardPhotoDataUrl: isDataImage(idCardPhoto) ? idCardPhoto : '',
          facePhotoDataUrl: isDataImage(facePhoto) ? facePhoto : '',
        });
        resetWorkspace({ type: 'success', text: `บันทึก ${entryForm.contractor_name} แบบ Offline แล้ว พร้อมรับรายการใหม่` });
        return;
      }
      const contractorId = workspace.contractorId || `CON_${crypto.randomUUID()}`;
      const { idUrl, faceUrl } = await uploadContractorPhotos(contractorId);
      const baseData = {
        ...entryForm,
        id_card_number: idCardNumber,
        target_unit_id: entryForm.target_unit_id || undefined,
        unit_lookup_status: entryForm.unit_lookup_status,
        id_card_photo_url: idUrl || undefined,
        face_photo_url: faceUrl || undefined,
      };

      if (workspace.contractorId) {
        await updateContractorWorkspaceRecord(siteId, contractorId, baseData);
        contractorSaved = true;
        const latest = await getContractor(siteId, contractorId);
        setWorkspace(activateContractorWorkspace(latest));
        await createAuditLog(siteId, {
          audit_id: `AUD_${crypto.randomUUID()}`,
          user_name: guardName,
          action: 'แก้ไขข้อมูลผู้รับเหมา',
          module_name: 'ContractorLogs',
          record_id: contractorId,
          old_value: workspace.record?.contractor_name || '',
          new_value: entryForm.contractor_name,
        });
        setWorkspace(previous => beginContractorWorkspaceRelease(previous));
        try {
          await releaseContractorWorkspace(siteId, contractorId);
        } catch (reason) {
          setWorkspace(previous => failContractorWorkspaceRelease(previous, reason));
          setStatusMessage({ type: 'error', text: 'บันทึกสำเร็จแล้ว แต่ปลดล็อกไม่สำเร็จ กรุณากด “ลองปลดล็อกอีกครั้ง”' });
          return;
        }
        resetWorkspace({ type: 'success', text: `อัปเดต ${entryForm.contractor_name} สำเร็จ` });
      } else {
        const now = new Date().toISOString();
        await createContractor(siteId, {
          contractor_log_id: contractorId,
          ...baseData,
          entry_time: now,
          status: 'กำลังปฏิบัติงาน',
          recorded_by: guardName,
          activities: [{
            activity_id: `CA_${crypto.randomUUID()}`,
            activity_type: 'entered',
            note: 'เข้าพื้นที่',
            created_at: now,
            created_by: guardName,
            site_id: siteId,
            contractor_id: contractorId,
          }],
        });
        contractorSaved = true;
        await createAuditLog(siteId, {
          audit_id: `AUD_${crypto.randomUUID()}`,
          user_name: guardName,
          action: 'ลงทะเบียนผู้รับเหมาเข้าทำงาน',
          module_name: 'ContractorLogs',
          record_id: contractorId,
          old_value: '',
          new_value: entryForm.contractor_name,
        });
        resetWorkspace({ type: 'success', text: `ลงทะเบียน ${entryForm.contractor_name} สำเร็จ และเพิ่มเข้าคิวแล้ว` });
      }
      await loadData();
    } catch (reason) {
      if (contractorSaved) {
        if (workspace.contractorId) {
          setWorkspace(previous => beginContractorWorkspaceRelease(previous));
          try {
            await releaseContractorWorkspace(siteId, workspace.contractorId);
            resetWorkspace({
              type: 'error',
              text: `ข้อมูลถูกบันทึกและปลดล็อกแล้ว แต่ Audit ล้มเหลว กรุณาอย่าบันทึกซ้ำ: ${reason instanceof Error ? reason.message : String(reason)}`,
            });
          } catch (releaseReason) {
            setWorkspace(previous => failContractorWorkspaceRelease(previous, releaseReason));
            setStatusMessage({
              type: 'error',
              text: 'ข้อมูลถูกบันทึกแล้ว แต่ Audit และการปลดล็อกล้มเหลว กรุณากด “ลองปลดล็อกอีกครั้ง” และอย่าบันทึกซ้ำ',
            });
          }
        } else {
          resetWorkspace({
            type: 'error',
            text: `ข้อมูล Contractor ถูกบันทึกแล้ว แต่ Audit ล้มเหลว กรุณาอย่าบันทึกซ้ำ: ${reason instanceof Error ? reason.message : String(reason)}`,
          });
        }
        await loadData();
      } else {
        setStatusMessage({ type: 'error', text: reason instanceof Error ? reason.message : String(reason) });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddActivity = async () => {
    if (!workspace.contractorId || !activityNote.trim()) return;
    setLoading(true);
    try {
      await appendContractorActivity(
        siteId,
        workspace.contractorId,
        activityType,
        activityNote,
        guardName,
      );
      const latest = await getContractor(siteId, workspace.contractorId);
      setWorkspace(activateContractorWorkspace(latest));
      setActivityNote('');
      setStatusMessage({ type: 'success', text: 'เพิ่มเหตุการณ์แล้ว' });
      await loadData();
    } catch (reason) {
      setStatusMessage({ type: 'error', text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmExit = async () => {
    if (!workspace.contractorId || !workspace.record) return;
    setShowExitModal(false);
    setLoading(true);
    const record = workspace.record;
    let exitCompleted = false;
    try {
      const exitTime = new Date().toISOString();
      await completeContractor(siteId, workspace.contractorId, exitTime, guardName);
      exitCompleted = true;
      await createAuditLog(siteId, {
        audit_id: `AUD_${crypto.randomUUID()}`,
        user_name: guardName,
        action: 'บันทึกผู้รับเหมาออกจากอาคาร',
        module_name: 'ContractorLogs',
        record_id: workspace.contractorId,
        old_value: 'กำลังปฏิบัติงาน',
        new_value: 'ออกแล้ว',
      });
      resetWorkspace({ type: 'success', text: `บันทึก ${record.contractor_name} ออกจากพื้นที่แล้ว` });
      await loadData();
    } catch (reason) {
      if (exitCompleted) {
        resetWorkspace({
          type: 'error',
          text: `ลงเวลาออกและปลดล็อกสำเร็จแล้ว แต่ Audit ล้มเหลว: ${reason instanceof Error ? reason.message : String(reason)}`,
        });
        await loadData();
      } else {
        setStatusMessage({ type: 'error', text: reason instanceof Error ? reason.message : String(reason) });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-1 pb-10">
      {statusMessage && (
        <div className={`flex items-start gap-2 rounded-xl border p-4 text-sm font-semibold ${
          statusMessage.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {statusMessage.type === 'success' ? <Check className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-700">อยู่ในพื้นที่</p><p className="text-2xl font-black text-emerald-900">{activeContractors.length}</p></div>
        <div className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-bold text-slate-600">ออกแล้ว</p><p className="text-2xl font-black text-slate-900">{exitedCount}</p></div>
        <div className="rounded-xl bg-amber-50 p-4"><p className="text-xs font-bold text-amber-700">เกิน 8 ชั่วโมง</p><p className="text-2xl font-black text-amber-900">{overtimeCount}</p></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-black text-slate-800">ผู้รับเหมาที่อยู่ในพื้นที่</h2>
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ค้นหาชื่อ บริษัท ห้อง งาน" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-xs" />
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {filteredContractors.map(contractor => {
            const entry = dateParts(contractor.entry_time);
            return (
              <button key={contractor.contractor_log_id} type="button" onClick={() => void openWorkspace(contractor)} className="min-w-64 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left hover:border-indigo-400">
                <p className="font-black text-slate-800">{contractor.contractor_name}</p>
                <p className="text-xs text-slate-500">{contractor.company || 'ไม่ระบุบริษัท'} · {contractor.target_room}</p>
                <p className="mt-1 text-xs font-bold text-indigo-700">{contractor.work_type}</p>
                <p className="mt-2 text-[11px] text-slate-500">เข้า {entry.date} · {entry.time} | ออก —</p>
              </button>
            );
          })}
          {!filteredContractors.length && <p className="py-6 text-sm text-slate-400">ไม่มีผู้รับเหมาอยู่ในพื้นที่</p>}
        </div>
        {!!exitedCount && (
          <div className="mt-4 border-t border-slate-200 pt-3">
            <p className="mb-2 text-xs font-black text-slate-600">รายการออกล่าสุด</p>
            <div className="space-y-2">
              {contractors.filter(item => item.status === 'ออกแล้ว').slice(0, 5).map(contractor => {
                const entry = dateParts(contractor.entry_time);
                const exit = dateParts(contractor.exit_time);
                return <div key={contractor.contractor_log_id} className="grid grid-cols-1 gap-1 rounded-lg bg-slate-50 p-2 text-xs sm:grid-cols-[1fr_auto_auto]"><span className="font-bold text-slate-700">{contractor.contractor_name}</span><span>เข้า {entry.date} · {entry.time}</span><span>ออก {exit.date} · {exit.time}</span></div>;
              })}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-slate-800">{workspace.record ? `Workspace: ${workspace.record.contractor_name}` : 'ลงทะเบียนผู้รับเหมาเข้า'}</h2>
            <p className="text-xs text-slate-500">Workspace: {workspace.lifecycle} · Contractor Record: {workspace.record?.status || 'รายการใหม่'}</p>
          </div>
          {workspace.contractorId && (
            <button type="button" onClick={() => void releaseWorkspace()} disabled={loading || workspace.lifecycle === 'releasing'} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {workspace.lifecycle === 'release-failed' ? 'ลองปลดล็อกอีกครั้ง' : 'พักและปลดล็อก'}
            </button>
          )}
        </div>

        {blacklistWarning && <div className="mb-4 flex gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800"><ShieldX className="h-5 w-5" />{blacklistWarning}</div>}

        <form onSubmit={handleEntrySubmit} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-600">ชื่อ-นามสกุล *<input required value={entryForm.contractor_name} onChange={event => setEntryForm(previous => ({ ...previous, contractor_name: event.target.value }))} className="mt-1 w-full rounded-xl border-2 border-slate-200 p-3 text-sm" /></label>
            <label className="text-xs font-bold text-slate-600">เลขบัตรประชาชน (ไม่บังคับ)<input inputMode="numeric" value={entryForm.id_card_number} onChange={event => handleIDCardChange(event.target.value)} placeholder="13 หลัก หรือเว้นว่าง" className="mt-1 w-full rounded-xl border-2 border-slate-200 p-3 text-sm" /></label>
            <label className="text-xs font-bold text-slate-600">เบอร์โทร *<input required value={entryForm.phone} onChange={event => setEntryForm(previous => ({ ...previous, phone: event.target.value }))} className="mt-1 w-full rounded-xl border-2 border-slate-200 p-3 text-sm" /></label>
            <label className="text-xs font-bold text-slate-600">บริษัท<input value={entryForm.company} onChange={event => setEntryForm(previous => ({ ...previous, company: event.target.value }))} className="mt-1 w-full rounded-xl border-2 border-slate-200 p-3 text-sm" /></label>
            <UnitSearchSelect value={entryForm.target_room} selectedUnitId={entryForm.target_unit_id} label="ห้อง/พื้นที่ปฏิบัติงาน" required allowManualEntry onSelect={unit => setEntryForm(previous => ({ ...previous, target_room: unit?.room_number || '', owner_name: unit?.owner_name || '', target_unit_id: unit?.unit_id || '', unit_lookup_status: unit ? (unit.unit_id ? 'matched' : 'manual') : undefined }))} />
            <label className="text-xs font-bold text-slate-600">ผู้ว่าจ้าง<input value={entryForm.owner_name} onChange={event => setEntryForm(previous => ({ ...previous, owner_name: event.target.value }))} className="mt-1 w-full rounded-xl border-2 border-slate-200 p-3 text-sm" /></label>
            <label className="text-xs font-bold text-slate-600">ประเภทงาน<select value={entryForm.work_type} onChange={event => setEntryForm(previous => ({ ...previous, work_type: event.target.value }))} className="mt-1 w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm"><option>ซ่อมระบบแสงสว่าง</option><option>ซ่อมระบบไฟ</option><option>ซ่อมประปา</option><option>ติดตั้งอินเทอร์เน็ต</option><option>ล้างแอร์</option><option>ตกแต่งต่อเติม</option><option>อื่นๆ</option></select></label>
            <label className="text-xs font-bold text-slate-600">หมายเหตุ<input value={entryForm.note} onChange={event => setEntryForm(previous => ({ ...previous, note: event.target.value }))} className="mt-1 w-full rounded-xl border-2 border-slate-200 p-3 text-sm" /></label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { id: 'contractor-id-upload', label: 'รูปบัตรประชาชน/ใบขับขี่ (ไม่บังคับ)', value: idCardPhoto, setter: setIdCardPhoto },
              { id: 'contractor-face-upload', label: 'รูปผู้รับเหมา (ไม่บังคับ)', value: facePhoto, setter: setFacePhoto },
            ].map(photo => (
              <div key={photo.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-xs font-bold text-slate-600">{photo.label}</p>
                <input id={photo.id} type="file" accept="image/*" capture="environment" onChange={event => handlePhotoUpload(event, photo.setter)} className="hidden" />
                <label htmlFor={photo.id} className="flex h-28 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-white">
                  {photo.value
                    ? isDataImage(photo.value)
                      ? <img src={photo.value} alt={photo.label} className="h-full w-full object-cover" />
                      : <AuthenticatedEvidenceImage mediaReference={photo.value} alt={photo.label} className="h-full w-full object-cover" />
                    : <Camera className="h-8 w-8 text-slate-300" />}
                </label>
              </div>
            ))}
          </div>

          <button disabled={loading} className="rounded-xl bg-indigo-600 py-4 text-sm font-bold text-white disabled:opacity-50">{loading ? 'กำลังบันทึก...' : workspace.contractorId ? 'บันทึกข้อมูลเพิ่มเติม' : 'ลงทะเบียนเข้า'}</button>
        </form>

        {workspace.record && (
          <div className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="mb-3 font-black text-slate-800">Contractor Activity</h3>
            <div className="mb-4 max-h-56 space-y-2 overflow-y-auto">
              {(workspace.record.activities || []).map(activity => {
                const time = dateParts(activity.created_at);
                return <div key={activity.activity_id} className="flex gap-3 rounded-lg bg-slate-50 p-3 text-xs"><Clock className="h-4 w-4 text-indigo-600" /><div><p className="font-bold">{time.time} · {CONTRACTOR_ACTIVITY_LABELS[activity.activity_type]}</p><p className="text-slate-600">{activity.note}</p><p className="text-[10px] text-slate-400">{activity.created_by}</p></div></div>;
              })}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
              <select value={activityType} onChange={event => setActivityType(event.target.value as ContractorActivityType)} className="rounded-lg border border-slate-200 p-2 text-xs"><option value="warning">ตักเตือน</option><option value="violation">การฝ่าฝืน</option><option value="remark">หมายเหตุ</option><option value="custom">กำหนดเอง</option></select>
              <input value={activityNote} onChange={event => setActivityNote(event.target.value)} placeholder="รายละเอียดเหตุการณ์" className="rounded-lg border border-slate-200 p-2 text-xs" />
              <button type="button" onClick={() => void handleAddActivity()} disabled={!activityNote.trim() || loading} className="flex items-center justify-center gap-1 rounded-lg bg-indigo-100 px-3 py-2 text-xs font-bold text-indigo-800 disabled:opacity-50"><Plus className="h-4 w-4" />เพิ่มเหตุการณ์</button>
            </div>
            <button type="button" onClick={() => setShowExitModal(true)} disabled={loading} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white"><LogOut className="h-4 w-4" />ลงเวลาออก</button>
          </div>
        )}
      </section>

      <ConfirmModal
        isOpen={showExitModal}
        title="ยืนยันลงเวลาออก"
        message={`ยืนยันว่า ${workspace.record?.contractor_name || 'ผู้รับเหมา'} ออกจากพื้นที่แล้วหรือไม่?`}
        confirmText="ยืนยันออก"
        cancelText="ยกเลิก"
        onConfirm={() => void handleConfirmExit()}
        onCancel={() => setShowExitModal(false)}
      />
    </div>
  );
}
