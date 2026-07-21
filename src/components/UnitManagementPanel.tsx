import ImportExportDialog from './ImportExportDialog';
import { clearUnitCache, useUnits } from '../hooks/useUnits';
import { IMPORT_EXPORT_MODULES } from '../services/importExport/modules';

interface UnitManagementPanelProps {
  operatorName: string;
  canImport: boolean;
}

export default function UnitManagementPanel({ canImport }: UnitManagementPanelProps) {
  const { units, loading, error, refresh } = useUnits();
  const reload = async () => {
    clearUnitCache();
    await refresh();
  };

  return <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-sm font-bold text-white">จัดการข้อมูลห้องส่วนกลาง</h3>
        <p className="mt-1 text-xs text-slate-400">{loading ? 'กำลังโหลด...' : `ทั้งหมด ${units.length.toLocaleString()} ห้อง`} • เรียงตามอาคาร ชั้น และเลขห้อง</p>
      </div>
      <ImportExportDialog module={IMPORT_EXPORT_MODULES.Units} records={units} canImport={canImport} onImported={reload} />
    </div>
    {error && <button type="button" onClick={() => void refresh()} className="rounded-xl bg-red-950 p-3 text-left text-xs text-red-300">โหลดข้อมูลไม่สำเร็จ — กดเพื่อลองใหม่</button>}
  </div>;
}
