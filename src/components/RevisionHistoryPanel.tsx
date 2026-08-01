import { useEffect, useState } from 'react';
import { History, X } from 'lucide-react';
import type { RevisionRecord } from '../services/revisionFramework';
import { formatThaiDateTime } from '../utils/dateTime';
import AuthenticatedEvidenceImage from './AuthenticatedEvidenceImage';

const labels: Record<string, string> = {
  incident_datetime: 'เวลาเกิดเหตุ', incident_type: 'ประเภทเหตุ', location: 'สถานที่',
  description: 'รายละเอียด', priority: 'ความเร่งด่วน', photo_url: 'รูปหลักฐาน',
  photo_file_id: 'รหัสไฟล์หลักฐาน', remarks: 'หมายเหตุ', patrol_point_name: 'จุดตรวจ',
  custom_location: 'สถานที่เพิ่มเติม', abnormal_reason: 'รายละเอียดความผิดปกติ',
  evidence_photo_1_url: 'รูปหลักฐาน 1', evidence_photo_1_file_id: 'รหัสไฟล์หลักฐาน 1',
  evidence_photo_2_url: 'รูปหลักฐาน 2', evidence_photo_2_file_id: 'รหัสไฟล์หลักฐาน 2',
};

const Value = ({ value, field }: { value: unknown; field: string }) => {
  const text = value === null || value === undefined ? '—'
    : value && typeof value === 'object' && 'toDate' in value ? formatThaiDateTime(value) : String(value);
  return field.endsWith('_url') && text.startsWith('https://drive.google.com/')
    ? <AuthenticatedEvidenceImage mediaReference={text} alt={labels[field] || field} className="h-28 w-full rounded-lg object-cover" />
    : <span className="break-words">{text}</span>;
};

export default function RevisionHistoryPanel({
  title, load, onClose,
}: { title: string; load: () => Promise<RevisionRecord[]>; onClose: () => void }) {
  const [items, setItems] = useState<RevisionRecord[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { void load().then(setItems).catch(value => setError(value instanceof Error ? value.message : String(value))); }, [load]);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-label={`Revision history ${title}`} onMouseDown={event => event.stopPropagation()} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
      <header className="mb-4 flex items-center justify-between"><h3 className="flex items-center gap-2 font-black"><History className="h-5 w-5" />ประวัติการแก้ไข · {title}</h3><button onClick={onClose} aria-label="ปิด"><X /></button></header>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!error && !items.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">ยังไม่มีการแก้ไข</p>}
      <div className="space-y-4">{items.map(item => <article key={item.revision_id} className="rounded-xl border p-4">
        <div className="flex flex-wrap justify-between gap-2"><b>Revision {item.revision_number}</b><span className="text-xs text-slate-500">{formatThaiDateTime(item.edited_at)}</span></div>
        <p className="text-xs text-slate-500">แก้ไขโดย {item.edited_by_name} · {item.edited_by_role}</p>
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm"><b>เหตุผล:</b> {item.reason}</p>
        <div className="mt-3 space-y-3">{item.changed_fields.map(field => <div key={field}><b className="text-xs">{labels[field] || field}</b><div className="mt-1 grid gap-2 sm:grid-cols-2"><div className="rounded-lg bg-red-50 p-2 text-xs"><span className="block font-bold text-red-700">ก่อน</span><Value field={field} value={item.before[field]} /></div><div className="rounded-lg bg-emerald-50 p-2 text-xs"><span className="block font-bold text-emerald-700">หลัง</span><Value field={field} value={item.after[field]} /></div></div></div>)}</div>
      </article>)}</div>
    </section>
  </div>;
}
