/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, Clock, Edit, RefreshCw } from 'lucide-react';
import type { IncidentReportRecord, PatrolPointRecord } from '../types';
import { createIncidentReport, listIncidents, transitionIncident, type IncidentAction } from '../services/incidentService';
import { listActivePatrolPoints } from '../services/patrolService';
import { extractPrivateMediaFileId, uploadImageToDrive } from '../services/mediaUploadService';
import { createUuid } from '../utils/uuid';
import { formatThaiDateTime } from '../utils/dateTime';
import AuthenticatedEvidenceImage from './AuthenticatedEvidenceImage';
import UnitSearchSelect from './UnitSearchSelect';
import ConfirmModal from './ConfirmModal';

interface IncidentReportsProps { guardName: string; userRole: string }

const initialForm = () => ({
  incident_datetime: '',
  incident_type: 'อุปกรณ์ชำรุด' as IncidentReportRecord['incident_type'],
  location_type: 'common_area' as NonNullable<IncidentReportRecord['location_type']>,
  location: '',
  target_unit_id: '',
  patrol_point_id: '',
  custom_location: '',
  reporter_name: '',
  involved_parties: '',
  description: '',
  damage_details: '',
  initial_action: '',
  shift_leader: '',
  outcome: 'อยู่ระหว่างดำเนินการ',
  priority: 'Normal' as NonNullable<IncidentReportRecord['priority']>,
});

