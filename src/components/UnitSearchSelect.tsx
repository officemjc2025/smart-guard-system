import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  statusFilter?: string | string[];
}

const normalize = (value: string) => value.toLowerCase().replace(/[\s/_.-]/g, '');

export default function UnitSearchSelect({
  value, selectedUnitId = '', onSelect, label, placeholder, required = false,
  allowManualEntry = true, statusFilter,
}: UnitSearchSelectProps) {
  const { units, loading, error, refresh } = useUnits();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setQuery(value); }, [value]);
  const matches = useMemo(() => {
    const needle = normalize(query);
    const statuses = statusFilter ? new Set(Array.isArray(statusFilter) ? statusFilter : [statusFilter]) : null;
    return units.filter(unit => (!statuses || statuses.has(unit.status)) && (!needle ||
      [unit.room_number, unit.owner_name, unit.resident_name, unit.phone]
        .some(field => normalize(field || '').includes(needle)))).slice(0, 50);
  }, [query, statusFilter, units]);

  useEffect(() => { setActiveIndex(matches.length ? 0 : -1); }, [query, matches.length]);

  const select = (unit: UnitRecord) => {
    setQuery(unit.room_number);
    setOpen(false);
    onSelect(unit);
  };

  const manual = () => {
    const room = query.trim();
    if (!room) return;
    onSelect({ unit_id: '', site_id: '', building: '', room_number: room, floor: '', owner_name: '', resident_name: '', occupancy_status: '', status: '', searchable_text: room, search_key: normalize(room), is_active: true, created_at: '', updated_at: '' });
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index => event.key === 'ArrowDown'
        ? Math.min(index + 1, matches.length - 1)
        : Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (activeIndex >= 0 && matches[activeIndex]) select(matches[activeIndex]);
      else if (allowManualEntry) manual();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return <div ref={rootRef} className="flex flex-col gap-1.5 relative">
    <label className="text-xs font-bold text-slate-600">{label}{required ? ' *' : ''}</label>
    <div className="relative">
      <Search className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
      <input type="text" value={query} required={required} autoComplete="off"
        onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); onSelect(null); }}
        onKeyDown={handleKeyDown} onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        role="combobox" aria-expanded={open} aria-controls={listboxId} aria-autocomplete="list"
        placeholder={placeholder || 'ค้นหาเลขห้อง รหัสห้อง เจ้าของ หรือเบอร์โทร'}
        className="w-full p-3.5 pl-9 pr-9 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold" />
      {query && <button type="button" aria-label="Clear unit" onClick={() => { setQuery(''); onSelect(null); }} className="absolute right-2 top-2.5 p-1 text-slate-400"><X className="w-4 h-4" /></button>}
    </div>
    {open && <div id={listboxId} role="listbox" className="absolute z-30 top-full mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
      {loading && <p className="p-3 text-xs text-slate-500">กำลังโหลดข้อมูลห้อง...</p>}
      {error && <button type="button" onClick={() => void refresh()} className="p-3 text-left text-xs text-red-600">โหลดข้อมูลห้องไม่สำเร็จ — กดเพื่อลองใหม่</button>}
      {!loading && matches.map((unit, index) => <button type="button" role="option" aria-selected={selectedUnitId === unit.unit_id} key={unit.unit_id} onMouseDown={event => event.preventDefault()} onClick={() => select(unit)} className={`block min-h-16 w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50 ${selectedUnitId === unit.unit_id || activeIndex === index ? 'bg-indigo-50' : ''}`}>
        <span className="flex items-center justify-between gap-2"><strong>{unit.room_number}</strong><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{unit.status}</span></span>
        <span className="block text-xs text-slate-500">{unit.building ? `${unit.building} • ` : ''}{unit.floor ? `ชั้น ${unit.floor}` : ''}</span>
        <span className="block text-xs text-slate-500">เจ้าของ: {unit.owner_name || '-'} • ผู้พักอาศัย: {unit.resident_name || '-'}</span>
      </button>)}
      {!loading && matches.length === 0 && <p className="p-3 text-xs text-slate-500">ไม่พบห้องที่ตรงกัน</p>}
      {allowManualEntry && query.trim() && <button type="button" onClick={manual} className="block w-full p-3 text-left text-xs font-bold text-indigo-700 hover:bg-indigo-50">ใช้ “{query.trim()}” เป็นข้อมูลที่พิมพ์เอง</button>}
    </div>}
  </div>;
}
