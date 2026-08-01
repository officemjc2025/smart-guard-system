/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, MapPin, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { PatrolLogRecord, PatrolPointRecord } from '../types';
import { completePatrolCheckin, listPatrolLogs, listActivePatrolPoints, listPatrolRevisions } from '../services/patrolService';
import { validatePatrolCheckinDraft } from '../services/patrolPolicy';
import { extractPrivateMediaFileId, uploadImageToDrive } from '../services/mediaUploadService';
import { createUuid } from '../utils/uuid';
import { stampEvidenceImage } from '../utils/evidenceStamp';
import { formatThaiDateTime } from '../utils/dateTime';
import AuthenticatedEvidenceImage from './AuthenticatedEvidenceImage';
import { patrolLifecycle } from '../services/operationalLifecycle';
import OperationalCorrectionDialog from './OperationalCorrectionDialog';
import RevisionHistoryPanel from './RevisionHistoryPanel';

interface PatrolLogsProps { guardName: string; userRole: string }
type PhotoSlot = 1 | 2;

export default function PatrolLogs({ guardName }: PatrolLogsProps) {
  const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';
  const [points, setPoints] = useState<PatrolPointRecord[]>([]);
  const [logs, setLogs] = useState<PatrolLogRecord[]>([]);
  const [pointId, setPointId] = useState('');
  const [customLocation, setCustomLocation] = useState('');
  const [additionalLocation, setAdditionalLocation] = useState('');
  const [areaStatus, setAreaStatus] = useState<'' | 'normal' | 'abnormal'>('');
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<Record<PhotoSlot, File | null>>({ 1: null, 2: null });
  const [previews, setPreviews] = useState<Record<PhotoSlot, string>>({ 1: '', 2: '' });
  const [references, setReferences] = useState<Record<PhotoSlot, string>>({ 1: '', 2: '' });
  const [patrolLogId, setPatrolLogId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [correction, setCorrection] = useState<PatrolLogRecord | null>(null);
  const [history, setHistory] = useState<PatrolLogRecord | null>(null);
  const submitFlight = useRef<Promise<void> | null>(null);
  const previewUrls = useRef<Set<string>>(new Set());

  const reload = async () => {
    const [activePoints, patrolLogs] = await Promise.all([
      listActivePatrolPoints(siteId),
      listPatrolLogs(siteId),
    ]);
    setPoints(activePoints);
    setLogs(patrolLogs.filter(item => patrolLifecycle(item as unknown as Record<string, unknown>).current));
  };

  useEffect(() => {
    void reload().catch(error => setMessage({
      type: 'error',
      text: error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูล Patrol ได้',
    }));
  }, []);
  useEffect(() => () => {
    previewUrls.current.forEach(url => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  const selectedPoint = points.find(point => point.patrol_point_id === pointId);
  const pointName = selectedPoint?.point_name || customLocation.trim();

  const selectPhoto = (slot: PhotoSlot, file: File | undefined) => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    previewUrls.current.add(preview);
    setPhotos(current => ({ ...current, [slot]: file }));
    setPreviews(current => {
      if (current[slot]) {
        URL.revokeObjectURL(current[slot]);
        previewUrls.current.delete(current[slot]);
      }
      return { ...current, [slot]: preview };
    });
    setReferences(current => ({ ...current, [slot]: '' }));
  };

  const clearPhoto = (slot: PhotoSlot) => {
    setPhotos(current => ({ ...current, [slot]: null }));
    setPreviews(current => {
      if (current[slot]) {
        URL.revokeObjectURL(current[slot]);
        previewUrls.current.delete(current[slot]);
      }
      return { ...current, [slot]: '' };
    });
    setReferences(current => ({ ...current, [slot]: '' }));
  };

  const submit = async () => {
    const draft = {
      patrolPointId: selectedPoint?.patrol_point_id || '',
      patrolPointName: selectedPoint?.point_name || '',
      customLocation,
      areaStatus,
      abnormalReason: reason,
      photo1: photos[1],
      photo2: photos[2],
    };
    validatePatrolCheckinDraft(draft);
    const recordId = patrolLogId || `PL_${createUuid()}`;
    if (!patrolLogId) setPatrolLogId(recordId);
    const capturedAt = new Date();
    let photo1Reference = references[1];
    if (!photo1Reference) {
      photo1Reference = await uploadImageToDrive(
        await stampEvidenceImage(draft.photo1!, { locationName: pointName, capturedAt }),
        `patrol_photo_1_${recordId}.jpg`,
        { moduleName: 'PatrolLogs', recordId, siteId, uploadedBy: guardName, mediaType: 'patrol_photo_1' },
      );
      setReferences(current => ({ ...current, 1: photo1Reference }));
    }
    let photo2Reference = references[2];
    if (draft.photo2 && !photo2Reference) {
      photo2Reference = await uploadImageToDrive(
        await stampEvidenceImage(draft.photo2, { locationName: pointName, capturedAt }),
        `patrol_photo_2_${recordId}.jpg`,
        { moduleName: 'PatrolLogs', recordId, siteId, uploadedBy: guardName, mediaType: 'patrol_photo_2' },
      );
      setReferences(current => ({ ...current, 2: photo2Reference }));
    }
    const photo2Fields = photo2Reference ? {
      incident_photo_url: photo2Reference,
      evidence_photo_2_url: photo2Reference,
      evidence_photo_2_file_id: extractPrivateMediaFileId(photo2Reference),
    } : {};
    const completed = await completePatrolCheckin(siteId, {
      patrol_log_id: recordId,
      patrol_point_id: selectedPoint?.patrol_point_id || '',
      point_name: pointName,
      patrol_point_name: selectedPoint?.point_name || pointName,
      custom_location: selectedPoint ? additionalLocation.trim() : customLocation.trim(),
      guard_name: guardName,
      shift_type: new Date().getHours() < 18 ? 'เช้า' : 'กลางคืน',
      photo_url: photo1Reference,
      evidence_photo_1_url: photo1Reference,
      evidence_photo_1_file_id: extractPrivateMediaFileId(photo1Reference),
      ...photo2Fields,
      status: areaStatus === 'normal' ? 'ปกติ' : 'ผิดปกติ',
      area_status: areaStatus,
      abnormal_detail: areaStatus === 'abnormal' ? reason.trim() : '',
      abnormal_reason: areaStatus === 'abnormal' ? reason.trim() : '',
      captured_at_client: capturedAt.toISOString(),
      workflow_status: 'completed',
    });
    setMessage({ type: 'success', text: `บันทึก ${completed.point_name} เมื่อ ${formatThaiDateTime(completed.checkin_time)}` });
    setPointId('');
    setCustomLocation('');
    setAdditionalLocation('');
    setAreaStatus('');
    setReason('');
    setPhotos({ 1: null, 2: null });
    previewUrls.current.forEach(url => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    setPreviews({ 1: '', 2: '' });
    setReferences({ 1: '', 2: '' });
    setPatrolLogId('');
    await reload();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitFlight.current) return;
    setLoading(true);
    setMessage(null);
    const flight = submit()
      .catch(error => setMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        if (submitFlight.current === flight) submitFlight.current = null;
        setLoading(false);
      });
    submitFlight.current = flight;
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-1 pb-10">
      {message && <div className={`rounded-xl border p-4 text-sm font-bold ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.text}</div>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-black"><ShieldCheck className="text-emerald-600" />บันทึกผลการตรวจจุด</h2>
        <label className="text-xs font-bold">จุดตรวจ *</label>
        <select value={pointId} onChange={event => { setPointId(event.target.value); setCustomLocation(''); }} className="rounded-xl border-2 border-slate-200 p-3.5">
          <option value="">เลือกจุดตรวจ</option>
          {points.map(point => <option key={point.patrol_point_id} value={point.patrol_point_id}>{point.point_name}</option>)}
          <option value="custom">สถานที่อื่น / ระบุเอง</option>
        </select>
        {pointId === 'custom' ? (
          <input value={customLocation} onChange={event => setCustomLocation(event.target.value)} placeholder="ระบุสถานที่ตรวจ" className="rounded-xl border-2 border-slate-200 p-3.5" />
        ) : pointId && (
          <input value={additionalLocation} onChange={event => setAdditionalLocation(event.target.value)} placeholder="สถานที่เพิ่มเติม / จุดสังเกต (ไม่บังคับ)" className="rounded-xl border-2 border-slate-200 p-3.5" />
        )}
        <label className="text-xs font-bold">สถานะพื้นที่ *</label>
        <select value={areaStatus} onChange={event => setAreaStatus(event.target.value as typeof areaStatus)} className="rounded-xl border-2 border-slate-200 p-3.5">
          <option value="">เลือกสถานะ</option><option value="normal">ปกติ</option><option value="abnormal">ไม่ปกติ</option>
        </select>
        <textarea value={reason} onChange={event => setReason(event.target.value)} required={areaStatus === 'abnormal'} placeholder={areaStatus === 'abnormal' ? 'รายละเอียด/เหตุผลความผิดปกติ *' : 'รายละเอียดเพิ่มเติม (ไม่บังคับ)'} className="rounded-xl border-2 border-slate-200 p-3.5" rows={3} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {([1, 2] as const).map(slot => (
            <div key={slot} className="rounded-xl border border-slate-200 p-3">
              <span className="text-xs font-bold">
                {slot === 1 ? 'รูปหลักฐานจุดตรวจ 1 *' : 'รูปหลักฐานจุดตรวจ 2 (ไม่บังคับ)'}
              </span>
              <input id={`patrol-photo-${slot}`} type="file" accept="image/jpeg,image/png" capture="environment" className="hidden" onChange={event => selectPhoto(slot, event.target.files?.[0])} />
              <label htmlFor={`patrol-photo-${slot}`} className="mt-2 flex h-40 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed">
                {previews[slot] ? <img src={previews[slot]} alt={`รูปหลักฐาน ${slot}`} className="h-full w-full object-cover" /> : <Camera className="text-slate-400" />}
              </label>
              {previews[slot] && <button type="button" onClick={() => clearPhoto(slot)} className="mt-2 flex items-center gap-1 text-xs font-bold text-red-600"><X className="h-3 w-3" />ลบและถ่ายใหม่</button>}
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-xs">ผู้ตรวจ: <b>{guardName}</b><br />เวลาบันทึก: ระบบกำหนดหลัง transaction สำเร็จ</div>
        <button disabled={loading} className="rounded-xl bg-emerald-600 py-4 font-bold text-white disabled:opacity-50">{loading ? 'กำลังบันทึก...' : 'บันทึกผลการตรวจจุดนี้'}</button>
      </form>
      <section className="rounded-2xl border bg-white p-5">
        <div className="mb-3 flex justify-between"><h2 className="font-black">ประวัติจุดตรวจ</h2><button onClick={() => void reload().catch(error => setMessage({ type: 'error', text: error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูล Patrol ได้' }))}><RefreshCw className="h-4 w-4" /></button></div>
        <div className="space-y-3">{logs.map(log => <article key={log.patrol_log_id} className="rounded-xl border p-3">
          <div className="flex justify-between"><b><MapPin className="mr-1 inline h-4 w-4" />{log.patrol_point_name || log.point_name}</b><span className={log.area_status === 'abnormal' || log.status !== 'ปกติ' ? 'text-red-600' : 'text-emerald-600'}>{log.area_status === 'abnormal' || log.status !== 'ปกติ' ? <ShieldAlert className="inline h-4" /> : <Check className="inline h-4" />} {log.status}</span></div>
          <p className="text-xs text-slate-500">{formatThaiDateTime(log.checkin_time)} · {log.guard_name}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[log.evidence_photo_1_url || log.photo_url, log.evidence_photo_2_url || log.incident_photo_url].map((reference, index) => (
              <div key={index}>
                {reference
                  ? <AuthenticatedEvidenceImage mediaReference={reference} alt={`หลักฐาน Patrol ${index + 1}`} className="h-28 w-full rounded-lg object-cover" />
                  : <div className="flex h-28 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400">ไม่มีหลักฐาน</div>}
              </div>
            ))}
          </div>
          {log.has_corrections && <p className="mt-2 text-xs font-bold text-amber-700">Edited · Revision {log.revision_number} · {log.last_edited_by_name} · {formatThaiDateTime(log.last_edited_at)}</p>}
          <div className="mt-2 flex gap-3"><button onClick={() => setCorrection(log)} className="text-xs font-bold text-indigo-600">แก้ไขพร้อม Revision</button><button onClick={() => setHistory(log)} className="text-xs font-bold text-slate-600">ประวัติการแก้ไข</button></div>
        </article>)}</div>
      </section>
      {correction && <OperationalCorrectionDialog module="PatrolLogs" record={correction} siteId={siteId} operatorName={guardName} onClose={() => setCorrection(null)} onSaved={reload} />}
      {history && <RevisionHistoryPanel title={history.patrol_log_id} load={() => listPatrolRevisions(siteId, history.patrol_log_id)} onClose={() => setHistory(null)} />}
    </div>
  );
}
