import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BriefcaseBusiness,
  Car,
  Download,
  FileSpreadsheet,
  KeyRound,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { exportCsv } from '../services/importExport/csvExportService';
import { IMPORT_EXPORT_MODULES } from '../services/importExport/modules';
import {
  filterExportRows,
  type ExportFilters,
  type ImportExportModule,
  type ImportExportRecord,
} from '../services/importExport/validationService';

type ReportKey = 'vehicle' | 'contractor' | 'patrol' | 'incident' | 'key';

interface ReportsCenterProps {
  vehicleRecords?: readonly object[];
  contractorRecords?: readonly object[];
  patrolRecords?: readonly object[];
  incidentRecords?: readonly object[];
  keyRecords?: readonly object[];
}

interface ReportDefinition {
  key: ReportKey;
  label: string;
  description: string;
  module: ImportExportModule;
  icon: typeof Car;
}

const REPORTS: readonly ReportDefinition[] = [
  { key: 'vehicle', label: 'รายงานรถเข้า–ออก', description: 'ตรวจสอบรายการรถเข้า รถออก และรายการที่ยังไม่สิ้นสุด', module: IMPORT_EXPORT_MODULES.VehicleLogs, icon: Car },
  { key: 'contractor', label: 'รายงานผู้รับเหมา', description: 'ตรวจสอบผู้รับเหมา เวลาเข้า–ออก บริษัท และห้องปลายทาง', module: IMPORT_EXPORT_MODULES.ContractorLogs, icon: BriefcaseBusiness },
  { key: 'patrol', label: 'รายงานการเดินตรวจ', description: 'ตรวจสอบจุดตรวจ เจ้าหน้าที่ เวลาเช็กอิน และสถานะ', module: IMPORT_EXPORT_MODULES.PatrolLogs, icon: ShieldCheck },
  { key: 'incident', label: 'รายงานเหตุการณ์', description: 'ตรวจสอบประเภทเหตุ ความรุนแรง สถานที่ และสถานะดำเนินการ', module: IMPORT_EXPORT_MODULES.IncidentReports, icon: AlertTriangle },
  { key: 'key', label: 'รายงานการเบิกกุญแจ', description: 'ตรวจสอบผู้ยืม เวลาเบิก เวลาคืน ห้อง และสถานะ', module: IMPORT_EXPORT_MODULES.KeyLogs, icon: KeyRound },
];

const toFrameworkRecords = (records: readonly object[]): ImportExportRecord[] =>
  records.map(record => Object.fromEntries(Object.entries(record)));

