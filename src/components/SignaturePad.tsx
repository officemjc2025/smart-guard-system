/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { RefreshCw } from 'lucide-react';

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  onClear?: () => void;
  placeholder?: string;
}

const WHITE = '#ffffff';
const INK = '#0f172a';

export default function SignaturePad({
  onSave,
  onClear,
  placeholder = 'เซ็นลายมือชื่อของคุณตรงนี้',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const configureContext = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) return null;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 3.5;
    context.strokeStyle = INK;
    return context;
  };

  const fillWhite = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = WHITE;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width === width && canvas.height === height) return;

      const previous = document.createElement('canvas');
      previous.width = canvas.width;
      previous.height = canvas.height;
      if (canvas.width && canvas.height) {
        previous.getContext('2d')?.drawImage(canvas, 0, 0);
      }
      const hadStroke = hasStrokeRef.current;
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      fillWhite(canvas);
      if (hadStroke && previous.width && previous.height) {
        const context = canvas.getContext('2d');
        context?.drawImage(previous, 0, 0, previous.width, previous.height, 0, 0, width, height);
      }
      configureContext(canvas);
    };

    resizeCanvas();
    const observer = typeof ResizeObserver === 'undefined'
      ? null : new ResizeObserver(resizeCanvas);
    observer?.observe(container);
    window.addEventListener('resize', resizeCanvas);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  const coordinates = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = coordinates(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    drawingRef.current = true;
  };

  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = coordinates(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    hasStrokeRef.current = true;
    setIsEmpty(false);
  };

  const exportSignature = (canvas: HTMLCanvasElement) => {
    const exported = document.createElement('canvas');
    exported.width = canvas.width;
    exported.height = canvas.height;
    const context = exported.getContext('2d');
    if (!context) return;
    context.fillStyle = WHITE;
    context.fillRect(0, 0, exported.width, exported.height);
    context.drawImage(canvas, 0, 0);
    onSave(exported.toDataURL('image/jpeg', 0.92));
  };

  const stopDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (hasStrokeRef.current) exportSignature(event.currentTarget);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    fillWhite(canvas);
    configureContext(canvas);
    drawingRef.current = false;
    hasStrokeRef.current = false;
    setIsEmpty(true);
    onClear?.();
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        ref={containerRef}
        className="relative h-44 w-full overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white shadow-inner"
      >
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex select-none items-center justify-center text-sm font-medium text-slate-400">
            {placeholder}
          </div>
        )}
        <canvas
          ref={canvasRef}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          className="block h-full w-full touch-none cursor-crosshair bg-white"
          aria-label={placeholder}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          id="btn-clear-signature"
          onClick={clearCanvas}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          ล้างลายเส้น
        </button>
      </div>
    </div>
  );
}
