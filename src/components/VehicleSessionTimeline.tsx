import { useEffect, useMemo, useState } from 'react';
import type { DocumentSnapshot, DocumentData } from 'firebase/firestore';
import type { VehicleSessionRecord } from '../types';
import {
  listSessionActivities,
  mergeLegacyAndSubcollectionActivities,
  subscribeRecentSessionActivities,
  type SessionActivityRecord,
} from '../services/vehicleSessionActivityService';

export default function VehicleSessionTimeline({ session }: { session: VehicleSessionRecord }) {
  const [activities, setActivities] = useState<SessionActivityRecord[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);

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

  return <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
    <h4 className="text-xs font-black text-slate-700">ประวัติการดำเนินงาน</h4>
    <ol className="mt-2 max-h-40 space-y-2 overflow-y-auto">
      {merged.map((item, index) => <li key={`${item.clientEventId || 'legacy'}-${index}`} className="border-l-2 border-indigo-200 pl-2 text-[11px]">
        <strong className="text-slate-700">{item.action}</strong>
        <span className="ml-1 text-slate-400">{item.byName} · {item.at ? new Date(item.at).toLocaleString('th-TH') : '-'}</span>
      </li>)}
      {!merged.length && <li className="text-xs text-slate-400">ยังไม่มี Activity</li>}
    </ol>
    <button type="button" onClick={() => void loadMore()} className="mt-2 text-xs font-bold text-indigo-700">{hasMore || !cursor ? 'โหลดประวัติเพิ่ม' : 'แสดงครบแล้ว'}</button>
  </div>;
}
