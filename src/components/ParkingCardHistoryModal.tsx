import { useEffect, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { getParkingCardHistory } from '../services/parkingCardService';
import type { ParkingCardRecord } from '../types';

interface HistoryItem { id: string; kind: string; date: string; action: string; operator: string; oldValue: string; newValue: string; relatedVehicleLog: string; relatedReplacementCard: string; detail: string }

export default function ParkingCardHistoryModal({ card, onClose }: { card: ParkingCardRecord; onClose: () => void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { void getParkingCardHistory(card).then(setItems).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))); }, [card]);
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-3" onMouseDown={onClose}><div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5" onMouseDown={event => event.stopPropagation()}><div className="flex items-start justify-between"><div><h3 className="flex items-center gap-2 font-black text-white"><Clock className="h-5 w-5" /> ประวัติบัตร {card.card_number}</h3><p className="text-xs text-slate-400">Creation, status, vehicle usage, replacement และ Audit Log</p></div><button onClick={onClose} className="p-2 text-slate-400"><X className="h-4 w-4" /></button></div>{error && <p className="mt-4 rounded-lg bg-red-950 p-3 text-xs text-red-300">{error}</p>}<div className="mt-4 flex flex-col gap-2">{items.length === 0 && !error && <p className="p-6 text-center text-xs text-slate-500">กำลังโหลดหรือยังไม่มีประวัติ</p>}{items.map(item => <div key={`${item.kind}-${item.id}`} className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="flex justify-between gap-2"><strong className="text-xs text-white">{item.action}</strong><span className="text-[10px] text-slate-500">{item.date ? new Date(item.date).toLocaleString('th-TH') : '-'}</span></div><p className="mt-1 text-[11px] text-slate-500">Operator: {item.operator || '-'}</p><p className="break-words text-xs text-slate-400">Old: {item.oldValue || '-'} → New: {item.newValue || '-'}</p><p className="break-words text-xs text-slate-400">Vehicle Log: {item.relatedVehicleLog || '-'} • Replacement: {item.relatedReplacementCard || '-'}</p>{item.detail && <p className="mt-1 break-words text-xs text-slate-400">{item.detail}</p>}</div>)}</div></div></div>;
}
