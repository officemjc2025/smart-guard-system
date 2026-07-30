import { useEffect, useState } from 'react';
import { loadPrivateMediaPreview } from '../services/privateMediaService';

interface AuthenticatedEvidenceImageProps {
  mediaReference: string;
  alt: string;
  className?: string;
}

export default function AuthenticatedEvidenceImage({
  mediaReference,
  alt,
  className,
}: AuthenticatedEvidenceImageProps) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

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

  if (loading) return <div className={`${className || ''} flex items-center justify-center rounded bg-slate-100 p-2 text-center text-xs font-bold text-slate-500`}>กำลังโหลดรูปหลักฐาน…</div>;
  if (error || !previewUrl) return <div className={`${className || ''} flex flex-col items-center justify-center gap-2 rounded bg-red-50 p-2 text-center text-xs font-bold text-red-700`}>
    <span>ไม่สามารถโหลดรูปหลักฐานได้</span>
    <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded bg-white px-2 py-1 text-indigo-700">ลองโหลดอีกครั้ง</button>
  </div>;
  return <img src={previewUrl} alt={alt} className={className} />;
}

