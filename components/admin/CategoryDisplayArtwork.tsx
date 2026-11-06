/* eslint-disable @next/next/no-img-element -- Existing verified artwork paths are previewed without image optimization. */
'use client';
import { useEffect, useRef, useState } from 'react';
import { uploadAdminArtwork } from '@/lib/admin/artwork-upload.client';
import { publicMediaUrl } from '@/lib/media';
import { COMMON_ARTWORK_GUIDANCE } from './ArtworkUploadField';
import { Button } from '@/components/admin/kit/ui/button';

/* 이미지 한 칸(템플릿 룩, ADR-0028). banner는 상단 배너 미리보기(폭 맞춤), icon은 카테고리 시트의 60px 아이콘 칸 모양이다. */
const PREVIEW = {
  banner: 'block max-h-[180px] w-full rounded-md border object-contain',
  icon: 'block size-[60px] rounded-[10px] bg-muted object-contain p-1.5',
} as const;

export function CategoryDisplayArtwork({ label, actorId, path, disabled, onChange, onBusy, variant = 'banner' }: {
  label: string; actorId: string; path: string | null; disabled: boolean; onChange: (path: string | null) => void; onBusy: (busy: boolean) => void;
  variant?: keyof typeof PREVIEW;
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
  return <div className="grid min-w-0 gap-2" data-category-display-artwork={variant}><label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">{label}<input className="block w-full min-w-0 text-sm font-normal text-muted-foreground file:mr-3 file:h-8 file:rounded-lg file:border file:border-input file:bg-background file:px-2.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted disabled:cursor-not-allowed disabled:opacity-50" data-slot="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} /></label>
    <small className="text-xs text-muted-foreground">{COMMON_ARTWORK_GUIDANCE}</small>{busy ? <p className="text-xs text-muted-foreground" role="status">이미지 확인 중…</p> : null}
    {path ? <>{/* The path is produced by the existing verified artwork uploader. */}
      <img className={PREVIEW[variant]} src={publicMediaUrl(path) ?? ''} alt={`${label} 미리보기`} /><Button className="justify-self-start" type="button" disabled={disabled || busy} onClick={() => onChange(null)} size="sm" variant="outline">이미지 해제</Button></> : null}
    {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
  </div>;
}
