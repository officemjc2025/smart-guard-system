import { useState, type FormEvent } from 'react';
import { Camera, X } from 'lucide-react';
import type { IncidentReportRecord, PatrolLogRecord } from '../types';
import { correctIncident } from '../services/incidentService';
import { correctPatrolLog } from '../services/patrolService';
import { extractPrivateMediaFileId, uploadImageToDrive } from '../services/mediaUploadService';

type Props = {
  module: 'IncidentReports' | 'PatrolLogs';
  record: IncidentReportRecord | PatrolLogRecord;
  siteId: string;
  operatorName: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

const fileDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปได้'));
  reader.readAsDataURL(file);
});

export default function OperationalCorrectionDialog(props: Props) {
  const incident = props.module === 'IncidentReports' ? props.record as IncidentReportRecord : null;
  const patrol = props.module === 'PatrolLogs' ? props.record as PatrolLogRecord : null;
  const [values, setValues] = useState<Record<string, string>>(incident ? {
    incident_datetime: incident.incident_datetime?.slice(0, 16) || '', incident_type: incident.incident_type,
    location: incident.location, description: incident.description, priority: incident.priority || 'Normal',
    remarks: incident.remarks || '',
  } : {
    patrol_point_name: patrol?.patrol_point_name || patrol?.point_name || '',
    custom_location: patrol?.custom_location || '', abnormal_reason: patrol?.abnormal_reason || '',
    remarks: patrol?.remarks || '',
  });
  const [photos, setPhotos] = useState<Record<number, File | null>>({ 1: null, 2: null });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (field: string, value: string) => setValues(current => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const changes: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(values)) {
        const current = (props.record as unknown as Record<string, unknown>)[field];
        const normalized = field === 'incident_datetime' && value ? new Date(String(value)).toISOString() : value;
        if (String(current ?? '') !== normalized) changes[field] = normalized;
      }
      for (const slot of [1, 2] as const) {
        const file = photos[slot];
        if (!file) continue;
        const mediaType = props.module === 'IncidentReports' ? 'incident_photo' : `patrol_photo_${slot}`;
        const recordId = incident?.incident_id || patrol?.patrol_log_id || '';
        const reference = await uploadImageToDrive(
          await fileDataUrl(file), `${mediaType}_${recordId}_correction_${Date.now()}.jpg`,
          { moduleName: props.module, recordId, siteId: props.siteId, uploadedBy: props.operatorName, mediaType },
        );
        if (incident) { changes.photo_url = reference; changes.photo_file_id = extractPrivateMediaFileId(reference); }
        else {
          changes[`evidence_photo_${slot}_url`] = reference;
          changes[`evidence_photo_${slot}_file_id`] = extractPrivateMediaFileId(reference);
        }
      }
      if (incident) await correctIncident(props.siteId, incident.incident_id, changes, reason);
      else await correctPatrolLog(props.siteId, patrol!.patrol_log_id, changes, reason);
      await props.onSaved(); props.onClose();
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };

  const fields = incident
    ? [['incident_datetime', 'datetime-local', 'วันและเวลาเกิดเหตุ'], ['incident_type', 'text', 'ประเภทเหตุ'], ['location', 'text', 'สถานที่'], ['description', 'textarea', 'รายละเอียด'], ['priority', 'text', 'ความเร่งด่วน'], ['remarks', 'textarea', 'หมายเหตุ']]
    : [['patrol_point_name', 'text', 'จุดตรวจ'], ['custom_location', 'text', 'สถานที่เพิ่มเติม'], ['abnormal_reason', 'textarea', 'รายละเอียดความผิดปกติ'], ['remarks', 'textarea', 'หมายเหตุ']];
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onMouseDown={props.onClose}><form role="dialog" aria-modal="true" aria-label="แก้ไขพร้อมบันทึก Revision" onMouseDown={event => event.stopPropagation()} onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5">
    <header className="mb-4 flex justify-between"><div><h3 className="font-black">แก้ไขแบบมี Revision</h3><p className="text-xs text-slate-500">ข้อมูลเดิมและรูปเดิมจะยังคงอยู่ในประวัติถาวร</p></div><button type="button" onClick={props.onClose}><X /></button></header>
    <div className="grid gap-3 sm:grid-cols-2">{fields.map(([field, type, label]) => <label key={field} className={`text-xs font-bold ${type === 'textarea' ? 'sm:col-span-2' : ''}`}>{label}{type === 'textarea' ? <textarea value={values[field]} onChange={event => set(field, event.target.value)} className="mt-1 w-full rounded-xl border p-3" /> : <input type={type} value={values[field]} onChange={event => set(field, event.target.value)} className="mt-1 w-full rounded-xl border p-3" />}</label>)}</div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{(incident ? [1] : [1, 2]).map(slot => <label key={slot} className="cursor-pointer rounded-xl border-2 border-dashed p-4 text-center text-xs font-bold"><Camera className="mx-auto mb-1" />{photos[slot]?.name || `เปลี่ยนรูปหลักฐาน ${slot}`}<input type="file" accept="image/jpeg,image/png" className="hidden" onChange={event => setPhotos(current => ({ ...current, [slot]: event.target.files?.[0] || null }))} /></label>)}</div>
    <label className="mt-4 block text-xs font-bold">เหตุผลการแก้ไข *<textarea required value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label>
    {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    <button disabled={busy} className="mt-4 w-full rounded-xl bg-indigo-600 py-3 font-bold text-white disabled:opacity-50">{busy ? 'กำลังบันทึก...' : 'บันทึกการแก้ไขและ Revision'}</button>
  </form></div>;
}
