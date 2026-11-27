'use client';

import { FileImage, FileUp, LockKeyhole, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { OVERSEAS_METHOD, OVERSEAS_UPLOAD_LIMIT } from '@/lib/identity/overseas-adult';
import type { DocumentCopy } from './overseas-document-copy';

const supported = ['image/jpeg', 'image/png', 'image/webp'];
type Issue = 'missingFile' | 'invalidFile' | 'numberNeeded' | 'tooLarge' | 'invalidForm' | 'limit' | 'failed';
type SelectedPhoto = { blob: Blob; filename: string; preview: string };

export function OverseasPhotoForm({ copy: t, onRefresh, statusButton, feedback, checking }: {
  copy: DocumentCopy;
  onRefresh: () => void;
  statusButton: ReactNode;
  feedback: ReactNode;
  checking: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const consentBox = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const attempt = useRef<{ key: string; numbers: boolean } | null>(null);
  const sending = useRef(false);
  const [photo, setPhoto] = useState<SelectedPhoto | null>(null);
  const [numberConsent, setNumberConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [issue, setIssue] = useState<Issue | null>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);
  useEffect(() => () => { generation.current++; }, []);

  function clearPhoto() {
    generation.current++;
    setPhoto(null);
    setIssue(null);
    setNumberConsent(false);
    setLoading(false);
    attempt.current = null;
  }
  async function choose(files: FileList | null) {
    if (sending.current || !files?.length) return;
    const file = files[0];
    clearPhoto();
    if (files.length !== 1 || file.size > 16_000_000 || !supported.includes(file.type)) {
      setIssue('invalidFile');
      return;
    }
    const current = generation.current;
    const source = URL.createObjectURL(file);
    setLoading(true);
    try {
      const img = new Image();
      img.src = source;
      await img.decode();
      if (current !== generation.current) return;
      if (Math.min(img.naturalWidth, img.naturalHeight) < 320) throw new Error();
      const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      canvas.width = canvas.height = 1;
      if (current !== generation.current) return;
      if (!blob || blob.size > OVERSEAS_UPLOAD_LIMIT) { setIssue('tooLarge'); return; }
      setPhoto({ blob, filename: file.name, preview: URL.createObjectURL(blob) });
    } catch {
      if (current === generation.current) setIssue('invalidFile');
    } finally {
      URL.revokeObjectURL(source);
      if (current === generation.current) setLoading(false);
    }
  }

  async function send(numbers: boolean) {
    if (sending.current || loading || checking) return;
    if (!photo) { setIssue('missingFile'); input.current?.focus(); return; }
    if (numbers && !numberConsent) { setIssue('numberNeeded'); consentBox.current?.focus(); return; }
    sending.current = true;
    setBusy(true);
    setIssue(null);
    let accepted = false;
    try {
      if (!attempt.current || attempt.current.numbers !== numbers) attempt.current = { key: crypto.randomUUID(), numbers };
      const response = await fetch('/api/identity/overseas/upload', {
        method: 'POST', cache: 'no-store', body: photo.blob,
        headers: { 'X-Photo-Consent': OVERSEAS_METHOD, 'X-Submission-Id': attempt.current.key,
          'X-Document-Number-Consent': numbers ? 'allow' : 'not-present' },
      });
      if (!response.ok) {
        setIssue(response.status === 429 ? 'limit' : response.status === 422 ? 'invalidForm' : 'failed');
        if (response.status === 409 || response.status === 403) onRefresh();
        return;
      }
      accepted = true;
      setSent(true);
      clearPhoto();
      onRefresh();
    } catch { setIssue('failed'); }
    finally { if (!accepted) { sending.current = false; setBusy(false); } }
  }
  if (sent) return (
    <div className="wc-overseas__status">
      <h2 role="status">{t.received}</h2><p>{t.awaitingResult}</p>
      {statusButton}
      {feedback}
    </div>
  );
  return (
    <form className="wc-overseas__form" data-private onSubmit={event => { event.preventDefault(); void send(true); }}>
      <fieldset disabled={busy}>
        <legend>{t.attachment}</legend>
        <label className={photo ? 'wc-overseas__replace' : 'wc-overseas__drop'} data-dragging={dragging}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); void choose(event.dataTransfer.files); }}>
          <input className="wc-sr-only" type="file" ref={input} accept={supported.join(',')} aria-label={photo ? t.change : t.choose}
            onChange={event => { void choose(event.currentTarget.files); event.currentTarget.value = ''; }} />
          {photo ? <><FileImage size={15} aria-hidden="true" />{t.change}</> : <>
            <FileUp size={27} strokeWidth={1.5} aria-hidden="true" />
            <strong>{loading ? t.loading : <><span className="wc-overseas__drop-desktop">{t.drop}</span><span className="wc-overseas__drop-mobile">{t.mobileDrop}</span></>}</strong>
            <span>{t.formats}</span><span className="wc-overseas__file-button">{t.choose}</span>
          </>}
        </label>
        {photo && <div className="wc-overseas__preview">
          <div className="wc-overseas__file-line"><strong>{photo.filename}</strong>
            <button type="button" aria-label={t.remove} onClick={() => { clearPhoto(); input.current?.focus(); }}><X size={17} aria-hidden="true" /></button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- The private preview exists only in this browser. */}
          <img src={photo.preview} alt={t.preview} />
        </div>}
      </fieldset>
      <div className="wc-overseas__consent">
        <p>{t.consent}</p>
        <label><input ref={consentBox} type="checkbox" checked={numberConsent} disabled={busy}
          onChange={e => { setNumberConsent(e.target.checked); setIssue(null); }} /><span>{t.numberConsent}</span></label>
        <details>
          <summary>{t.details}</summary>
          <p>{t.retention} <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">{t.privacy}</Link></p>
          <button type="button" className="wc-overseas__text-button" onClick={() => void send(false)} disabled={busy || loading || checking}>{t.numberless}</button>
        </details>
      </div>
      {issue && <p className="wc-overseas__error" role="alert">{t[issue]}</p>}
      {issue === 'failed' && statusButton}
      {feedback}
      <button className="wc-btn primary wc-overseas__submit" type="submit" value="photo" disabled={busy || loading || checking}>
        <LockKeyhole size={16} aria-hidden="true" />{busy ? t.sending : t.submit}
      </button>
    </form>
  );
}
