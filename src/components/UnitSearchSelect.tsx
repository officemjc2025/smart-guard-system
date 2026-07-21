import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useUnits } from '../hooks/useUnits';
import type { UnitRecord } from '../types';

interface UnitSearchSelectProps {
  value: string;
  selectedUnitId?: string;
  onSelect: (unit: UnitRecord | null) => void;
  label: string;
  placeholder?: string;
  required?: boolean;
  allowManualEntry?: boolean;
}

const normalize = (value: string) => value.toLowerCase().replace(/[\s/_.-]/g, '');

export default function UnitSearchSelect({
  value, selectedUnitId = '', onSelect, label, placeholder, required = false, allowManualEntry = true,
}: UnitSearchSelectProps) {
  const { units, loading, error, refresh } = useUnits();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return units.slice(0, 20);
    return units.filter(unit => [unit.room_number, unit.room_code, unit.owner_name, unit.phone, unit.searchable_text, unit.search_key]
      .some(field => normalize(field || '').includes(needle))).slice(0, 20);
  }, [query, units]);

  const select = (unit: UnitRecord) => {
    setQuery(unit.room_number);
    setOpen(false);
    onSelect(unit);
  };

  const manual = () => {
    const room = query.trim();
    if (!room) return;
    onSelect({ unit_id: '', site_id: '', room_number: room, floor: '', owner_name: '', occupancy_status: '', searchable_text: room, search_key: normalize(room), is_active: true, created_at: '', updated_at: '' });
    setOpen(false);
  };

  return <div className="flex flex-col gap-1.5 relative">
    <label className="text-xs font-bold text-slate-600">{label}{required ? ' *' : ''}</label>
    <div className="relative">
      <Search className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
      <input type="text" value={query} required={required} autoComplete="off"
        onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); onSelect(null); }}
        placeholder={placeholder || 'ค้นหาเลขห้อง รหัสห้อง เจ้าของ หรือเบอร์โทร'}
        className="w-full p-3.5 pl-9 pr-9 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold" />
      {query && <button type="button" aria-label="Clear unit" onClick={() => { setQuery(''); onSelect(null); }} className="absolute right-2 top-2.5 p-1 text-slate-400"><X className="w-4 h-4" /></button>}
    </div>
    {open && <div className="absolute z-30 top-full mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
      {loading && <p className="p-3 text-xs text-slate-500">กำลังโหลดข้อมูลห้อง...</p>}
      {error && <button type="button" onClick={() => void refresh()} className="p-3 text-left text-xs text-red-600">โหลดข้อมูลห้องไม่สำเร็จ — กดเพื่อลองใหม่</button>}
      {!loading && matches.map(unit => <button type="button" key={unit.unit_id} onClick={() => select(unit)} className={`block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50 ${selectedUnitId === unit.unit_id ? 'bg-indigo-50' : ''}`}>
        <strong>{unit.room_number}</strong>{unit.room_code ? ` • ${unit.room_code}` : ''}{unit.floor ? ` • ชั้น ${unit.floor}` : ''}<span className="block text-xs text-slate-500">{unit.owner_name}{unit.phone ? ` • ${unit.phone}` : ''}</span>
      </button>)}
      {!loading && matches.length === 0 && <p className="p-3 text-xs text-slate-500">ไม่พบห้องที่ตรงกัน</p>}
      {allowManualEntry && query.trim() && <button type="button" onClick={manual} className="block w-full p-3 text-left text-xs font-bold text-indigo-700 hover:bg-indigo-50">ใช้ “{query.trim()}” เป็นข้อมูลที่พิมพ์เอง</button>}
    </div>}
  </div>;
}
