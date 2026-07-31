/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Search, Calendar, Filter, Clock, Eye, Download, X,
  Car, Users, Key, ShieldCheck, AlertTriangle, RefreshCw
} from 'lucide-react';
import { listVehicleHistory } from '../services/vehicleSessionService';
import { listContractors } from '../services/contractorService';
import { listKeyLogs } from '../services/keyService';
import { listPatrolLogs } from '../services/patrolService';
import { listIncidents } from '../services/incidentService';
import AuthenticatedEvidenceImage from './AuthenticatedEvidenceImage';
import { formatBangkokDateKey, formatThaiDateTime } from '../utils/dateTime';
import {
  contractorLifecycle,
  incidentLifecycle,
  keyLifecycle,
  patrolLifecycle,
  vehicleLifecycle,
} from '../services/operationalLifecycle';

export default function SearchHistory() {
  const [activeModule, setActiveModule] = useState<'vehicles' | 'contractors' | 'keys' | 'patrols' | 'incidents'>('vehicles');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  
  // Data Store
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [patrols, setPatrols] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);

  // Search Filters
  const [query, setQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | 'current' | 'archived' | 'carry-over'>('all');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'day' | 'night'>('all');
  const [incidentStateFilter, setIncidentStateFilter] = useState<'all' | 'reported' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed'>('all');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(15);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeModule, query, startDate, endDate, statusFilter, lifecycleFilter, shiftFilter, incidentStateFilter]);

  // Detailed Modal Viewer State
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [resolvedImages, setResolvedImages] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    fetchAllHistory();
  }, []);

  const fetchAllHistory = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';
      const [v, c, k, p, i] = await Promise.all([
        listVehicleHistory(siteId),
        listContractors(siteId),
        listKeyLogs(siteId),
        listPatrolLogs(siteId),
        listIncidents(siteId)
      ]);

      // Sort chronological descending (latest first)
      setVehicles(v.reverse());
      setContractors(c.reverse());
      setKeys(k.reverse());
      setPatrols(p.reverse());
      setIncidents(i.reverse());
    } catch (err) {
      console.error('Failed to load logs history:', err);
      setLoadError(err instanceof Error ? err.message : 'ไม่สามารถโหลดประวัติได้');
    } finally {
      setLoading(false);
    }
  };

  // Resolve private Firebase Storage file URLs dynamically when opening detail modal
  const handleOpenDetail = async (record: any) => {
    setSelectedRecord(record);
    setResolvedImages({});
    
    const imageFields = [
      'entry_plate_photo_url', 'entry_vehicle_photo_url',
      'exit_plate_photo_url', 'exit_vehicle_photo_url',
      'id_card_photo_url', 'face_photo_url',
      'signature_image_url', 'borrower_photo_url',
      'return_photo_url', 'return_signature_url',
      'photo_url', 'incident_photo_url', 'evidence_photo_1_url', 'evidence_photo_2_url'
    ];

    const resolved: { [key: string]: string } = {};
    for (const field of imageFields) {
      const fileId = record[field];
      if (fileId) {
        resolved[field] = String(fileId);
      }
    }
    setResolvedImages(resolved);
  };

  const lifecycleFor = (item: any) => activeModule === 'vehicles' ? vehicleLifecycle(item)
    : activeModule === 'contractors' ? contractorLifecycle(item)
      : activeModule === 'keys' ? keyLifecycle(item)
        : activeModule === 'patrols' ? patrolLifecycle(item)
          : incidentLifecycle(item);

  // Date and query filtering logic
  const getFilteredData = () => {
    let source: any[] = [];
    if (activeModule === 'vehicles') source = vehicles;
    else if (activeModule === 'contractors') source = contractors;
    else if (activeModule === 'keys') source = keys;
    else if (activeModule === 'patrols') source = patrols;
    else if (activeModule === 'incidents') source = incidents;

    return source.filter(item => {
      // 1. Keyword search (case-insensitive check across multiple key fields)
      const keyword = query.toLowerCase().replace(/\s+/g, '');
      const matchText = JSON.stringify(item).toLowerCase();
      const matchQuery = !keyword || matchText.includes(keyword);

      // 2. Status filter
      const matchStatus = !statusFilter || item.status === statusFilter;

      // 3. Date filtering
      let dateVal = '';
      if (item.entry_time) dateVal = item.entry_time;
      else if (item.checkout_time) dateVal = item.checkout_time;
      else if (item.checkin_time) dateVal = item.checkin_time;
      else if (item.incident_datetime) dateVal = item.incident_datetime;
      else if (item.created_at) dateVal = item.created_at;

      const dateStr = formatBangkokDateKey(dateVal);
      const matchStart = !startDate || dateStr >= startDate;
      const matchEnd = !endDate || dateStr <= endDate;
      const lifecycle = lifecycleFor(item);
      const matchLifecycle = lifecycleFilter === 'all'
        || (lifecycleFilter === 'current' && lifecycle.current)
        || (lifecycleFilter === 'archived' && lifecycle.archived)
        || (lifecycleFilter === 'carry-over' && lifecycle.carryOver);
      const matchShift = shiftFilter === 'all' || lifecycle.shift?.shiftType === shiftFilter;
      const matchIncidentState = activeModule !== 'incidents'
        || incidentStateFilter === 'all'
        || String(item.incident_status || '').toLowerCase() === incidentStateFilter;

      return matchQuery && matchStatus && matchStart && matchEnd
        && matchLifecycle && matchShift && matchIncidentState;
    });
  };

  const filteredList = getFilteredData();
  const totalItems = filteredList.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const paginatedList = filteredList.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-6 px-1 pb-16">
      {loadError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          โหลดข้อมูลรายงานไม่สำเร็จ: {loadError}
          <button type="button" onClick={() => void fetchAllHistory()} className="ml-3 underline">ลองใหม่</button>
        </div>
      )}
      
      {/* Search Dashboard Title */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
          🔎 ค้นหา ตรวจสอบย้อนหลังและรายงานความปลอดภัย
        </h1>
        <p className="text-xs text-slate-500 font-medium mt-1">
          สืบค้นประวัติรถเข้าออก ช่างรับเหมา การเบิกคืนอุปกรณ์กุญแจ และการเดินตรวจในไซด์งานแบบละเอียด
        </p>
      </div>

      {/* Module Navigation Cards */}
      <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-3">
        <select value={lifecycleFilter} onChange={event => setLifecycleFilter(event.target.value as typeof lifecycleFilter)} className="rounded-lg border p-2 text-sm">
          <option value="all">ทั้งหมด</option><option value="current">Current</option>
          <option value="archived">Archive</option><option value="carry-over">ค้างจากกะก่อน</option>
        </select>
        <select value={shiftFilter} onChange={event => setShiftFilter(event.target.value as typeof shiftFilter)} className="rounded-lg border p-2 text-sm">
          <option value="all">ทุกกะ</option><option value="day">Day Shift</option><option value="night">Night Shift</option>
        </select>
        {activeModule === 'incidents' && (
          <select value={incidentStateFilter} onChange={event => setIncidentStateFilter(event.target.value as typeof incidentStateFilter)} className="rounded-lg border p-2 text-sm">
            <option value="all">ทุกสถานะ Incident</option><option value="reported">ยังไม่รับทราบ</option>
            <option value="acknowledged">รับทราบแล้ว</option><option value="in_progress">กำลังดำเนินการ</option>
            <option value="resolved">แก้ไขแล้ว</option><option value="closed">ปิดเหตุ</option>
          </select>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <button
          onClick={() => { setActiveModule('vehicles'); setStatusFilter(''); }}
          className={`p-4 border-2 rounded-xl font-bold text-xs flex flex-col items-center gap-2 transition-all cursor-pointer ${
            activeModule === 'vehicles' ? 'border-indigo-600 bg-indigo-50/30 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Car className="w-5 h-5" />
          ประวัติรถเข้า-ออก
        </button>
        <button
          onClick={() => { setActiveModule('contractors'); setStatusFilter(''); }}
          className={`p-4 border-2 rounded-xl font-bold text-xs flex flex-col items-center gap-2 transition-all cursor-pointer ${
            activeModule === 'contractors' ? 'border-indigo-600 bg-indigo-50/30 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Users className="w-5 h-5" />
          ผู้รับเหมา/ช่าง
        </button>
        <button
          onClick={() => { setActiveModule('keys'); setStatusFilter(''); }}
          className={`p-4 border-2 rounded-xl font-bold text-xs flex flex-col items-center gap-2 transition-all cursor-pointer ${
            activeModule === 'keys' ? 'border-indigo-600 bg-indigo-50/30 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Key className="w-5 h-5" />
          การเบิกคืนกุญแจ
        </button>
        <button
          onClick={() => { setActiveModule('patrols'); setStatusFilter(''); }}
          className={`p-4 border-2 rounded-xl font-bold text-xs flex flex-col items-center gap-2 transition-all cursor-pointer ${
            activeModule === 'patrols' ? 'border-indigo-600 bg-indigo-50/30 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <ShieldCheck className="w-5 h-5" />
          รายงานเดินตรวจ
        </button>
        <button
          onClick={() => { setActiveModule('incidents'); setStatusFilter(''); }}
          className={`p-4 border-2 rounded-xl font-bold text-xs flex flex-col items-center gap-2 transition-all cursor-pointer ${
            activeModule === 'incidents' ? 'border-indigo-600 bg-indigo-50/30 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <AlertTriangle className="w-5 h-5" />
          รายงานเหตุด่วน
        </button>
      </div>

      {/* Advanced Filter Box */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          
          {/* Keyword Query */}
          <div className="sm:col-span-4 flex flex-col gap-1.5">
            <span className="text-xs font-bold text-slate-500">คีย์เวิร์ดที่ต้องการค้นหา</span>
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ป้อนข้อมูล ทะเบียนรถ, ชื่อบุคคล, ห้อง..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          {/* Date Picker Start */}
          <div className="sm:col-span-3 flex flex-col gap-1.5">
            <span className="text-xs font-bold text-slate-500">เริ่มต้นวันที่</span>
            <div className="relative">
              <Calendar className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          {/* Date Picker End */}
          <div className="sm:col-span-3 flex flex-col gap-1.5">
            <span className="text-xs font-bold text-slate-500">สิ้นสุดวันที่</span>
            <div className="relative">
              <Calendar className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          {/* Status Dropdown */}
          <div className="sm:col-span-2 flex flex-col gap-1.5">
            <span className="text-xs font-bold text-slate-500">สถานะบันทึก</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full p-2 border border-slate-300 bg-white rounded-xl text-xs font-semibold outline-none focus:border-indigo-600"
            >
              <option value="">ทั้งหมด</option>
              {activeModule === 'vehicles' && (
                <>
                  <option value="กำลังจอด">กำลังจอด</option>
                  <option value="ออกแล้ว">ออกแล้ว</option>
                </>
              )}
              {activeModule === 'contractors' && (
                <>
                  <option value="กำลังปฏิบัติงาน">กำลังปฏิบัติงาน</option>
                  <option value="ออกแล้ว">ออกแล้ว</option>
                </>
              )}
              {activeModule === 'keys' && (
                <>
                  <option value="ถูกเบิก">ถูกเบิก</option>
                  <option value="คืนแล้ว">คืนแล้ว</option>
                </>
              )}
              {activeModule === 'patrols' && (
                <>
                  <option value="ปกติ">ปกติ</option>
                  <option value="ผิดปกติ">ผิดปกติ</option>
                  <option value="ต้องติดตาม">ต้องติดตาม</option>
                </>
              )}
              {activeModule === 'incidents' && (
                <>
                  <option value="แจ้งแล้ว">แจ้งแล้ว</option>
                  <option value="กำลังดำเนินการ">กำลังดำเนินการ</option>
                  <option value="ปิดงานแล้ว">ปิดงานแล้ว</option>
                </>
              )}
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center border-t border-slate-100 pt-3">
          <span className="text-xs font-bold text-slate-400">
            พบข้อมูลประวัติทั้งหมด {filteredList.length} รายการ
          </span>
          <button
            onClick={fetchAllHistory}
            className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> ซิงค์ข้อมูลใหม่
          </button>
        </div>
      </div>

      {/* Main Historical Table Container */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-20 text-center font-bold text-slate-500 animate-pulse text-sm">
            กำลังสืบค้นบันทึกความปลอดภัยจากระบบคลาวด์...
          </div>
        ) : filteredList.length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            <Filter className="w-12 h-12 mx-auto mb-2 text-slate-200" />
            <p className="text-sm font-bold">ไม่พบประวัติข้อมูลตามเงื่อนไขที่ป้อนเข้ามา</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[11px] font-bold tracking-wider uppercase border-b border-slate-100">
                  <th className="py-3.5 px-5">วันที่ / เวลา</th>
                  <th className="py-3.5 px-5">รหัสอ้างอิง / ทะเบียน / ตู้ห้อง</th>
                  <th className="py-3.5 px-5">รายละเอียดหลัก</th>
                  <th className="py-3.5 px-5">พนักงานจดบันทึก</th>
                  <th className="py-3.5 px-5">สถานะ</th>
                  <th className="py-3.5 px-5 text-right">การกระทำ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                {paginatedList.map((item, idx) => {
                  const lifecycle = lifecycleFor(item);
                  let idVal = '';
                  let titleVal = '';
                  let descVal = '';
                  let guardVal = item.recorded_by || item.issued_by || item.guard_name || item.reported_by || '';
                  let timeVal = item.entry_time || item.checkout_time || item.checkin_time || item.incident_datetime || item.created_at || '';

                  // Map module data fields
                  if (activeModule === 'vehicles') {
                    idVal = item.card_number;
                    titleVal = item.vehicle_plate;
                    descVal = `ไปห้อง ${item.target_room} (${item.purpose})`;
                  } else if (activeModule === 'contractors') {
                    idVal = item.contractor_log_id;
                    titleVal = item.contractor_name;
                    descVal = `${item.company || 'งานทั่วไป'} • ซ่อม: ${item.work_type} • ไปห้อง ${item.target_room}`;
                  } else if (activeModule === 'keys') {
                    idVal = `ตู้: ${item.room_number}`;
                    titleVal = item.borrower_name;
                    descVal = `เหตุผล: ${item.purpose} (${item.key_type})`;
                  } else if (activeModule === 'patrols') {
                    idVal = item.patrol_point_id;
                    titleVal = item.point_name;
                    descVal = `ประเภทเช็คพอยต์: ${item.status === 'ปกติ' ? 'ตรวจเรียบร้อย' : item.abnormal_detail}`;
                  } else if (activeModule === 'incidents') {
                    idVal = item.incident_id;
                    titleVal = item.incident_type;
                    descVal = `📍 พิกัด: ${item.location} • คำอธิบาย: ${item.description}`;
                  }

                  return (
                    <tr key={idx} className="hover:bg-indigo-50/10 transition-colors">
                      <td className="py-3 px-5 font-mono text-slate-500 whitespace-nowrap">
                        {formatThaiDateTime(timeVal)}
                      </td>
                      <td className="py-3 px-5 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-indigo-600 font-mono text-[11px]">{idVal}</span>
                          <span className="font-extrabold text-slate-800 text-sm">{titleVal}</span>
                        </div>
                      </td>
                      <td className="py-3 px-5 max-w-xs truncate">{descVal}</td>
                      <td className="py-3 px-5 whitespace-nowrap">{guardVal}</td>
                      <td className="py-3 px-5 whitespace-nowrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          item.status === 'ปกติ' || item.status === 'ออกแล้ว' || item.status === 'คืนแล้ว' || item.status === 'ปิดงานแล้ว'
                            ? 'bg-emerald-100 text-emerald-800' 
                            : item.status === 'กำลังจอด' || item.status === 'กำลังปฏิบัติงาน' || item.status === 'กำลังดำเนินการ'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}>
                          {item.status}
                        </span>
                        {lifecycle.carryOver && (
                          <span className="ml-1.5 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                            ค้างจากกะก่อน
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <button
                          onClick={() => handleOpenDetail(item)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg text-slate-700 flex items-center gap-1 ml-auto cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          ดูรายละเอียด
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-50 border-t border-slate-100 p-4 gap-3">
            <span className="text-xs font-bold text-slate-500">
              แสดง {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, totalItems)} จากทั้งหมด {totalItems} รายการ
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 disabled:bg-slate-50 disabled:text-slate-300 border border-slate-200 rounded-lg text-xs font-extrabold transition-all cursor-pointer shadow-xs"
              >
                ย้อนกลับ
              </button>
              <span className="px-3 py-1.5 text-xs font-extrabold bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg">
                หน้า {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 disabled:bg-slate-50 disabled:text-slate-300 border border-slate-200 rounded-lg text-xs font-extrabold transition-all cursor-pointer shadow-xs"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal Dialog */}
      {selectedRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col overflow-hidden max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-slate-50 p-5 border-b border-slate-100 flex justify-between items-center">
              <div>
                <span className="text-xs font-bold text-indigo-600 uppercase font-mono">แฟ้มประวัติความปลอดภัย</span>
                <h3 className="text-base font-black text-slate-800">
                  {selectedRecord.log_id || selectedRecord.contractor_log_id || selectedRecord.key_log_id || selectedRecord.patrol_log_id || selectedRecord.incident_id}
                </h3>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="p-1 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col gap-5 overflow-y-auto">
              
              {/* Info Matrix Fields */}
              <div className="grid grid-cols-2 gap-4 text-xs font-semibold text-slate-600 border-b border-slate-100 pb-5">
                {Object.entries(selectedRecord).map(([key, val]) => {
                  // Skip system files ID strings or raw timestamps in raw display
                  if (key.endsWith('_url') || key === 'created_at' || key === 'updated_at') return null;
                  
                  // Label Translator mapping for elegance
                  const labels: { [key: string]: string } = {
                    card_number: '💳 หมายเลขบัตร',
                    vehicle_plate: '🚗 ทะเบียนรถ',
                    vehicle_type: '🚙 ประเภทรถ',
                    visitor_name: '👥 ชื่อผู้ขับขี่',
                    visitor_phone: '📞 เบอร์โทรศัพท์',
                    target_room: '🏢 ห้องติดต่อ',
                    purpose: '📋 วัตถุประสงค์',
                    entry_time: '⏱️ เวลาเข้าพื้นที่',
                    exit_time: '🚪 เวลาออกจากอาคาร',
                    recorded_by: '👮 เจ้าหน้าที่ผู้จดบันทึก',
                    contractor_name: '👤 ชื่อช่างผู้รับเหมา',
                    id_card_number: '📇 เลขบัตรประชาชน',
                    company: '🏢 ห้างร้านสังกัด',
                    owner_name: '👥 ชื่อผู้ว่าจ้างเจ้าของห้อง',
                    work_type: '⚡ ประเภทงานช่าง',
                    checkout_time: '🔑 เวลาเบิกจ่ายกุญแจ',
                    return_time: '📥 เวลาส่งรับคืนกุญแจ',
                    issued_by: '👮 ผู้จ่ายเบิกกุญแจ',
                    returned_by: '👮 ผู้รับคืนกุญแจ',
                    point_name: '📍 ตำแหน่งพิกัดตรวจ',
                    location: '📍 พิกัดเหตุการณ์',
                    incident_type: '🔥 ประเภทเหตุการณ์',
                    description: '📝 รายละเอียดพฤติการณ์',
                    reported_by: '👤 พนักงานผู้รายงานแจ้ง',
                    shift_leader: '👥 หัวหน้าชุดผู้อนุมัติ',
                    management_note: '📝 บันทึกฝ่ายบริหารอาคาร',
                    status: '⚙️ สถานะบันทึกในตาราง'
                  };

                  const formattedVal = key.includes('time') || key.endsWith('_at')
                    ? formatThaiDateTime(val)
                    : val === null || val === undefined || val === '' ? '—' : String(val);

                  return (
                    <div key={key} className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-400 uppercase font-bold">{labels[key] || key}</span>
                      <span className="text-slate-800 font-bold text-sm bg-slate-50 p-2 rounded-lg">{formattedVal}</span>
                    </div>
                  );
                })}
              </div>

              {/* Resolved Photos Section from Cloud Storage */}
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">🖼️ ภาพถ่ายหลักฐานประกอบ (Firebase Storage Attachments)</h4>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(resolvedImages).map(([field, url]) => {
                    const label: { [key: string]: string } = {
                      entry_plate_photo_url: 'ป้ายทะเบียนรถเข้า',
                      entry_vehicle_photo_url: 'สภาพตัวรถเข้า',
                      exit_plate_photo_url: 'ป้ายทะเบียนรถออก',
                      exit_vehicle_photo_url: 'สภาพตัวรถออก',
                      id_card_photo_url: 'บัตรประชาชนช่าง',
                      face_photo_url: 'ใบหน้าช่างผู้รับเหมา',
                      signature_image_url: 'ลายเซ็นรับเบิกกุญแจ',
                      borrower_photo_url: 'พยานเบิกจ่ายกุญแจ',
                      return_photo_url: 'รูปหลักฐานการคืนกุญแจ',
                      return_signature_url: 'ลายเซ็นผู้คืนกุญแจ',
                      photo_url: 'รูปถ่ายเหตุด่วนภัยคุกคาม',
                      incident_photo_url: 'ความเสียหายกรณีเดินตรวจ',
                      evidence_photo_1_url: 'รูปหลักฐานจุดตรวจ 1',
                      evidence_photo_2_url: 'รูปหลักฐานจุดตรวจ 2'
                    };

                    return (
                      <div key={field} className="flex flex-col gap-1 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                        <span className="text-[10px] font-bold text-slate-500">{label[field] || field}</span>
                        <div className="relative w-full h-32 rounded-lg overflow-hidden border border-slate-200 bg-white flex items-center justify-center">
                          {url === 'loading' ? (
                            <div className="text-[11px] font-bold text-slate-400 animate-pulse">กำลังดาวน์โหลดภาพจาก Cloud Storage...</div>
                          ) : url ? (
                            <AuthenticatedEvidenceImage mediaReference={String(selectedRecord[field])} alt={field} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] text-slate-400">ไม่มีการแนบภาพถ่าย</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setSelectedRecord(null)}
                className="py-2.5 px-6 bg-slate-900 hover:bg-slate-950 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                ปิดหน้าต่างรายละเอียด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
