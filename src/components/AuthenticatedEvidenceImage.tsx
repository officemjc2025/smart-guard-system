import { useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { loadPrivateMediaPreview } from '../services/privateMediaService';

interface AuthenticatedEvidenceImageProps {
  mediaReference: string;
  alt: string;
  className?: string;
  thumbnailClassName?: string;
  title?: string;
  disabled?: boolean;
}

export default function AuthenticatedEvidenceImage({
  mediaReference,
  alt,
  className,
  thumbnailClassName,
  title,
  disabled = false,
}: AuthenticatedEvidenceImageProps) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!mediaReference || mediaReference.startsWith('data:') || mediaReference.startsWith('blob:')) {
      setPreviewUrl(mediaReference);
      setError('');
      return;
    }
    let active = true;
    let revoke: (() => void) | undefined;
    setLoading(true);
    setError('');
    setPreviewUrl('');
    void loadPrivateMediaPreview(mediaReference)
      .then(preview => {
        if (!active) {
          preview.revoke();
          return;
        }
        revoke = preview.revoke;
        setPreviewUrl(preview.objectUrl);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'ไม่สามารถโหลดรูปหลักฐานได้');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      revoke?.();
    };
  }, [attempt, mediaReference]);

  useEffect(() => {
    if (!viewerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setViewerOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = closeRef.current?.closest('[role="dialog"]');
      const focusable = Array.from(dialog?.querySelectorAll(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? []) as HTMLElement[];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      openerRef.current?.focus();
    };
  }, [viewerOpen]);

  if (loading) return <div className={`${className || ''} flex items-center justify-center rounded bg-slate-100 p-2 text-center text-xs font-bold text-slate-500`}>กำลังโหลดรูปหลักฐาน…</div>;
  if (error || !previewUrl) return <div className={`${className || ''} flex flex-col items-center justify-center gap-2 rounded bg-red-50 p-2 text-center text-xs font-bold text-red-700`}>
    <span>ไม่สามารถโหลดรูปหลักฐานได้</span>
    <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded bg-white px-2 py-1 text-indigo-700">ลองโหลดอีกครั้ง</button>
  </div>;
  return <>
    <button
      ref={openerRef}
      type="button"
      disabled={disabled}
      aria-label={`เปิดดู${title || alt}ขนาดใหญ่`}
      onClick={() => {
        setZoom(1);
        setViewerOpen(true);
      }}
      className={`${className || ''} ${thumbnailClassName || ''} group relative cursor-zoom-in overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default`}
    >
      <img
        src={previewUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`${className || ''} bg-white transition group-hover:brightness-95`}
      />
      {!disabled && <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">ขยาย</span>}
    </button>

    {viewerOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={event => {
          if (event.target === event.currentTarget) setViewerOpen(false);
        }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-3 [padding-top:max(0.75rem,env(safe-area-inset-top))] [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex h-full max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 px-3 sm:px-4">
            <h2 id={titleId} className="truncate text-sm font-black text-slate-900">{title || alt}</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="ย่อรูป"
                disabled={zoom <= 1}
                onClick={() => setZoom(value => Math.max(1, value - 0.5))}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 disabled:opacity-30"
              >
                <Minus className="h-5 w-5" />
              </button>
              <span className="min-w-12 text-center text-xs font-bold text-slate-600">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                aria-label="ขยายรูป"
                disabled={zoom >= 3}
                onClick={() => setZoom(value => Math.min(3, value + 0.5))}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 disabled:opacity-30"
              >
                <Plus className="h-5 w-5" />
              </button>
              <button
                ref={closeRef}
                type="button"
                aria-label="ปิดรูปหลักฐาน"
                onClick={() => setViewerOpen(false)}
                className="ml-1 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white hover:bg-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto overscroll-contain bg-white">
            <div className="flex min-h-full min-w-full items-center justify-center p-3">
              <img
                src={previewUrl}
                alt={alt}
                draggable={false}
                onDoubleClick={() => setZoom(value => value === 1 ? 2 : 1)}
                style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none' }}
                className="h-auto max-h-full select-none object-contain bg-white"
              />
            </div>
          </div>
        </div>
      </div>
    )}
  </>;
}