export default function ReportsCenter({
  vehicleRecords = [],
  contractorRecords = [],
  patrolRecords = [],
  incidentRecords = [],
  keyRecords = [],
}: ReportsCenterProps) {
  const [activeReport, setActiveReport] = useState<ReportKey>('vehicle');
  const [filters, setFilters] = useState<ExportFilters>({});

  const recordsByReport = useMemo<Record<ReportKey, ImportExportRecord[]>>(
    () => ({
      vehicle: toFrameworkRecords(vehicleRecords),
      contractor: toFrameworkRecords(contractorRecords),
      patrol: toFrameworkRecords(patrolRecords),
      incident: toFrameworkRecords(incidentRecords),
      key: toFrameworkRecords(keyRecords),
    }),
    [vehicleRecords, contractorRecords, patrolRecords, incidentRecords, keyRecords],
  );

  const report = REPORTS.find(item => item.key === activeReport) ?? REPORTS[0];
  const records = recordsByReport[activeReport];
  const filteredRecords = useMemo(() => filterExportRows(records, filters), [records, filters]);
  const statuses = useMemo(() => [...new Set(records
    .map(row => String(row.status || row.occupancy_status || '').trim())
    .filter(Boolean))].sort(), [records]);
  const buildings = useMemo(() => [...new Set(records
    .map(row => String(row.building || '').trim())
    .filter(Boolean))].sort(), [records]);
  const Icon = report.icon;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-blue-400" />
              <h2 className="text-base font-black text-white">ศูนย์รายงานปฏิบัติการ</h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">ดูตัวอย่าง กรองข้อมูล และส่งออกรายงานแต่ละโมดูลเป็น CSV</p>
          </div>
          <button
            type="button"
            disabled={filteredRecords.length === 0}
            onClick={() => exportCsv(records, report.module, filters)}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> Export CSV ({filteredRecords.length.toLocaleString()})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {REPORTS.map(item => {
          const ItemIcon = item.icon;
          const isActive = item.key === activeReport;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => { setActiveReport(item.key); setFilters({}); }}
              className={`rounded-2xl border p-4 text-left transition ${isActive ? 'border-blue-500 bg-blue-950/50' : 'border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-900'}`}
            >
              <ItemIcon className={`h-5 w-5 ${isActive ? 'text-blue-400' : 'text-slate-500'}`} />
              <div className="mt-3 text-xs font-black text-white">{item.label}</div>
              <div className="mt-1 text-[10px] leading-4 text-slate-500">{recordsByReport[item.key].length.toLocaleString()} รายการ</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          <div><h3 className="text-sm font-black text-white">{report.label}</h3><p className="mt-1 text-xs text-slate-400">{report.description}</p></div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 rounded-2xl bg-slate-900/70 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <input type="date" aria-label="Date from" value={filters.dateFrom || ''} onChange={event => setFilters(current => ({ ...current, dateFrom: event.target.value }))} className="rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
          <input type="date" aria-label="Date to" value={filters.dateTo || ''} onChange={event => setFilters(current => ({ ...current, dateTo: event.target.value }))} className="rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
          <select aria-label="Status" value={filters.status || ''} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} className="rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white">
            <option value="">ทุกสถานะ</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          <select aria-label="Building" value={filters.building || ''} onChange={event => setFilters(current => ({ ...current, building: event.target.value }))} className="rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white">
            <option value="">ทุกอาคาร</option>{buildings.map(building => <option key={building} value={building}>{building}</option>)}
          </select>
          <button type="button" onClick={() => setFilters({})} className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700">ล้างตัวกรอง</button>
          <div className="relative sm:col-span-2 lg:col-span-5">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
            <input type="search" value={filters.keyword || ''} onChange={event => setFilters(current => ({ ...current, keyword: event.target.value }))} placeholder="ค้นหาจากข้อมูลทุกคอลัมน์" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-xs text-white" />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['ข้อมูลทั้งหมด', records.length, 'text-white'],
            ['หลังกรอง', filteredRecords.length, 'text-blue-400'],
            ['สถานะ', statuses.length, 'text-white'],
            ['อาคาร', buildings.length, 'text-white'],
          ].map(([label, value, color]) => (
            <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
              <div className={`mt-1 text-xl font-black ${color}`}>{Number(value).toLocaleString()}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400"><tr>{report.module.columns.map(column => <th key={column.key} className="whitespace-nowrap border-b border-slate-800 px-3 py-3 font-bold">{column.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-900 bg-slate-950 text-slate-300">
                {filteredRecords.slice(0, 100).map((row, index) => (
                  <tr key={`${String(row[report.module.idField] || '')}-${index}`}>
                    {report.module.columns.map(column => <td key={column.key} className="max-w-[260px] whitespace-nowrap px-3 py-3" title={String(row[column.key] ?? '')}><span className="block truncate">{String(row[column.key] ?? '') || '-'}</span></td>)}
                  </tr>
                ))}
                {filteredRecords.length === 0 && <tr><td colSpan={report.module.columns.length} className="px-4 py-12 text-center text-slate-500">ไม่พบข้อมูลตามตัวกรองที่เลือก</td></tr>}
              </tbody>
            </table>
          </div>
          {filteredRecords.length > 100 && <div className="border-t border-slate-800 bg-slate-900 px-4 py-3 text-[10px] text-slate-500">หน้าจอแสดงตัวอย่าง 100 รายการแรก แต่ไฟล์ CSV จะส่งออกครบทั้งหมด {filteredRecords.length.toLocaleString()} รายการ</div>}
        </div>
      </div>
    </div>
  );
}
