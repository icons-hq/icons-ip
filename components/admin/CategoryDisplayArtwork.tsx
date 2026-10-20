/* eslint-disable @next/next/no-img-element -- Existing verified artwork paths are previewed without image optimization. */
'use client';
import { useEffect, useRef, useState } from 'react';
import { uploadAdminArtwork } from '@/lib/admin/artwork-upload.client';
import { publicMediaUrl } from '@/lib/media';
import { COMMON_ARTWORK_GUIDANCE } from './ArtworkUploadField';

export function CategoryDisplayArtwork({ label, actorId, path, disabled, onChange, onBusy }: {
  label: string; actorId: string; path: string | null; disabled: boolean; onChange: (path: string | null) => void; onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), ticket = useRef(0);
  useEffect(() => () => { ticket.current += 1; }, []);
  async function upload(file: File | undefined) {
    if (!file || disabled || busy) return;
    const current = ++ticket.current; setBusy(true); onBusy(true); setError('');
    const result = await uploadAdminArtwork({ kind: 'curation', file, expectedActorId: actorId });
    if (current !== ticket.current) return;
    setBusy(false); onBusy(false);
    if (!result.ok) setError(result.error); else onChange(result.imagePath);
  }
  return <div className="admin-category-display__artwork"><label>{label}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} /></label>
    <small>{COMMON_ARTWORK_GUIDANCE}</small>{busy ? <p role="status">이미지 확인 중…</p> : null}
    {path ? <>{/* The path is produced by the existing verified artwork uploader. */}
      <img src={publicMediaUrl(path) ?? ''} alt={`${label} 미리보기`} /><button type="button" disabled={disabled || busy} onClick={() => onChange(null)}>이미지 해제</button></> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
