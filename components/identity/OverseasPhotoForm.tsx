'use client';

import { FileImage, FileUp, LockKeyhole, Undo2, X } from 'lucide-react';
import { useRef, useState, type FormEvent, type PointerEvent } from 'react';
import Link from 'next/link';
import { documentIdentity, OVERSEAS_METHOD, OVERSEAS_UPLOAD_LIMIT } from '@/lib/identity/overseas-adult';
import type { DocumentCopy } from './overseas-document-copy';

const supported = ['image/jpeg', 'image/png', 'image/webp'];
type Issue = 'invalidName' | 'invalidFile' | 'tooLarge' | 'invalidForm' | 'limit' | 'failed';

export function OverseasPhotoForm({ copy: t, birthDate, onRefresh }: { copy: DocumentCopy; birthDate: string; onRefresh: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const undo = useRef<ImageData | null>(null);
  const generation = useRef(0);
  const submission = useRef('');
  const sending = useRef(false);
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [filename, setFilename] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [issue, setIssue] = useState<Issue | null>(null);

  function edited() {
    submission.current = '';
    setConsent(false);
    setIssue(null);
  }
  function clearFile() {
    generation.current++;
    if (canvas.current) { canvas.current.width = 1; canvas.current.height = 1; }
    undo.current = null;
    start.current = null;
    setCanUndo(false);
    setLoading(false);
    setFilename('');
    edited();
  }
  async function choose(files: FileList | null) {
    if (sending.current || !files?.length) return;
    const file = files[0];
    clearFile();
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
      if (generation.current !== current || !canvas.current) return;
      const { naturalWidth: w, naturalHeight: h } = img;
      if (Math.min(w, h) < 320) throw new Error();
      const scale = Math.min(1, 2200 / Math.max(w, h));
      const el = canvas.current;
      el.width = Math.round(w * scale);
      el.height = Math.round(h * scale);
      const ctx = el.getContext('2d');
      if (!ctx) throw new Error();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, el.width, el.height);
      ctx.drawImage(img, 0, 0, el.width, el.height);
      setFilename(file.name);
    } catch {
      if (generation.current === current) setIssue('invalidFile');
    } finally {
      URL.revokeObjectURL(source);
      if (generation.current === current) setLoading(false);
    }
  }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const el = event.currentTarget, rect = el.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * el.width / rect.width, y: (event.clientY - rect.top) * el.height / rect.height };
  }
  function cover(event: PointerEvent<HTMLCanvasElement>) {
    const first = start.current;
    start.current = null;
    const el = event.currentTarget, ctx = el.getContext('2d');
    if (!first || !ctx || sending.current) return;
    const last = point(event);
    if (Math.abs(last.x - first.x) < 2 || Math.abs(last.y - first.y) < 2) return;
    undo.current = ctx.getImageData(0, 0, el.width, el.height);
    ctx.fillStyle = '#000';
    ctx.fillRect(first.x, first.y, last.x - first.x, last.y - first.y);
    setCanUndo(true);
    edited();
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || loading || !consent) return;
    const identity = documentIdentity(name, gender);
    if (!identity) { setIssue('invalidName'); nameField.current?.focus(); return; }
    const el = canvas.current;
    if (!filename || !el) { setIssue('invalidFile'); input.current?.focus(); return; }
    sending.current = true;
    setBusy(true);
    setIssue(null);
    let accepted = false;
    try {
      const photo = await new Promise<Blob | null>(resolve => el.toBlob(resolve, 'image/jpeg', 0.85));
      if (!photo || photo.size > OVERSEAS_UPLOAD_LIMIT) { setIssue('tooLarge'); return; }
      submission.current ||= crypto.randomUUID();
      const form = new FormData();
      form.set('name', identity.name);
      form.set('gender', identity.gender);
      form.set('photo', photo, 'document.jpg');
      const response = await fetch('/api/identity/overseas/upload', { method: 'POST', cache: 'no-store',
        headers: { 'X-Photo-Consent': OVERSEAS_METHOD, 'X-Submission-Id': submission.current }, body: form });
      if (!response.ok) {
        setIssue(response.status === 429 ? 'limit' : response.status === 422 ? 'invalidForm' : 'failed');
        if (response.status === 409 || response.status === 403) onRefresh();
        return;
      }
      accepted = true;
      setSent(true);
      clearFile();
      setName('');
      setGender('');
      onRefresh();
    } catch { setIssue('failed'); }
    finally {
      if (!accepted) { sending.current = false; setBusy(false); }
    }
  }

  if (sent) return (
    <div className="wc-overseas__status" role="status">
      <h2>{t.received}</h2><p>{t.pending}</p>
      <button className="wc-btn" type="button" onClick={onRefresh}>{t.reload}</button>
    </div>
  );
  return (
    <form className="wc-overseas__form" data-private onSubmit={send}>
      <fieldset disabled={busy}>
        <legend>{t.attachment}</legend>
        <label className={filename ? 'wc-overseas__replace' : 'wc-overseas__drop'} data-dragging={dragging}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); void choose(event.dataTransfer.files); }}>
          <input className="wc-sr-only" type="file" ref={input} accept={supported.join(',')}
            aria-label={filename ? t.change : t.choose}
            onChange={event => { void choose(event.currentTarget.files); event.currentTarget.value = ''; }} />
          {filename ? <><FileImage size={15} aria-hidden="true" />{t.change}</> : <>
            <FileUp size={27} strokeWidth={1.5} aria-hidden="true" />
            <strong>{loading ? t.loading : <><span className="wc-overseas__drop-desktop">{t.drop}</span><span className="wc-overseas__drop-mobile">{t.mobileDrop}</span></>}</strong>
            <span>{t.formats}</span><span className="wc-overseas__file-button">{t.choose}</span>
          </>}
        </label>
        <div hidden={!filename} className="wc-overseas__preview">
          <div className="wc-overseas__file-line"><strong>{filename}</strong>
            <button type="button" aria-label={t.remove} onClick={() => { clearFile(); input.current?.focus(); }}><X size={17} aria-hidden="true" /></button>
          </div>
          <canvas ref={canvas} aria-label={t.preview}
            onPointerDown={e => { if (!busy) { start.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); } }}
            onPointerUp={cover} onPointerCancel={() => { start.current = null; }} />
          <p>{t.redact}</p>
          {canUndo && <button type="button" className="wc-overseas__text-button" onClick={() => {
            if (undo.current) canvas.current?.getContext('2d')?.putImageData(undo.current, 0, 0);
            undo.current = null; setCanUndo(false); edited();
          }}><Undo2 size={15} aria-hidden="true" />{t.undo}</button>}
        </div>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>{t.identity}</legend>
        <div className="wc-overseas__inputs">
          <label>{t.name}<input ref={nameField} type="text" autoComplete="off" autoCapitalize="words" maxLength={100} required value={name}
            onChange={e => { setName(e.target.value); edited(); }} /></label>
          <label>{t.gender}<select aria-label={t.gender} required value={gender} onChange={e => { setGender(e.target.value); edited(); }}>
            <option value="">{t.chooseGender}</option><option value="M">M</option><option value="F">F</option><option value="X">{t.otherGender}</option>
          </select></label>
        </div>
        <p className="wc-overseas__birth"><span>{t.birth}</span> <strong>{birthDate}</strong><small>{t.birthHint}</small></p>
      </fieldset>
      <div className="wc-overseas__consent">
        <label><input type="checkbox" checked={consent} required disabled={busy} onChange={e => setConsent(e.target.checked)} /><span>{t.consent}</span></label>
        <details><summary>{t.details}</summary><p>{t.retention} <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">{t.privacy}</Link></p></details>
      </div>
      {issue && <p className="wc-overseas__error" role="alert">{t[issue]} {issue === 'failed' && <button type="button" onClick={onRefresh}>{t.reload}</button>}</p>}
      <button className="wc-btn primary wc-overseas__submit" type="submit" disabled={busy || loading}><LockKeyhole size={16} aria-hidden="true" />{busy ? t.sending : t.submit}</button>
    </form>
  );
}
