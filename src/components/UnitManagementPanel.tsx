import { useMemo, useState, type FormEvent } from 'react';
import { Building2, Edit3, Plus, RefreshCw, Search } from 'lucide-react';
import ImportExportDialog from './ImportExportDialog';
import { clearUnitCache, useUnits } from '../hooks/useUnits';
import { IMPORT_EXPORT_MODULES } from '../services/importExport/modules';
import { commitUnitFrameworkImport } from '../services/unitImportService';
import { createUnit, setUnitStatus, updateUnit, type UnitInput } from '../services/unitService';
import type { UnitRecord } from '../types';

interface UnitManagementPanelProps {
  operatorName: string;
  canImport: boolean;
}

const emptyForm = (): UnitInput => ({ unit_id: '', room_number: '', building: '', floor: '', owner_name: '', resident_name: '', phone: '', status: 'Active' });

export default function UnitManagementPanel({ operatorName, canImport }: UnitManagementPanelProps) {
  const { units, loading, error, refresh } = useUnits({ includeInactive: true });
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<UnitRecord | null>(null);
  const [form, setForm] = useState<UnitInput>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const reload = async () => { clearUnitCache(); await refresh(); };
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return !needle ? units : units.filter(unit => [unit.unit_id, unit.room_number, unit.building, unit.floor, unit.owner_name, unit.resident_name, unit.phone].some(value => (value || '').toLowerCase().includes(needle)));
  }, [query, units]);
  const activeCount = units.filter(unit => unit.status === 'Active').length;
  const lastUpdated = units.reduce((latest, unit) => unit.updated_at > latest ? unit.updated_at : latest, '');

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); setMessage(''); };
  const openEdit = (unit: UnitRecord) => {
    setEditing(unit);
    setForm({ unit_id: unit.unit_id, room_number: unit.room_number, building: unit.building, floor: unit.floor, owner_name: unit.owner_name, resident_name: unit.resident_name, phone: unit.phone, status: unit.status });
    setShowForm(true);
    setMessage('');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (editing) await updateUnit(editing, form, operatorName);
      else await createUnit(form, operatorName);
      await reload(); setShowForm(false); setMessage(editing ? 'แก้ไขข้อมูลห้องสำเร็จ' : 'เพิ่มห้องสำเร็จ');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const toggleStatus = async (unit: UnitRecord) => {
    setBusy(true); setMessage('');
    try { await setUnitStatus(unit, unit.status === 'Active' ? 'Inactive' : 'Active', operatorName); await reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  return <div className="flex flex-col gap-4 lg:col-span-12">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[['จำนวนห้องทั้งหมด', units.length], ['ห้องที่เปิดใช้งาน', activeCount], ['ห้องที่ระงับ', units.length - activeCount], ['ข้อมูลที่แก้ไขล่าสุด', lastUpdated ? new Date(lastUpdated).toLocaleString('th-TH') : '-']].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-lg font-black text-slate-800">{value}</p></div>)}
    </div>

    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <button type="button" onClick={openCreate} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white"><Plus className="h-4 w-4" /> เพิ่มห้อง</button>
        <ImportExportDialog module={IMPORT_EXPORT_MODULES.Units} records={units} canImport={canImport} onImported={reload} commitImport={preview => commitUnitFrameworkImport(preview, operatorName)} />
        <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ค้นหาห้อง อาคาร ชั้น เจ้าของ ผู้พักอาศัย หรือโทรศัพท์" className="min-h-10 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-xs outline-none focus:border-indigo-500" /></div>
        <button type="button" onClick={() => void reload()} disabled={loading} className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-xs font-bold text-slate-700"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </div>
      {message && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-xs font-semibold text-slate-700">{message}</p>}
      {error && <button type="button" onClick={() => void reload()} className="mt-3 rounded-xl bg-red-50 p-3 text-left text-xs text-red-700">โหลดข้อมูลไม่สำเร็จ — กดเพื่อลองใหม่</button>}
    </div>

    {showForm && <form onSubmit={submit} className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-black text-slate-800">{editing ? 'แก้ไขข้อมูลห้อง' : 'เพิ่มห้องใหม่'}</h3><button type="button" onClick={() => setShowForm(false)} className="text-xs font-bold text-slate-600">ยกเลิก</button></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['unit_id', 'Unit ID *'], ['room_number', 'Room Number *'], ['building', 'Building *'], ['floor', 'Floor *'], ['owner_name', 'Owner'], ['resident_name', 'Resident'], ['phone', 'Phone']].map(([key, label]) => <label key={key} className="flex flex-col gap-1 text-xs font-bold text-slate-600">{label}<input required={['unit_id', 'room_number', 'building', 'floor'].includes(key)} disabled={key === 'unit_id' && Boolean(editing)} value={String(form[key as keyof UnitInput] || '')} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} className="rounded-xl border border-slate-300 bg-white p-3 text-sm font-semibold outline-none disabled:bg-slate-200" /></label>)}
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">Status<select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as 'Active' | 'Inactive' }))} className="rounded-xl border border-slate-300 bg-white p-3 text-sm"><option>Active</option><option>Inactive</option></select></label>
      </div>
      <button disabled={busy} className="mt-4 rounded-xl bg-indigo-600 px-5 py-3 text-xs font-bold text-white disabled:opacity-50">{editing ? 'บันทึกการแก้ไข' : 'เพิ่มห้อง'}</button>
    </form>}

    {!loading && units.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><Building2 className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 font-black text-slate-700">ยังไม่มีข้อมูลห้องพัก</p><p className="text-sm text-slate-500">กรุณาเพิ่มห้องหรือ Import ไฟล์ Excel / CSV</p></div> : <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm"><table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-slate-100 text-slate-600"><tr>{['Room Number', 'Building', 'Floor', 'Owner', 'Resident', 'Phone', 'Status', 'Last Updated', 'Actions'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{filtered.map(unit => <tr key={unit.unit_id} className="border-t border-slate-100"><td className="p-3 font-black text-slate-800">{unit.room_number}</td><td className="p-3">{unit.building}</td><td className="p-3">{unit.floor}</td><td className="p-3">{unit.owner_name || '-'}</td><td className="p-3">{unit.resident_name || '-'}</td><td className="p-3">{unit.phone || '-'}</td><td className="p-3"><span className={`rounded-full px-2 py-1 font-bold ${unit.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{unit.status}</span></td><td className="p-3">{unit.updated_at ? new Date(unit.updated_at).toLocaleString('th-TH') : '-'}</td><td className="p-3"><div className="flex gap-2"><button type="button" onClick={() => openEdit(unit)} className="flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1.5 font-bold text-blue-700"><Edit3 className="h-3.5 w-3.5" /> Edit</button><button type="button" disabled={busy} onClick={() => void toggleStatus(unit)} className="rounded-lg bg-slate-100 px-2 py-1.5 font-bold text-slate-700">{unit.status === 'Active' ? 'Suspend' : 'Activate'}</button></div></td></tr>)}</tbody></table></div>}
  </div>;
}
