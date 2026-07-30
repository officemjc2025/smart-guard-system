import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentSnapshot, DocumentData } from 'firebase/firestore';
import type { VehicleSessionRecord } from '../types';
import {
  listSessionActivities,
  mergeLegacyAndSubcollectionActivities,
  subscribeRecentSessionActivities,
  appendSessionActivity,
  type VehicleActivitySeverity,
  type VehicleActivityType,
  type SessionActivityRecord,
} from '../services/vehicleSessionActivityService';
import { uploadImageToDrive } from '../services/mediaUploadService';
import { runSingleFlight } from '../utils/singleFlight';
import AuthenticatedEvidenceImage from './AuthenticatedEvidenceImage';

export default function VehicleSessionTimeline({ session, actorName, actorRole }: { session: VehicleSessionRecord; actorName?: string; actorRole?: string }) {
  const [activities, setActivities] = useState<SessionActivityRecord[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activityType, setActivityType] = useState<VehicleActivityType>('Remark');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [severity, setSeverity] = useState<VehicleActivitySeverity>('Normal');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [message, setMessage] = useState('');
  const submitRef = useRef<Promise<void> | null>(null);

  useEffect(() => subscribeRecentSessionActivities(session.session_id, setActivities), [session.session_id]);
  const merged = useMemo(
    () => mergeLegacyAndSubcollectionActivities(session.activity, activities),
    [session.activity, activities],
  );

  const loadMore = async () => {
    const page = await listSessionActivities(session.session_id, 25, cursor);
    setActivities(current => {
      const byId = new Map(current.map(item => [item.client_event_id, item]));
      page.activities.forEach(item => byId.set(item.client_event_id, item));
      return [...byId.values()];
    });
    setCursor(page.cursor);
    setHasMore(page.hasMore);
  };

  const submitActivity = () => runSingleFlight(submitRef, async () => {
    setMessage('');
    const eventId = `ACT_${crypto.randomUUID()}`;
    let photoUrls: string[] = [];
    if (photoDataUrl) {
      const url = await uploadImageToDrive(photoDataUrl, `vehicle_activity_${eventId}.jpg`, {
        moduleName: 'VehicleSessionActivities',
        recordId: eventId,
        siteId: session.site_id,
        uploadedBy: actorName || '',
        mediaType: 'activity_evidence',
      });
      photoUrls = [url];
    }
    try {
      await appendSessionActivity({
        sessionId: session.session_id,
        siteId: session.site_id,
        action: 'VehicleActivityAdded',
        fromStage: session.stage,
        toStage: session.stage,
        fromStatus: session.status,
        toStatus: session.status,
        actorName: actorName || '',
        actorRole: actorRole || '',
        details: {},
        clientEventId: eventId,
        vehicleLogId: session.vehicle_log_id,
        activityType,
        title: activityType,
        description,
        location,
        severity,
        activityStatus: 'Recorded',
        photoUrls,
      });
      setDescription('');
      setLocation('');
      setPhotoDataUrl('');
      setShowForm(false);
      setMessage('บันทึกเหตุการณ์แล้ว');
    } catch (reason) {
      const suffix = photoUrls.length ? ' รูปถูกอัปโหลดแล้วแต่ Activity ยังไม่ถูกบันทึก กรุณาแจ้งผู้ดูแลพร้อมเวลาเกิดเหตุ' : '';
      throw new Error(`${reason instanceof Error ? reason.message : String(reason)}${suffix}`);
    }
  }).catch(reason => setMessage(reason instanceof Error ? reason.message : String(reason)));

  return <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
    <div className="flex items-center justify-between">
      <h4 className="text-xs font-black text-slate-700">ประวัติการดำเนินงาน</h4>
      {session.status === 'InProgress' && actorName && actorRole && <button type="button" onClick={() => setShowForm(value => !value)} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white">เพิ่มเหตุการณ์</button>}
    </div>
    {showForm && <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3">
      <select value={activityType} onChange={event => setActivityType(event.target.value as VehicleActivityType)} className="rounded-lg border p-2 text-sm">
        {[
          ['ParkingIssue', 'ปัญหาการจอดรถ'],
          ['WrongParking', 'จอดรถผิดพื้นที่'],
          ['Obstruction', 'กีดขวางทาง'],
          ['Accident', 'อุบัติเหตุ'],
          ['Damage', 'ความเสียหาย'],
          ['Evidence', 'หลักฐาน'],
          ['Remark', 'หมายเหตุ'],
          ['Warning', 'แจ้งเตือน'],
          ['Violation', 'การกระทำผิด'],
          ['ContactResident', 'ติดต่อผู้อยู่อาศัย'],
          ['ContactVehicleOwner', 'ติดต่อเจ้าของรถ'],
          ['VehicleMoved', 'เคลื่อนย้ายรถแล้ว'],
          ['FollowUp', 'ติดตามผล'],
          ['Custom', 'อื่น ๆ'],
        ].map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} placeholder="รายละเอียดเหตุการณ์" className="rounded-lg border p-2 text-sm" />
      <input value={location} onChange={event => setLocation(event.target.value)} maxLength={256} placeholder="ตำแหน่ง (ไม่บังคับ)" className="rounded-lg border p-2 text-sm" />
      <select value={severity} onChange={event => setSeverity(event.target.value as VehicleActivitySeverity)} className="rounded-lg border p-2 text-sm">
        {['Low', 'Normal', 'High', 'Critical'].map(value => <option key={value}>{value}</option>)}
      </select>
      <input type="file" accept="image/*" capture="environment" onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setPhotoDataUrl(String(reader.result || ''));
        reader.readAsDataURL(file);
      }} className="text-xs" />
      <button type="button" disabled={!description.trim()} onClick={() => void submitActivity()} className="rounded-lg bg-emerald-700 p-2 text-sm font-bold text-white disabled:opacity-40">บันทึกเหตุการณ์</button>
    </div>}
    {message && <p className="mt-2 text-xs font-bold text-slate-600">{message}</p>}
    <ol className="mt-2 max-h-40 space-y-2 overflow-y-auto">
      {merged.map((item, index) => {
        const record = activities.find(activity => activity.client_event_id === item.clientEventId);
        return <li key={`${item.clientEventId || 'legacy'}-${index}`} className="border-l-2 border-indigo-200 pl-2 text-[11px]">
        <strong className="text-slate-700">{record?.activity_type || item.action}</strong>
        <span className="ml-1 text-slate-400">{item.byName} · {item.at ? new Date(item.at).toLocaleString('th-TH') : '-'}</span>
        {record?.description && <p className="text-slate-600">{record.description}</p>}
        {record?.location && <p className="text-slate-400">ตำแหน่ง: {record.location} · {record.severity}</p>}
        {!!record?.photo_urls?.length && <div className="mt-1 flex gap-1">{record.photo_urls.map(url => <span key={url}><AuthenticatedEvidenceImage mediaReference={url} alt="หลักฐานเหตุการณ์" className="h-16 w-16 rounded object-cover" /></span>)}</div>}
      </li>;
      })}
      {!merged.length && <li className="text-xs text-slate-400">ยังไม่มี Activity</li>}
    </ol>
    <button type="button" onClick={() => void loadMore()} className="mt-2 text-xs font-bold text-indigo-700">{hasMore || !cursor ? 'โหลดประวัติเพิ่ม' : 'แสดงครบแล้ว'}</button>
  </div>;
}
