/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Key, Search, Check, Camera, X
} from 'lucide-react';
import { KeyLogRecord } from '../types';
import {
  checkoutKey,
  completeKeyReturn,
  listCheckedOutKeys,
  prepareKeyReturn,
} from '../services/keyService';
import { normalizeOptionalIdentityNumber } from '../services/keyIdentityPolicy';
import {
  dataUrlToImageBlob,
  imageBlobToDataUrl,
  submitKeyReturnEvidence,
  validateLocalKeyReturnEvidence,
} from '../services/keyReturnPolicy';
import { uploadImageToDrive } from '../services/mediaUploadService';
import SignaturePad from './SignaturePad';
import ConfirmModal from './ConfirmModal';
import UnitSearchSelect from './UnitSearchSelect';
import { formatThaiDateTime } from '../utils/dateTime';
import { createUuid } from '../utils/uuid';
import AuthenticatedEvidenceImage from './AuthenticatedEvidenceImage';

interface KeyLogsProps {
  guardName: string;
}

export default function KeyLogs({ guardName }: KeyLogsProps) {
  const siteId = sessionStorage.getItem('selected_site_id') || 'site-01';
  const [activeTab, setActiveTab] = useState<'checkout' | 'return'>('checkout');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Return Confirmation Dialog State
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [keyToReturn, setKeyToReturn] = useState<KeyLogRecord | null>(null);

  // Checkout Form State
  const [checkoutForm, setCheckoutForm] = useState({
    room_number: '',
    target_unit_id: '',
    unit_lookup_status: undefined as 'matched' | 'manual' | undefined,
    key_type: 'ห้องพัก' as any,
    borrower_name: '',
    borrower_phone: '',
    borrower_id_number: '',
    purpose: '',
    note: ''
  });
  const [borrowerPhoto, setBorrowerPhoto] = useState<string>('');
  const [signatureImage, setSignatureImage] = useState<string>('');

  // Return State
  const [activeKeys, setActiveKeys] = useState<KeyLogRecord[]>([]);
  const [returnSearchQuery, setReturnSearchQuery] = useState('');
  const [completedKeyLog, setCompletedKeyLog] = useState<KeyLogRecord | null>(null);
  const [returnPhotoFile, setReturnPhotoFile] = useState<File | null>(null);
  const [returnPhotoPreviewUrl, setReturnPhotoPreviewUrl] = useState('');
  const [returnPhotoMediaReference, setReturnPhotoMediaReference] = useState('');
  const [returnSignatureBlob, setReturnSignatureBlob] = useState<Blob | null>(null);
  const [returnSignaturePreviewUrl, setReturnSignaturePreviewUrl] = useState('');
  const [returnSignatureMediaReference, setReturnSignatureMediaReference] = useState('');
  const [returnSignatureHasStroke, setReturnSignatureHasStroke] = useState(false);

  useEffect(() => {
    fetchInitialKeys();
  }, [activeTab]);

  useEffect(() => () => {
    if (returnPhotoPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(returnPhotoPreviewUrl);
    }
  }, [returnPhotoPreviewUrl]);

  const fetchInitialKeys = async () => {
    setLoading(true);
    try {
      const keys = await listCheckedOutKeys(siteId);
      setActiveKeys(keys);
    } catch (err) {
      console.error('Failed to load key data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, setPhoto: (url: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutForm.room_number || !checkoutForm.borrower_name) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกเลขห้องและชื่อผู้รับเบิกกุญแจ' });
      return;
    }

    if (!signatureImage) {
      setStatusMessage({ type: 'error', text: '⚠️ กรุณาลงลายมือชื่อลงบนช่องลายเซ็นอิเล็กทรอนิกส์ด้านล่าง' });
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      let bPhotoUrl = '';
      let sigUrl = '';
      const keyLogId = `KEY_${createUuid()}`;
      const identityNumber = normalizeOptionalIdentityNumber(checkoutForm.borrower_id_number);

      // 1. Upload Borrower Photo if taken
      if (borrowerPhoto) {
        bPhotoUrl = await uploadImageToDrive(borrowerPhoto, `key_borrower_${checkoutForm.room_number}_${Date.now()}.jpg`, { moduleName: 'KeyLogs', recordId: keyLogId, siteId, uploadedBy: guardName, mediaType: 'key_borrower' });
      }

      // 2. Upload Canvas Signature image
      if (signatureImage) {
        sigUrl = await uploadImageToDrive(signatureImage, `sig_key_${checkoutForm.room_number}_${Date.now()}.jpg`, { moduleName: 'KeyLogs', recordId: keyLogId, siteId, uploadedBy: guardName, mediaType: 'sig_key' });
      }

      // 3. Atomically write KeyLog + immutable audit with server timestamps.
      const newKeyLog = {
        key_log_id: keyLogId,
        room_number: checkoutForm.room_number,
        target_unit_id: checkoutForm.target_unit_id || undefined,
        unit_lookup_status: checkoutForm.unit_lookup_status,
        key_type: checkoutForm.key_type,
        borrower_name: checkoutForm.borrower_name,
        borrower_phone: checkoutForm.borrower_phone,
        borrower_id_number: identityNumber,
        purpose: checkoutForm.purpose,
        issued_by: guardName,
        signature_image_url: sigUrl,
        borrower_photo_url: bPhotoUrl,
        status: 'ถูกเบิก' as const,
        note: checkoutForm.note
      };

      const completed = await checkoutKey(siteId, newKeyLog);
      setCompletedKeyLog(completed);
      setStatusMessage({ type: 'success', text: `บันทึกเบิกกุญแจห้อง ${completed.room_number} เมื่อ ${formatThaiDateTime(completed.checkout_time)}` });

      // Reset
      setCheckoutForm({
        room_number: '',
        target_unit_id: '',
        unit_lookup_status: undefined,
        key_type: 'ห้องพัก',
        borrower_name: '',
        borrower_phone: '',
        borrower_id_number: '',
        purpose: '',
        note: ''
      });
      setBorrowerPhoto('');
      setSignatureImage('');
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleReturnSubmit = async (keyLog: KeyLogRecord) => {
    setKeyToReturn(keyLog);
    setReturnPhotoFile(null);
    setReturnPhotoPreviewUrl('');
    setReturnPhotoMediaReference('');
    setReturnSignatureBlob(null);
    setReturnSignaturePreviewUrl('');
    setReturnSignatureMediaReference('');
    setReturnSignatureHasStroke(false);
    setStatusMessage(null);
  };

  const handleRequestReturnConfirmation = () => {
    try {
      validateLocalKeyReturnEvidence({
        photoFile: returnPhotoFile,
        signatureBlob: returnSignatureBlob,
        signatureHasStroke: returnSignatureHasStroke,
      });
    } catch (error) {
      setStatusMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'หลักฐานการคืนกุญแจไม่ครบถ้วน',
      });
      return;
    }
    setShowReturnModal(true);
  };

  const handleConfirmReturn = async () => {
    if (!keyToReturn) return;
    const keyLog = keyToReturn;
    setShowReturnModal(false);

    setLoading(true);
    setStatusMessage(null);
    let uploadedDuringAttempt = false;

    try {
      const { result: completed } = await submitKeyReturnEvidence({
        recordId: keyLog.key_log_id,
        siteId,
        localEvidence: {
          photoFile: returnPhotoFile,
          signatureBlob: returnSignatureBlob,
          signatureHasStroke: returnSignatureHasStroke,
        },
        existingPhotoReference: returnPhotoMediaReference,
        existingSignatureReference: returnSignatureMediaReference,
      }, {
        prepare: () => prepareKeyReturn(siteId, keyLog.key_log_id),
        uploadPhoto: async photo => uploadImageToDrive(
            await imageBlobToDataUrl(photo),
            `key_return_${keyLog.room_number}_${Date.now()}.${photo.type === 'image/png' ? 'png' : 'jpg'}`,
            {
              moduleName: 'KeyLogs',
              recordId: keyLog.key_log_id,
              siteId,
              uploadedBy: guardName,
              mediaType: 'key_return',
            },
          ),
        uploadSignature: async signature => uploadImageToDrive(
            await imageBlobToDataUrl(signature),
            `sig_key_return_${keyLog.room_number}_${Date.now()}.jpg`,
            {
              moduleName: 'KeyLogs',
              recordId: keyLog.key_log_id,
              siteId,
              uploadedBy: guardName,
              mediaType: 'sig_key_return',
            },
          ),
        onPhotoUploaded: reference => {
          setReturnPhotoMediaReference(reference);
          uploadedDuringAttempt = true;
        },
        onSignatureUploaded: reference => {
          setReturnSignatureMediaReference(reference);
          uploadedDuringAttempt = true;
        },
        complete: evidence => completeKeyReturn(
          siteId,
          keyLog.key_log_id,
          guardName,
          evidence,
        ),
      });
      setCompletedKeyLog(completed);
      setStatusMessage({ type: 'success', text: `รับคืนกุญแจห้อง ${completed.room_number} เมื่อ ${formatThaiDateTime(completed.return_time)}` });
      setKeyToReturn(null);
      setReturnPhotoFile(null);
      setReturnPhotoPreviewUrl('');
      setReturnPhotoMediaReference('');
      setReturnSignatureBlob(null);
      setReturnSignaturePreviewUrl('');
      setReturnSignatureMediaReference('');
      setReturnSignatureHasStroke(false);
      await fetchInitialKeys();
    } catch (err: any) {
      console.error(err);
      const orphanWarning = uploadedDuringAttempt || returnPhotoMediaReference || returnSignatureMediaReference
        ? ' หลักฐานที่อัปโหลดแล้วจะถูกนำกลับมาใช้เมื่อกดลองใหม่ โดยรายการยังไม่ถูกปิด'
        : '';
      setStatusMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}${orphanWarning}` });
    } finally {
      setLoading(false);
    }
  };

  const filteredKeys = activeKeys.filter(k => 
    k.room_number.includes(returnSearchQuery) || 
    k.borrower_name.includes(returnSearchQuery) ||
    k.key_type.includes(returnSearchQuery)
  );

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-5 px-1 pb-10">
      
      {/* Tab Switcher */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => { setActiveTab('checkout'); setStatusMessage(null); }}
          className={`flex-1 py-4 text-center font-bold text-sm border-b-2 flex justify-center items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'checkout' 
              ? 'border-indigo-600 text-indigo-600 bg-white' 
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          🔑 บันทึกจ่ายเบิกกุญแจ (Checkout)
        </button>
        <button
          onClick={() => { setActiveTab('return'); setStatusMessage(null); }}
          className={`flex-1 py-4 text-center font-bold text-sm border-b-2 flex justify-center items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'return' 
              ? 'border-indigo-600 text-indigo-600 bg-white' 
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          📥 ค้นหารับคืนกุญแจ (Return)
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

      {completedKeyLog && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-black">{completedKeyLog.status === 'คืนแล้ว' ? 'รับคืนกุญแจสำเร็จ' : 'เบิกกุญแจสำเร็จ'}</p>
          <p>กุญแจ/ห้อง: {completedKeyLog.room_number}</p>
          <p>ผู้ยืม: {completedKeyLog.borrower_name}</p>
          <p>เวลาเบิก: {formatThaiDateTime(completedKeyLog.checkout_time)}</p>
          <p>เวลาคืน: {formatThaiDateTime(completedKeyLog.return_time)}</p>
          <p>ผู้บันทึก: {completedKeyLog.status === 'คืนแล้ว' ? completedKeyLog.returned_by : completedKeyLog.issued_by}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[
              ['รูป Checkout', completedKeyLog.borrower_photo_url],
              ['ลายเซ็น Checkout', completedKeyLog.signature_image_url],
              ['รูป Return', completedKeyLog.return_photo_url],
              ['ลายเซ็น Return', completedKeyLog.return_signature_url],
            ].map(([label, reference]) => (
              <div key={label} className="rounded-lg border border-emerald-200 bg-white p-2">
                <p className="mb-1 text-xs font-bold">{label}</p>
                {reference
                  ? <AuthenticatedEvidenceImage mediaReference={reference} alt={label} className="h-28 w-full rounded-lg object-cover" />
                  : <div className="flex h-28 items-center justify-center text-xs text-slate-400">ไม่มีหลักฐาน</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'checkout' ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          <h2 className="text-lg font-black text-slate-800">บันทึกประวัติการเบิกออกกุญแจอาคาร</h2>

          <form onSubmit={handleCheckoutSubmit} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              <UnitSearchSelect value={checkoutForm.room_number} selectedUnitId={checkoutForm.target_unit_id}
                label="เลขห้องพัก / พื้นที่กุญแจ" required allowManualEntry
                onSelect={unit => setCheckoutForm(prev => ({ ...prev, room_number: unit?.room_number || '', target_unit_id: unit?.unit_id || '', unit_lookup_status: unit ? (unit.unit_id ? 'matched' : 'manual') : undefined }))} />

              {/* Key type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ประเภทตู้กุญแจ</label>
                <select
                  value={checkoutForm.key_type}
                  onChange={(e) => setCheckoutForm(prev => ({ ...prev, key_type: e.target.value as any }))}
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none bg-white focus:border-indigo-600 text-sm font-semibold"
                >
                  <option value="ห้องพัก">🏠 ห้องพักอาศัย</option>
                  <option value="ห้องไฟฟ้า">⚡ ห้องเครื่องควบคุมไฟฟ้า</option>
                  <option value="ห้องเครื่องจักร">⚙️ ห้องเครื่องจักร/ปั๊มน้ำ</option>
                  <option value="พื้นที่ส่วนกลาง">⛲ พื้นที่อเนกประสงค์ส่วนกลาง</option>
                  <option value="อื่นๆ">🔑 อื่นๆ</option>
                </select>
              </div>

              {/* Borrower Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">ชื่อผู้ขอเบิกกุญแจ *</label>
                <input
                  type="text"
                  value={checkoutForm.borrower_name}
                  onChange={(e) => setCheckoutForm(prev => ({ ...prev, borrower_name: e.target.value }))}
                  placeholder="เช่น นายอุทัย ศรีสุข"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                  required
                />
              </div>

              {/* Phone */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">เบอร์โทรศัพท์ผู้เบิก (ไม่บังคับ)</label>
                <input
                  type="tel"
                  value={checkoutForm.borrower_phone}
                  onChange={(e) => setCheckoutForm(prev => ({ ...prev, borrower_phone: e.target.value }))}
                  placeholder="เช่น 0823456789"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold font-mono"
                />
              </div>

              {/* National ID / ID card number */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">เลขเอกสารประจำตัว (ไม่บังคับ)</label>
                <input
                  type="text"
                  value={checkoutForm.borrower_id_number}
                  onChange={(e) => setCheckoutForm(prev => ({ ...prev, borrower_id_number: e.target.value }))}
                  placeholder="กรอกเลข 13 หลัก หรือ ID ประจำตัว"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold font-mono"
                />
              </div>

              {/* Purpose */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">เหตุผลที่ต้องการเบิก *</label>
                <input
                  type="text"
                  value={checkoutForm.purpose}
                  onChange={(e) => setCheckoutForm(prev => ({ ...prev, purpose: e.target.value }))}
                  placeholder="เช่น ตรวจสอบตู้ควบคุมแสงสว่างชั้นดาดฟ้า"
                  className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-600">หมายเหตุเพิ่มเติม</label>
              <input
                type="text"
                value={checkoutForm.note}
                onChange={(e) => setCheckoutForm(prev => ({ ...prev, note: e.target.value }))}
                placeholder="เช่น คืนให้เสร็จสิ้นภายในวันนี้ก่อนกะค่ำ"
                className="p-3.5 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
              />
            </div>

            {/* Photo Capture Borrower */}
            <div className="flex flex-col gap-2 border border-slate-200 rounded-xl p-4 bg-slate-50">
              <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                <Camera className="w-4 h-4 text-indigo-600" />
                ถ่ายรูปผู้ขอเบิกหรือเอกสารแลกบัตร (ไม่บังคับ)
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handlePhotoUpload(e, setBorrowerPhoto)}
                className="hidden"
                id="borrower-photo-upload"
              />
              <label
                htmlFor="borrower-photo-upload"
                className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-slate-100 transition-colors"
              >
                {borrowerPhoto ? (
                  <img src={borrowerPhoto} alt="Borrower photo" className="h-full w-full object-cover rounded-lg" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-slate-400">
                    <Camera className="w-6 h-6" />
                    <span className="text-xs font-bold">กดเพื่อใช้กล้องถ่ายรูปผู้เบิก/เอกสาร</span>
                  </div>
                )}
              </label>
            </div>

            {/* Electronic Signature */}
            <div className="flex flex-col gap-1.5 border border-slate-200 rounded-xl p-4 bg-slate-50">
              <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                ✏️ ลายมือชื่ออิเล็กทรอนิกส์ผู้รับกุญแจ *
              </label>
              <SignaturePad 
                onSave={(dataUrl) => setSignatureImage(dataUrl)} 
                onClear={() => setSignatureImage('')}
                placeholder="กรุณาใช้นิ้วเขียนลายเซ็นรับกุญแจตรงนี้"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
            >
              {loading ? 'กำลังบันทึกข้อมูลกุญแจ...' : '💾 อนุมัติเบิกกุญแจและบันทึกลงระบบ'}
            </button>
          </form>
        </div>
      ) : (
        /* RETURN TAB */
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
          <h2 className="text-lg font-black text-slate-800">ค้นหารายการกุญแจที่ถูกเบิกค้างส่งคืน</h2>
          
          <div className="relative">
            <Search className="absolute left-3.5 top-3.5 text-slate-400 w-5 h-5" />
            <input
              type="text"
              value={returnSearchQuery}
              onChange={(e) => setReturnSearchQuery(e.target.value)}
              placeholder="ค้นหาเลขห้องพัก, ชื่อผู้เบิกกุญแจ..."
              className="w-full pl-11 pr-4 py-3 border-2 border-slate-200 rounded-xl outline-none focus:border-indigo-600 text-sm font-semibold"
            />
          </div>

          {keyToReturn && (
            <div className="flex flex-col gap-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-emerald-900">หลักฐานคืนกุญแจห้อง {keyToReturn.room_number}</p>
                  <p className="text-xs font-semibold text-emerald-700">ต้องมีรูปและลายเซ็นครบก่อนปิดรายการ</p>
                </div>
                <button
                  type="button"
                  aria-label="ยกเลิกการคืนกุญแจ"
                  onClick={() => {
                    setKeyToReturn(null);
                    setReturnPhotoFile(null);
                    setReturnPhotoPreviewUrl('');
                    setReturnPhotoMediaReference('');
                    setReturnSignatureBlob(null);
                    setReturnSignaturePreviewUrl('');
                    setReturnSignatureMediaReference('');
                    setReturnSignatureHasStroke(false);
                  }}
                  className="rounded-lg p-1 text-slate-500 hover:bg-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
                <span className="flex items-center gap-1 text-xs font-bold text-slate-700">
                  <Camera className="h-4 w-4 text-emerald-600" />
                  ถ่ายรูปหลักฐานการคืนกุญแจ *
                </span>
                <input
                  id="key-return-photo-upload"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setReturnPhotoFile(file);
                    setReturnPhotoPreviewUrl(URL.createObjectURL(file));
                    setReturnPhotoMediaReference('');
                  }}
                />
                <label
                  htmlFor="key-return-photo-upload"
                  className="flex h-36 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-slate-50"
                >
                  {returnPhotoPreviewUrl
                    ? <img src={returnPhotoPreviewUrl} alt="ตัวอย่างรูปหลักฐานการคืนกุญแจ" className="h-full w-full object-cover" />
                    : <span className="text-xs font-bold text-slate-400">กดเพื่อถ่ายหรือเลือกรูป</span>}
                </label>
                {returnPhotoPreviewUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setReturnPhotoFile(null);
                      setReturnPhotoPreviewUrl('');
                      setReturnPhotoMediaReference('');
                    }}
                    className="self-start text-xs font-bold text-red-600"
                  >
                    ลบและถ่ายใหม่
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
                <span className="text-xs font-bold text-slate-700">ลายเซ็นผู้คืน/ผู้ส่งมอบ *</span>
                <div
                  key={keyToReturn.key_log_id}
                  data-has-signature-preview={Boolean(returnSignaturePreviewUrl)}
                >
                  <SignaturePad
                    onSave={value => {
                      try {
                        setReturnSignatureBlob(dataUrlToImageBlob(value));
                        setReturnSignaturePreviewUrl(value);
                        setReturnSignatureHasStroke(true);
                        setReturnSignatureMediaReference('');
                      } catch (error) {
                        setReturnSignatureBlob(null);
                        setReturnSignaturePreviewUrl('');
                        setReturnSignatureHasStroke(false);
                        setStatusMessage({
                          type: 'error',
                          text: error instanceof Error ? error.message : 'ไฟล์ลายเซ็นผู้คืนกุญแจไม่รองรับ',
                        });
                      }
                    }}
                    onClear={() => {
                      setReturnSignatureBlob(null);
                      setReturnSignaturePreviewUrl('');
                      setReturnSignatureHasStroke(false);
                      setReturnSignatureMediaReference('');
                    }}
                    placeholder="กรุณาลงลายเซ็นผู้คืนกุญแจ"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={handleRequestReturnConfirmation}
                className="w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white disabled:opacity-50"
              >
                ยืนยันรับคืนและปิดรายการ
              </button>
            </div>
          )}

          {loading && (
            <div className="py-10 text-center font-bold text-slate-500 animate-pulse text-sm">
              กำลังดึงข้อมูลกุญแจค้างส่ง...
            </div>
          )}

          {!loading && activeKeys.length === 0 && (
            <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
              <Key className="w-12 h-12 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-bold">ไม่มีกุญแจถูกเบิกค้างส่งในระบบขณะนี้</p>
            </div>
          )}

          {!loading && activeKeys.length > 0 && (
            <div className="flex flex-col gap-3">
              {filteredKeys.map((k) => (
                <div
                  key={k.key_log_id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl gap-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-red-50 text-red-600 rounded-xl shrink-0 mt-1">
                      <Key className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-base font-black text-slate-800">กุญแจห้อง: {k.room_number}</span>
                      <p className="text-xs text-slate-500 font-bold mt-0.5">
                        ผู้เบิก: {k.borrower_name} • เหตุผล: <span className="text-indigo-600">{k.purpose}</span>
                      </p>
                      <p className="text-[11px] text-slate-400 font-medium mt-1">
                        🔑 รปภ.ผู้จ่ายออก: {k.issued_by} • หมายเหตุ: {k.note || '-'}
                      </p>
                      {(k.borrower_photo_url || k.signature_image_url) && <div className="mt-2 flex gap-2">{k.borrower_photo_url && <AuthenticatedEvidenceImage mediaReference={k.borrower_photo_url} alt="หลักฐานผู้ยืมกุญแจ" className="h-16 w-16 rounded object-cover" />}{k.signature_image_url && <AuthenticatedEvidenceImage mediaReference={k.signature_image_url} alt="ลายเซ็นรับกุญแจ" className="h-16 w-16 rounded object-cover" />}</div>}
                    </div>
                  </div>
                  <div className="flex sm:flex-col items-end gap-3 justify-between sm:justify-center border-t sm:border-t-0 border-slate-200 pt-2 sm:pt-0">
                    <div className="text-right">
                      <span className="text-[10px] text-red-600 block font-bold">
                        เบิกเมื่อ: {formatThaiDateTime(k.checkout_time)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleReturnSubmit(k)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      📥 รับกุญแจส่งคืนเข้าตู้
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={showReturnModal}
        title="ยืนยันการรับคืนกุญแจ"
        message={`คุณยืนยันต้องการรับคืนกุญแจห้อง "${keyToReturn?.room_number}" (${keyToReturn?.key_type}) จากคุณ ${keyToReturn?.borrower_name} กลับเข้าสู่ตู้นิรภัยของอาคารโครงการหรือไม่?`}
        confirmText="ยืนยันรับคืนและปิดรายการ"
        cancelText="ยกเลิก"
        onConfirm={handleConfirmReturn}
        onCancel={() => {
          setShowReturnModal(false);
        }}
      />
    </div>
  );
}
