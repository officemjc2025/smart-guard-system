/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, AlertCircle, Keyboard, X } from 'lucide-react';

interface QRScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onClose?: () => void;
  title?: string;
  placeholderText?: string;
}

export default function QRScanner({ onScanSuccess, onClose, title = 'สแกน QR Code', placeholderText = 'พิมพ์รหัสจอดรถ/จุดตรวจรหัสที่นี่...' }: QRScannerProps) {
  const [hasCamera, setHasCamera] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const scanAcceptedRef = useRef(false);
  const scannerId = 'qr-reader-element';

  useEffect(() => {
    // Check camera availability
    Html5Qrcode.getCameras()
      .then(cameras => {
        if (!cameras || cameras.length === 0) {
          setHasCamera(false);
        }
      })
      .catch(() => {
        setHasCamera(false);
      });

    return () => {
      // Cleanup on unmount
      if (qrScannerRef.current && qrScannerRef.current.isScanning) {
        qrScannerRef.current.stop().catch(err => console.error('Failed to stop scanner:', err));
      }
    };
  }, []);

  const startScanner = async () => {
    setScanError(null);
    scanAcceptedRef.current = false;
    setIsScanning(true);
    setShowManual(false);

    try {
      const scanner = new Html5Qrcode(scannerId);
      qrScannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (width, height) => {
            const size = Math.min(width, height) * 0.7;
            return { width: size, height: size };
          }
        },
        (decodedText) => {
          if (scanAcceptedRef.current) return;
          scanAcceptedRef.current = true;
          void stopScanner();
          onScanSuccess(decodedText);
        },
        () => {
          // Silent failure for framing error
        }
      );
    } catch (err: any) {
      console.error('Camera scanning failed to start:', err);
      setScanError('ไม่สามารถเข้าถึงกล้องถ่ายภาพได้ กรุณาใช้รหัสพิมพ์แมนนวลทดแทน');
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    if (qrScannerRef.current && qrScannerRef.current.isScanning) {
      try {
        await qrScannerRef.current.stop();
      } catch (err) {
        console.error('Error stopping scanner:', err);
      }
    }
    setIsScanning(false);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim() && !scanAcceptedRef.current) {
      scanAcceptedRef.current = true;
      onScanSuccess(manualInput.trim());
      if (onClose) onClose();
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col items-center gap-4 w-full max-w-md mx-auto">
      <div className="flex justify-between items-center w-full">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Camera className="w-5 h-5 text-indigo-600" />
          {title}
        </h3>
        {onClose && (
          <button 
            type="button" 
            id="btn-close-scanner"
            onClick={() => {
              stopScanner();
              onClose();
            }}
            className="p-1 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-700 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {scanError && (
        <div className="flex items-start gap-2 bg-red-50 text-red-700 p-3 rounded-xl text-xs w-full">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{scanError}</span>
        </div>
      )}

      {/* Scanner Window */}
      <div className={`relative w-full aspect-square max-w-[280px] rounded-xl overflow-hidden bg-black border-2 border-slate-300 ${isScanning ? 'block' : 'hidden'}`}>
        <div id={scannerId} className="w-full h-full" />
        <div className="absolute inset-0 border-2 border-indigo-500 animate-pulse pointer-events-none rounded-xl m-10" />
      </div>

      {!isScanning && !showManual && (
        <div className="flex flex-col gap-3 w-full max-w-[280px]">
          {hasCamera && (
            <button
              type="button"
              id="btn-start-camera-scan"
              onClick={startScanner}
              className="flex items-center justify-center gap-2 w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-sm hover:shadow active:scale-95 cursor-pointer text-sm"
            >
              <Camera className="w-5 h-5" />
              เปิดกล้องสแกน QR Code
            </button>
          )}

          <button
            type="button"
            id="btn-manual-input-fallback"
            onClick={() => {
              stopScanner();
              setShowManual(true);
            }}
            className="flex items-center justify-center gap-2 w-full py-3 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl font-bold transition-all active:scale-95 cursor-pointer text-sm"
          >
            <Keyboard className="w-5 h-5" />
            ป้อนรหัสด้วยตัวเอง (แมนนวล)
          </button>
        </div>
      )}

      {isScanning && (
        <button
          type="button"
          id="btn-stop-scanning"
          onClick={stopScanner}
          className="py-2.5 px-6 bg-slate-800 hover:bg-slate-950 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
        >
          ยกเลิกและปิดกล้อง
        </button>
      )}

      {showManual && (
        <form onSubmit={handleManualSubmit} className="w-full flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-600">รหัสแมนนวล (QR Value)</label>
            <input
              type="text"
              id="input-qr-manual-value"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder={placeholderText}
              className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              id="btn-cancel-manual"
              onClick={() => setShowManual(false)}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-xl transition-colors cursor-pointer"
            >
              ย้อนกลับ
            </button>
            <button
              type="submit"
              id="btn-submit-manual-qr"
              disabled={!manualInput.trim()}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
            >
              ตกลง
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
