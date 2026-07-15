/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, RefreshCw, Plus, Trash2, Ban, Car, MapPin, Check,
  UserCheck, CreditCard, ShieldAlert, AlertTriangle
} from 'lucide-react';
import { readSheet, appendSheetRow, updateSheetRow, deleteSheetRow } from '../googleApi';
import { UserRecord, ParkingCardRecord, PatrolPointRecord, BlacklistRecord } from '../types';
import ConfirmModal from './ConfirmModal';

export default function MasterData() {
  const [activeTab, setActiveTab] = useState<'guards' | 'cards' | 'points' | 'blacklist'>('guards');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Delete Confirmation Modal States
  const [showDeleteGuardModal, setShowDeleteGuardModal] = useState(false);
  const [guardToDelete, setGuardToDelete] = useState<{ userId: string; name: string } | null>(null);

  const [showDeleteBlacklistModal, setShowDeleteBlacklistModal] = useState(false);
  const [blacklistIdToDelete, setBlacklistIdToDelete] = useState<string | null>(null);

  // Data Store
  const [guards, setGuards] = useState<UserRecord[]>([]);
  const [cards, setCards] = useState<ParkingCardRecord[]>([]);
  const [points, setPoints] = useState<PatrolPointRecord[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);

  // Add Forms
  const [guardForm, setGuardForm] = useState({ name: '', login_email: '', role: 'Guard', shift: 'กะเช้า (06:00 - 18:00)', phone: '' });
  const [cardForm, setCardForm] = useState({ card_number: '', note: '' });
  const [pointForm, setPointForm] = useState({ point_name: '', location_detail: '', required_interval_minutes: 60 });
  const [blacklistForm, setBlacklistForm] = useState({ type: 'ทะเบียนรถ', vehicle_plate: '', id_card_number: '', name: '', reason: '', severity: 'ห้ามเข้าเด็ดขาด' });

  useEffect(() => {
    fetchMasterData();
  }, [activeTab]);

  const fetchMasterData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'guards') {
        const u = await readSheet<UserRecord>('Users');
        setGuards(u.filter(user => user.status === 'Active'));
      } else if (activeTab === 'cards') {
        const c = await readSheet<ParkingCardRecord>('ParkingCards');
        setCards(c);
      } else if (activeTab === 'points') {
        const p = await readSheet<PatrolPointRecord>('PatrolPoints');
        setPoints(p.filter(pt => pt.status === 'Active'));
      } else if (activeTab === 'blacklist') {
        const b = await readSheet<BlacklistRecord>('Blacklist');
        setBlacklist(b.filter(bl => bl.status === 'Active'));
      }
    } catch (err) {
      console.error('Failed to load master config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddGuard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guardForm.name || !guardForm.phone) return;

    setLoading(true);
    setStatusMessage(null);

    try {
      const nowStr = new Date().toISOString();
      const userId = 'U' + Math.floor(Math.random() * 10000);

      const newGuard: UserRecord = {
        user_id: userId,
        login_email: guardForm.login_email || 'shared@example.com',
        operator_name: guardForm.name,
        role: guardForm.role as any,
        shift: guardForm.shift as any,
        phone: guardForm.phone,
        status: 'Active',
        created_at: nowStr,
        updated_at: nowStr
      };

      await appendSheetRow('Users', newGuard);
      setStatusMessage({ type: 'success', text: `เพิ่มพนักงาน "${guardForm.name}" สำเร็จ!` });
      setGuardForm({ name: '', login_email: '', role: 'Guard', shift: 'กะเช้า (06:00 - 18:00)', phone: '' });
      fetchMasterData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGuard = async (userId: string, name: string) => {
    setGuardToDelete({ userId, name });
    setShowDeleteGuardModal(true);
  };

  const handleConfirmDeleteGuard = async () => {
    if (!guardToDelete) return;
    const { userId, name } = guardToDelete;
    setShowDeleteGuardModal(false);
    setGuardToDelete(null);

    setLoading(true);
    try {
      await deleteSheetRow('Users', 'user_id', userId);
      setStatusMessage({ type: 'success', text: `นำรายชื่อพนักงาน "${name}" ออกจากสารบบเรียบร้อย` });
      fetchMasterData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
      setLoading(false);
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardForm.card_number) return;

    setLoading(true);
    setStatusMessage(null);

    try {
      const nowStr = new Date().toISOString();
      const cardId = 'C' + Math.floor(Math.random() * 10000);

      const newCard: ParkingCardRecord = {
        card_id: cardId,
        card_number: cardForm.card_number,
        qr_code_value: `${cardForm.card_number}_QR`,
        status: 'ว่าง',
        note: cardForm.note,
        created_at: nowStr,
        updated_at: nowStr
      };

      await appendSheetRow('ParkingCards', newCard);
      setStatusMessage({ type: 'success', text: `เพิ่มบัตรจอดรถหมายเลข "${cardForm.card_number}" สำเร็จ!` });
      setCardForm({ card_number: '', note: '' });
      fetchMasterData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleAddPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pointForm.point_name) return;

    setLoading(true);
    setStatusMessage(null);

    try {
      const nowStr = new Date().toISOString();
      const pointId = 'PP' + Math.floor(Math.random() * 10000);

      const newPoint: PatrolPointRecord = {
        patrol_point_id: pointId,
        point_name: pointForm.point_name,
        location_detail: pointForm.location_detail,
        qr_code_value: `${pointId}_QR`,
        required_interval_minutes: Number(pointForm.required_interval_minutes),
        status: 'Active',
        created_at: nowStr,
        updated_at: nowStr
      };

      await appendSheetRow('PatrolPoints', newPoint);
      setStatusMessage({ type: 'success', text: `สร้างจุดตรวจใหม่ "${pointForm.point_name}" สำเร็จ!` });
      setPointForm({ point_name: '', location_detail: '', required_interval_minutes: 60 });
      fetchMasterData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleAddBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blacklistForm.reason) return;

    setLoading(true);
    setStatusMessage(null);

    try {
      const nowStr = new Date().toISOString();
      const blacklistId = 'BL' + Math.floor(Math.random() * 10000);

      const newBl: BlacklistRecord = {
        blacklist_id: blacklistId,
        type: blacklistForm.type as any,
        vehicle_plate: blacklistForm.type === 'ทะเบียนรถ' ? blacklistForm.vehicle_plate : '',
        id_card_number: blacklistForm.type === 'เลขบัตรประชาชน' ? blacklistForm.id_card_number : '',
        name: blacklistForm.type === 'ชื่อบุคคล' ? blacklistForm.name : '',
        reason: blacklistForm.reason,
        severity: blacklistForm.severity as any,
        status: 'Active',
        created_at: nowStr,
        updated_at: nowStr
      };

      await appendSheetRow('Blacklist', newBl);
      setStatusMessage({ type: 'success', text: `ขึ้นบัญชีดำแบล็กลิสต์เรียบร้อย!` });
      setBlacklistForm({ type: 'ทะเบียนรถ', vehicle_plate: '', id_card_number: '', name: '', reason: '', severity: 'ห้ามเข้าเด็ดขาด' });
      fetchMasterData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBlacklist = async (id: string) => {
    setBlacklistIdToDelete(id);
    setShowDeleteBlacklistModal(true);
  };

  const handleConfirmDeleteBlacklist = async () => {
    if (!blacklistIdToDelete) return;
    const id = blacklistIdToDelete;
    setShowDeleteBlacklistModal(false);
    setBlacklistIdToDelete(null);

    setLoading(true);
    try {
      await deleteSheetRow('Blacklist', 'blacklist_id', id);
      setStatusMessage({ type: 'success', text: `นำออกจากบัญชีดำสำเร็จ` });
      fetchMasterData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 px-1 pb-16">
      
      {/* Title */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
          ⚙️ ระบบจัดการข้อมูลตั้งต้นอาคาร (Master Configuration)
        </h1>
        <p className="text-xs text-slate-500 font-medium mt-1">
          สิทธิ์ผู้จัดการ/แอดมิน: บริหารพนักงานรักษาความปลอดภัย ทะเบียนบัตรผ่าน จุดเดินตรวจ และขึ้นบัญชีดำระวังภัยอาคาร
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 text-xs font-bold bg-white p-2 rounded-xl border">
        <button
          onClick={() => { setActiveTab('guards'); setStatusMessage(null); }}
          className={`flex-1 py-3 px-2 text-center rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'guards' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          รายชื่อพนักงาน รปภ.
        </button>
        <button
          onClick={() => { setActiveTab('cards'); setStatusMessage(null); }}
          className={`flex-1 py-3 px-2 text-center rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'cards' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          บัตรจอดรถอาคาร
        </button>
        <button
          onClick={() => { setActiveTab('points'); setStatusMessage(null); }}
          className={`flex-1 py-3 px-2 text-center rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'points' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <MapPin className="w-4 h-4" />
          พิกัดจุดเดินตรวจ
        </button>
        <button
          onClick={() => { setActiveTab('blacklist'); setStatusMessage(null); }}
          className={`flex-1 py-3 px-2 text-center rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'blacklist' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          บัญชีดำ (Blacklist)
        </button>
      </div>

      {statusMessage && (
        <div className={`p-4 rounded-xl flex items-start gap-2 text-sm font-semibold shadow-sm ${
          statusMessage.type === 'success' 
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' 
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <Check className="w-5 h-5 shrink-0" />
          <span>{statusMessage.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Form Section */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-1.5 uppercase">
            <Plus className="w-4.5 h-4.5 text-indigo-600" />
            เขียนบันทึกตั้งค่าชิ้นใหม่
          </h2>

          {activeTab === 'guards' && (
            <form onSubmit={handleAddGuard} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">ชื่อ-นามสกุลพนักงาน *</span>
                <input
                  type="text"
                  value={guardForm.name}
                  onChange={(e) => setGuardForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="เช่น รปภ. มั่งคง เฝ้าตึก"
                  className="p-3 border border-slate-300 rounded-xl text-xs font-bold outline-none"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">อีเมล Google ล็อกอิน *</span>
                <input
                  type="email"
                  value={guardForm.login_email}
                  onChange={(e) => setGuardForm(prev => ({ ...prev, login_email: e.target.value }))}
                  placeholder="เช่น guard@example.com"
                  className="p-3 border border-slate-300 rounded-xl text-xs font-bold outline-none"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">ระดับสิทธิ์ความปลอดภัย</span>
                <select
                  value={guardForm.role}
                  onChange={(e) => setGuardForm(prev => ({ ...prev, role: e.target.value }))}
                  className="p-3 border border-slate-300 bg-white rounded-xl text-xs font-bold"
                >
                  <option value="Guard">รปภ. ประจำจุด (Guard)</option>
                  <option value="Shift Leader">หัวหน้าชุดสายตรวจ (Shift Leader)</option>
                  <option value="Manager">ผู้จัดการ / นิติบุคคล (Manager)</option>
                  <option value="Admin">แอดมินระบบหลัก (Admin)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">กะเวลาทำงาน</span>
                <select
                  value={guardForm.shift}
                  onChange={(e) => setGuardForm(prev => ({ ...prev, shift: e.target.value }))}
                  className="p-3 border border-slate-300 bg-white rounded-xl text-xs font-bold"
                >
                  <option value="กะเช้า (06:00 - 18:00)">☀️ กะเช้า (06:00 - 18:00)</option>
                  <option value="กะกลางคืน (18:00 - 06:00)">🌙 กะกลางคืน (18:00 - 06:00)</option>
                  <option value="ทั่วไป">🏢 พนักงานทั่วไป (Manager/Admin)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">เบอร์โทรศัพท์ติดต่อ *</span>
                <input
                  type="tel"
                  value={guardForm.phone}
                  onChange={(e) => setGuardForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="เช่น 0812345678"
                  className="p-3 border border-slate-300 rounded-xl text-xs font-bold font-mono outline-none"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                {loading ? 'กำลังประมวลผล...' : '💾 เพิ่มชื่อพนักงานเข้าสารบบ'}
              </button>
            </form>
          )}

          {activeTab === 'cards' && (
            <form onSubmit={handleAddCard} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">หมายเลขบัตรจอดรถอาคาร *</span>
                <input
                  type="text"
                  value={cardForm.card_number}
                  onChange={(e) => setCardForm(prev => ({ ...prev, card_number: e.target.value }))}
                  placeholder="เช่น P009, P010"
                  className="p-3 border border-slate-300 rounded-xl text-xs font-bold outline-none font-mono"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">รายละเอียดบัตร / หมายเหตุ</span>
                <input
                  type="text"
                  value={cardForm.note}
                  onChange={(e) => setCardForm(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="เช่น บัตรจอดรถทั่วไป"
                  className="p-3 border border-slate-300 rounded-xl text-xs font-bold outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                💾 เพิ่มบัตรคิวเข้าสู่ระบบ
              </button>
            </form>
          )}

          {activeTab === 'points' && (
            <form onSubmit={handleAddPoint} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">ชื่อเรียกจุดเดินตรวจพิกัดอาคาร *</span>
                <input
                  type="text"
                  value={pointForm.point_name}
                  onChange={(e) => setPointForm(prev => ({ ...prev, point_name: e.target.value }))}
                  placeholder="เช่น บานประตูควบคุมไฟฟ้าอาคาร B ชั้น 2"
                  className="p-3 border border-slate-300 rounded-xl text-xs font-bold outline-none"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">รายละเอียดพิกัดทางกายภาพ</span>
                <input
                  type="text"
                  value={pointForm.location_detail}
                  onChange={(e) => setPointForm(prev => ({ ...prev, location_detail: e.target.value }))}
                  placeholder="เช่น ข้างลิฟต์ขนของ ติดป้ายสัญญาณไฟเตือนภัย"
                  className="p-3 border border-slate-300 rounded-xl text-xs font-bold outline-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">ความถี่ขั้นต่ำในการเดินตรวจ (นาที)</span>
                <input
                  type="number"
                  value={pointForm.required_interval_minutes}
                  onChange={(e) => setPointForm(prev => ({ ...prev, required_interval_minutes: Number(e.target.value) }))}
                  placeholder="60"
                  className="p-3 border border-slate-300 rounded-xl text-xs font-bold outline-none font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                💾 บันทึกจัดตั้งจุดตรวจพิกัดคลาวด์
              </button>
            </form>
          )}

          {activeTab === 'blacklist' && (
            <form onSubmit={handleAddBlacklist} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">ประเภทระวังภัยหลัก</span>
                <select
                  value={blacklistForm.type}
                  onChange={(e) => setBlacklistForm(prev => ({ ...prev, type: e.target.value as any }))}
                  className="p-3 border border-slate-300 bg-white rounded-xl text-xs font-bold"
                >
                  <option value="ทะเบียนรถ">🚗 ทะเบียนรถยนต์แบล็กลิสต์</option>
                  <option value="เลขบัตรประชาชน">📇 เลขบัตรประชาชนคนห้ามเข้า</option>
                  <option value="ชื่อบุคคล">👥 รายชื่อบุคคลเฝ้าระวังภัย</option>
                </select>
              </div>

              {blacklistForm.type === 'ทะเบียนรถ' && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-slate-500">ทะเบียนรถยนต์ระวังภัย *</span>
                  <input
                    type="text"
                    value={blacklistForm.vehicle_plate}
                    onChange={(e) => setBlacklistForm(prev => ({ ...prev, vehicle_plate: e.target.value }))}
                    placeholder="เช่น กข 9999"
                    className="p-3 border border-slate-300 rounded-xl text-xs font-bold outline-none"
                    required
                  />
                </div>
              )}

              {blacklistForm.type === 'เลขบัตรประชาชน' && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-slate-500">เลขบัตรประจำตัวระวังภัย *</span>
                  <input
                    type="text"
                    value={blacklistForm.id_card_number}
                    onChange={(e) => setBlacklistForm(prev => ({ ...prev, id_card_number: e.target.value }))}
                    placeholder="เช่น 1234567890123"
                    className="p-3 border border-slate-300 rounded-xl text-xs font-bold font-mono outline-none"
                    required
                  />
                </div>
              )}

              {blacklistForm.type === 'ชื่อบุคคล' && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-slate-500">ชื่อจริงระวังภัยคุกคาม *</span>
                  <input
                    type="text"
                    value={blacklistForm.name}
                    onChange={(e) => setBlacklistForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="เช่น นายปะทุ ทะเลาะบ่อย"
                    className="p-3 border border-slate-300 rounded-xl text-xs font-bold outline-none"
                    required
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">รายละเอียดเหตุผลในการแบล็กลิสต์ *</span>
                <textarea
                  value={blacklistForm.reason}
                  onChange={(e) => setBlacklistForm(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="พฤติการณ์ความไม่มั่นคง เช่น ลักขโมย ชักจูงคนบุกรุก ทำร้ายร่างกาย รปภ..."
                  className="p-3 border border-slate-300 rounded-xl text-xs font-semibold outline-none"
                  rows={3}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500">ระดับความเร่งด่วนในการป้องกัน</span>
                <select
                  value={blacklistForm.severity}
                  onChange={(e) => setBlacklistForm(prev => ({ ...prev, severity: e.target.value }))}
                  className="p-3 border border-slate-300 bg-white rounded-xl text-xs font-bold text-red-600"
                >
                  <option value="เตือนภัยระดับต่ำ">🟡 เตือนภัยระดับต่ำ (เฝ้าระวังการเคลื่อนไหว)</option>
                  <option value="เฝ้าระวังพิเศษ">🟠 เฝ้าระวังพิเศษ (ตรวจสอบเหตุทำงาน)</option>
                  <option value="ห้ามเข้าเด็ดขาด">🔴 ห้ามเข้าเด็ดขาด (ห้ามจอดผ่านประตูแบริเออร์)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                ⚠️ บันทึกขึ้นแบล็กลิสต์ระวังภัย
              </button>
            </form>
          )}
        </div>

        {/* Right Column: Tabular View Section */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm overflow-hidden flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-black text-slate-800 uppercase flex items-center gap-1.5">
              📋 รายละเอียดสารบบทั้งหมด
            </h2>
            <button
              onClick={fetchMasterData}
              className="p-1 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="py-20 text-center font-bold text-slate-500 animate-pulse text-xs">
              กำลังรวบรวมข้อมูลตั้งต้น...
            </div>
          ) : (
            <div className="overflow-y-auto max-h-[400px]">
              
              {/* GUARDS VIEW */}
              {activeTab === 'guards' && (
                <div className="flex flex-col gap-2.5">
                  {guards.map(user => (
                    <div key={user.user_id} className="flex justify-between items-center p-3 bg-slate-50 border border-slate-200 rounded-xl hover:border-indigo-200 transition-colors">
                      <div>
                        <span className="text-xs font-black text-slate-800">{user.operator_name}</span>
                        <span className="text-[10px] font-mono text-slate-400 ml-2">({user.login_email})</span>
                        <p className="text-[10px] text-slate-500 font-bold mt-0.5">👮 {user.role} • ⏱️ {user.shift}</p>
                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">📞 {user.phone}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteGuard(user.user_id, user.operator_name)}
                        className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* CARDS VIEW */}
              {activeTab === 'cards' && (
                <div className="flex flex-col gap-2.5">
                  {cards.map(card => (
                    <div key={card.card_id} className="flex justify-between items-center p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="flex items-center gap-2">
                        <div className="px-2.5 py-1 bg-white border border-slate-300 text-xs font-black font-mono text-slate-700 rounded-lg">
                          {card.card_number}
                        </div>
                        <div>
                          <span className="text-[11px] font-bold text-slate-500">{card.note || 'ไม่มีระบุหมายเหตุ'}</span>
                          {card.current_vehicle_plate && (
                            <p className="text-[10px] text-indigo-600 font-bold mt-0.5">🚗 รถทะเบียนเข้าจอด: {card.current_vehicle_plate}</p>
                          )}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        card.status === 'ว่าง' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {card.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* POINTS VIEW */}
              {activeTab === 'points' && (
                <div className="flex flex-col gap-2.5">
                  {points.map(pt => (
                    <div key={pt.patrol_point_id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className="text-xs font-black text-slate-800">{pt.point_name}</span>
                      <p className="text-[10px] text-slate-500 mt-0.5">📍 พิกัด: {pt.location_detail || 'ไม่ระบุสถานที่'}</p>
                      <p className="text-[10px] text-indigo-600 font-bold mt-0.5 font-mono">🎯 QR Code Value: {pt.qr_code_value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* BLACKLIST VIEW */}
              {activeTab === 'blacklist' && (
                <div className="flex flex-col gap-2.5">
                  {blacklist.map(bl => (
                    <div key={bl.blacklist_id} className="p-3 bg-red-50/50 border border-red-200 rounded-xl flex justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Ban className="w-3.5 h-3.5 text-red-600 shrink-0" />
                          <span className="text-xs font-black text-slate-800">
                            {bl.type === 'ทะเบียนรถ' ? `🚗 ทะเบียน: ${bl.vehicle_plate}` : bl.type === 'เลขบัตรประชาชน' ? `📇 บัตรประชาชน: ${bl.id_card_number}` : `👤 บุคคล: ${bl.name}`}
                          </span>
                        </div>
                        <p className="text-[10px] text-red-700 bg-red-100/50 p-1 rounded mt-1.5 font-bold">⚠️ เหตุผล: {bl.reason}</p>
                        <span className="text-[10px] text-slate-400 block mt-1 font-bold">🚨 ความเสี่ยง: {bl.severity}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteBlacklist(bl.blacklist_id)}
                        className="p-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

            </div>
          )}
        </div>

      </div>

      <ConfirmModal
        isOpen={showDeleteGuardModal}
        title="ยืนยันนำพนักงานออกจากสารบบ"
        message={`คุณต้องการยืนยันการลบรายชื่อพนักงาน รปภ. "${guardToDelete?.name}" ออกจากสารบบความปลอดภัยของระบบบริหารระวังภัยหรือไม่?`}
        confirmText="ยืนยันนำออก"
        cancelText="ยกเลิก"
        onConfirm={handleConfirmDeleteGuard}
        onCancel={() => {
          setShowDeleteGuardModal(false);
          setGuardToDelete(null);
        }}
      />

      <ConfirmModal
        isOpen={showDeleteBlacklistModal}
        title="ยืนยันลบรายการบัญชีดำ"
        message="คุณต้องการยืนยันนำรายชื่อยานพาหนะ/บุคคล ออกจากระบบตรวจจับระวังแบล็กลิสต์ความมั่นคงหรือไม่?"
        confirmText="ยืนยันนำออก"
        cancelText="ยกเลิก"
        onConfirm={handleConfirmDeleteBlacklist}
        onCancel={() => {
          setShowDeleteBlacklistModal(false);
          setBlacklistIdToDelete(null);
        }}
      />
    </div>
  );
}