export default function IncidentReports({ guardName, userRole }: IncidentReportsProps) {
  const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';
  const [activeTab, setActiveTab] = useState<'report' | 'list'>('report');
  const [form, setForm] = useState(initialForm);
  const [points, setPoints] = useState<PatrolPointRecord[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoReference, setPhotoReference] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [incidents, setIncidents] = useState<IncidentReportRecord[]>([]);
  const [selected, setSelected] = useState<IncidentReportRecord | null>(null);
  const [managementNote, setManagementNote] = useState('');
  const [incidentAction, setIncidentAction] = useState<IncidentAction>('acknowledge');
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const submitFlight = useRef<Promise<void> | null>(null);
  const previewUrlRef = useRef('');

  const reload = async () => {
    const [records, patrolPoints] = await Promise.all([listIncidents(siteId), listActivePatrolPoints(siteId)]);
    setIncidents(records);
    setPoints(patrolPoints);
  };
  useEffect(() => {
    void reload().catch(error => setMessage({
      type: 'error',
      text: error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูล Incident ได้',
    }));
  }, [activeTab]);
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  const resolvedLocation = () => {
    if (form.location_type === 'patrol_point') {
      return points.find(point => point.patrol_point_id === form.patrol_point_id)?.point_name || '';
    }
    if (form.location_type === 'custom') return form.custom_location.trim();
    return form.location.trim();
  };

  const createReport = async () => {
    const location = resolvedLocation();
    if (!form.incident_datetime) throw new Error('กรุณาระบุวันและเวลาที่เกิดเหตุ');
    if (!form.incident_type) throw new Error('กรุณาระบุประเภทเหตุการณ์');
    if (!location) throw new Error('กรุณาระบุสถานที่เกิดเหตุ');
    if (!form.description.trim()) throw new Error('กรุณาระบุรายละเอียดเหตุการณ์');
    if (!photoFile) throw new Error('กรุณาแนบรูปหลักฐานเหตุการณ์');
    const recordId = incidentId || `INC_${createUuid()}`;
    if (!incidentId) setIncidentId(recordId);
    let reference = photoReference;
    if (!reference) {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('ไม่สามารถอ่านรูปหลักฐานได้'));
        reader.readAsDataURL(photoFile);
      });
      reference = await uploadImageToDrive(
        dataUrl,
        `incident_photo_${recordId}.jpg`,
        { moduleName: 'IncidentReports', recordId, siteId, uploadedBy: guardName, mediaType: 'incident_photo' },
      );
      setPhotoReference(reference);
    }
    const completed = await createIncidentReport(siteId, {
      incident_id: recordId,
      incident_datetime: new Date(form.incident_datetime).toISOString(),
      location,
      location_type: form.location_type,
      location_name_snapshot: location,
      target_unit_id: form.target_unit_id || undefined,
      unit_lookup_status: form.location_type === 'unit' ? 'matched' : undefined,
      patrol_point_id: form.patrol_point_id || undefined,
      custom_location: form.custom_location.trim() || undefined,
      incident_type: form.incident_type,
      description: form.description.trim(),
      photo_url: reference,
      photo_file_id: extractPrivateMediaFileId(reference),
      reported_by: guardName,
      reporter_name: form.reporter_name.trim() || undefined,
      involved_parties: form.involved_parties.trim() || undefined,
      damage_details: form.damage_details.trim() || undefined,
      initial_action: form.initial_action.trim() || undefined,
      shift_leader: form.shift_leader.trim(),
      outcome: form.outcome,
      priority: form.priority,
      status: 'แจ้งแล้ว',
    });
    setMessage({ type: 'success', text: `บันทึกรายงาน ${completed.incident_id} เมื่อ ${formatThaiDateTime(completed.reported_at || completed.created_at)}` });
    setForm(initialForm());
    setPhotoFile(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setPhotoPreview('');
    setPhotoReference('');
    setIncidentId('');
    await reload();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitFlight.current) return;
    setLoading(true);
    setMessage(null);
    const flight = createReport()
      .catch(error => setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        if (submitFlight.current === flight) submitFlight.current = null;
        setLoading(false);
      });
    submitFlight.current = flight;
  };

  const confirmUpdate = async () => {
    if (!selected) return;
    setShowConfirm(false);
    setLoading(true);
    try {
      await transitionIncident(siteId, selected.incident_id, incidentAction, guardName, managementNote);
      setSelected(null);
      setManagementNote('');
      await reload();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-1 pb-10">
      <div className="flex border-b"><button onClick={() => setActiveTab('report')} className="flex-1 p-4 font-bold">แจ้งเหตุใหม่</button><button onClick={() => setActiveTab('list')} className="flex-1 p-4 font-bold">Incident Log</button></div>
      {message && <div className={`rounded-xl border p-4 text-sm font-bold ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{message.text}</div>}
      {activeTab === 'report' ? <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-black"><AlertTriangle className="text-red-600" />รายงานเหตุการณ์</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold">วันและเวลาที่เกิดเหตุ *<input type="datetime-local" value={form.incident_datetime} onChange={e => setForm(current => ({ ...current, incident_datetime: e.target.value }))} className="mt-1 w-full rounded-xl border-2 p-3" /></label>
          <label className="text-xs font-bold">ประเภทเหตุการณ์ *<select value={form.incident_type} onChange={e => setForm(current => ({ ...current, incident_type: e.target.value as IncidentReportRecord['incident_type'] }))} className="mt-1 w-full rounded-xl border-2 p-3"><option>บุคคลต้องสงสัย</option><option>ทะเลาะวิวาท</option><option>โจรกรรม/ลักทรัพย์</option><option>อุบัติเหตุ</option><option>อัคคีภัย</option><option>น้ำท่วม/ท่อแตก</option><option>อุปกรณ์ชำรุด</option><option>อื่นๆ</option></select></label>
        </div>
        <label className="text-xs font-bold">ประเภทสถานที่ *<select value={form.location_type} onChange={e => setForm(current => ({ ...current, location_type: e.target.value as typeof form.location_type, location: '', target_unit_id: '', patrol_point_id: '', custom_location: '' }))} className="mt-1 w-full rounded-xl border-2 p-3"><option value="unit">ห้องชุด</option><option value="patrol_point">จุดตรวจ</option><option value="common_area">พื้นที่ส่วนกลาง</option><option value="custom">อื่น ๆ / ระบุเอง</option></select></label>
        {form.location_type === 'unit' ? <UnitSearchSelect value={form.location} selectedUnitId={form.target_unit_id} label="ห้องชุด *" required onSelect={unit => setForm(current => ({ ...current, location: unit?.room_number || '', target_unit_id: unit?.unit_id || '' }))} /> :
          form.location_type === 'patrol_point' ? <select value={form.patrol_point_id} onChange={e => setForm(current => ({ ...current, patrol_point_id: e.target.value }))} className="rounded-xl border-2 p-3"><option value="">เลือกจุดตรวจ</option>{points.map(point => <option key={point.patrol_point_id} value={point.patrol_point_id}>{point.point_name}</option>)}</select> :
            form.location_type === 'custom' ? <input value={form.custom_location} onChange={e => setForm(current => ({ ...current, custom_location: e.target.value }))} placeholder="ระบุสถานที่เกิดเหตุ *" className="rounded-xl border-2 p-3" /> :
              <input value={form.location} onChange={e => setForm(current => ({ ...current, location: e.target.value }))} placeholder="ระบุพื้นที่ส่วนกลาง *" className="rounded-xl border-2 p-3" />}
        <input value={form.reporter_name} onChange={e => setForm(current => ({ ...current, reporter_name: e.target.value }))} placeholder="ผู้พบเหตุ / ผู้แจ้งเหตุ" className="rounded-xl border-2 p-3" />
        <input value={form.involved_parties} onChange={e => setForm(current => ({ ...current, involved_parties: e.target.value }))} placeholder="ผู้เกี่ยวข้อง / บุคคล / รถ / ทรัพย์สิน" className="rounded-xl border-2 p-3" />
        <textarea value={form.description} onChange={e => setForm(current => ({ ...current, description: e.target.value }))} placeholder="เหตุการณ์เกิดขึ้นอย่างไร *" rows={4} className="rounded-xl border-2 p-3" />
        <details className="rounded-xl border p-3"><summary className="cursor-pointer font-bold">ข้อมูลการดำเนินการเพิ่มเติม</summary><div className="mt-3 flex flex-col gap-3"><textarea value={form.damage_details} onChange={e => setForm(current => ({ ...current, damage_details: e.target.value }))} placeholder="ความเสียหายที่พบ" className="rounded-xl border p-3" /><textarea value={form.initial_action} onChange={e => setForm(current => ({ ...current, initial_action: e.target.value }))} placeholder="การดำเนินการเบื้องต้น" className="rounded-xl border p-3" /><input value={form.shift_leader} onChange={e => setForm(current => ({ ...current, shift_leader: e.target.value }))} placeholder="ผู้ได้รับแจ้ง / หัวหน้าชุด" className="rounded-xl border p-3" /></div></details>
        <label className="text-xs font-bold">ระดับความเร่งด่วน<select value={form.priority} onChange={e => setForm(current => ({ ...current, priority: e.target.value as typeof form.priority }))} className="mt-1 w-full rounded-xl border-2 p-3"><option value="Low">ต่ำ</option><option value="Normal">ปกติ</option><option value="High">สูง</option><option value="Emergency">ฉุกเฉิน</option></select></label>
        <div className="rounded-xl border p-3"><span className="text-xs font-bold">รูปหลักฐาน *</span><input id="incident-photo" type="file" accept="image/jpeg,image/png" capture="environment" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = URL.createObjectURL(file); setPhotoFile(file); setPhotoPreview(previewUrlRef.current); setPhotoReference(''); }} /><label htmlFor="incident-photo" className="mt-2 flex h-40 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed">{photoPreview ? <img src={photoPreview} alt="รูปหลักฐาน Incident" className="h-full w-full object-cover" /> : <Camera className="text-slate-400" />}</label></div>
        <div className="rounded-xl bg-slate-50 p-3 text-xs">ผู้บันทึก: <b>{guardName}</b><br />เวลารับรายงาน: ระบบกำหนดหลังบันทึกสำเร็จ</div>
        <button disabled={loading} className="rounded-xl bg-red-600 py-4 font-bold text-white disabled:opacity-50">{loading ? 'กำลังบันทึก...' : 'ยืนยันบันทึกรายงานเหตุการณ์'}</button>
      </form> : <section className="rounded-2xl border bg-white p-5">
        <div className="mb-3 flex justify-between"><h2 className="font-black">Incident Log</h2><button onClick={() => void reload()}><RefreshCw className="h-4 w-4" /></button></div>
        <div className="space-y-3">{incidents.map(incident => <article key={incident.incident_id} className="rounded-xl border p-4"><div className="flex justify-between"><b>{incident.incident_type}</b><span>{incident.incident_status || incident.status}</span></div><p className="text-xs text-slate-500"><Clock className="inline h-3" /> เหตุเกิด {formatThaiDateTime(incident.incident_datetime)} · รับรายงาน {formatThaiDateTime(incident.reported_at || incident.created_at)}</p><p className="text-sm">📍 {incident.location_name_snapshot || incident.location}</p><p className="text-sm">{incident.description}</p>{incident.photo_url && <AuthenticatedEvidenceImage mediaReference={incident.photo_url} alt={`หลักฐาน ${incident.incident_id}`} className="mt-2 h-40 w-full rounded-lg object-cover" />}{['Manager', 'Admin'].includes(userRole) && <button onClick={() => { setSelected(incident); setIncidentAction(incident.incident_status === 'resolved' ? 'close' : incident.incident_status === 'acknowledged' ? 'start' : incident.incident_status === 'in_progress' ? 'resolve' : 'acknowledge'); setManagementNote(incident.management_note || ''); }} className="mt-2 flex items-center gap-1 text-xs font-bold text-indigo-600"><Edit className="h-3" />จัดการเหตุ</button>}</article>)}</div>
        {selected && <div className="mt-4 rounded-xl border bg-slate-50 p-4"><select value={incidentAction} onChange={e => setIncidentAction(e.target.value as IncidentAction)} className="w-full rounded-xl border p-3"><option value="acknowledge">รับทราบแล้ว</option><option value="start">เริ่มดำเนินการ</option><option value="resolve">แก้ไขแล้ว</option><option value="close">ปิดเหตุ</option></select><textarea value={managementNote} onChange={e => setManagementNote(e.target.value)} placeholder="สรุปการดำเนินการ/การแก้ไข" className="mt-3 w-full rounded-xl border p-3" /><button onClick={() => setShowConfirm(true)} className="mt-3 w-full rounded-xl bg-indigo-600 p-3 font-bold text-white">บันทึกการดำเนินการ</button></div>}
      </section>}
      <ConfirmModal isOpen={showConfirm} title="ยืนยันอัปเดต Incident" message="ยืนยันการเปลี่ยนสถานะและบันทึกการดำเนินการ?" confirmText="ยืนยัน" cancelText="ยกเลิก" onConfirm={() => void confirmUpdate()} onCancel={() => setShowConfirm(false)} />
    </div>
  );
}
