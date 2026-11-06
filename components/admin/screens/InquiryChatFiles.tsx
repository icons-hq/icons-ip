'use client';
import { useEffect, useRef, useState } from 'react';
import { loadInquiryFileLibraryAction, removeInquiryFileAction } from '@/app/admin/inquiry-file-actions';
import { INQUIRY_FILE_ACCEPT, INQUIRY_FILE_FORMATS, INQUIRY_FILE_LIBRARY_LIMIT, INQUIRY_MESSAGE_FILE_LIMIT, inquiryFileSize, inquiryFileUrl, type InquiryFile } from '@/lib/inquiry-files';
import { INQUIRY_IMAGE_ACCEPT } from '@/lib/inquiries';
import { uploadInquiryFile } from '@/lib/inquiry-files-upload.client';
import { Download, FolderOpen, ImagePlus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { FIELD_LABEL_CLASS, KIT_INPUT_CLASS } from './cs-kit-classes';

export interface InquiryChatFileEntry { id: string; name: string; file?: InquiryFile; source?: File; error?: string }
export function InquiryChatFiles({ entries, onChange, disabled }: { entries: InquiryChatFileEntry[]; onChange: (entries: InquiryChatFileEntry[]) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false); const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null); const current = useRef(entries);
  useEffect(() => { current.current = entries; }, [entries]);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  function change(next: InquiryChatFileEntry[]) { current.current = next; onChange(next); }
  async function upload(entry: InquiryChatFileEntry) {
    if (!entry.source) return;
    const result = await uploadInquiryFile(entry.source, entry.id, false);
    if (active.current) change(current.current.map(value => value.id === entry.id ? result.ok ? { id: entry.id, name: result.file.name, file: result.file }
      : { ...entry, error: result.error } : value));
  }
  function select(files: File[]) {
    if (entries.length + files.length > INQUIRY_MESSAGE_FILE_LIMIT) { setError('사진·파일은 한 메시지에 최대 3개 첨부할 수 있습니다.'); return; }
    const added = files.map(file => ({ id: crypto.randomUUID(), name: file.name, source: file }));
    change([...current.current, ...added]); setError('');
    // Sequential uploads keep bounded memory while preserving each retry ID.
    void (async () => { for (const entry of added) await upload(entry); })();
  }
  return <>
    <Button disabled={disabled} onClick={() => input.current?.click()} size="xs" type="button" variant="ghost"><ImagePlus aria-hidden="true" />사진 첨부</Button>
    <input ref={input} type="file" aria-label="상담 사진 첨부" accept={INQUIRY_IMAGE_ACCEPT} multiple hidden disabled={disabled}
      onChange={event => { select(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <Button disabled={disabled} onClick={() => setOpen(true)} size="xs" type="button" variant="ghost"><FolderOpen aria-hidden="true" />파일 보관함</Button>
    {open ? <InquiryChatFileLibrary disabled={disabled} onClose={() => setOpen(false)} onSelect={file => {
      if (current.current.some(entry => entry.id === file.id)) return true;
      if (current.current.length >= INQUIRY_MESSAGE_FILE_LIMIT) { setError('사진·파일은 한 메시지에 최대 3개 첨부할 수 있습니다.'); return false; }
      change([...current.current, { id: file.id, name: file.name, file }]); return true;
    }} /> : null}
    {entries.length || error ? <div className="order-last flex max-h-28 basis-full flex-col gap-1 overflow-y-auto text-xs" role="group" aria-label="전송할 첨부 파일">
      {entries.map(entry => <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 px-2 py-1" key={entry.id}><span className="min-w-0 flex-1 wrap-anywhere">{entry.name}{entry.file ? ` · ${inquiryFileSize(entry.file.size)}` : entry.error ? '' : ' · 업로드 확인 중'}</span>
        {entry.error ? <><span className="text-destructive" role="alert">{entry.error}</span><Button disabled={disabled} onClick={() => { change(current.current.map(value => value.id === entry.id ? { ...value, error: undefined } : value)); void upload(entry); }} size="xs" type="button" variant="outline">다시 시도</Button></> : null}
        <Button aria-label={`${entry.name} 첨부 취소`} disabled={disabled} onClick={() => change(current.current.filter(value => value.id !== entry.id))} size="xs" type="button" variant="ghost">취소</Button>
      </div>)}
      {error ? <p className="bg-transparent text-destructive" role="alert">{error}</p> : null}
    </div> : null}
  </>;
}

function InquiryChatFileLibrary({ disabled, onClose, onSelect }: { disabled: boolean; onClose: () => void; onSelect: (file: InquiryFile) => boolean }) {
  const [files, setFiles] = useState<InquiryFile[]>(); const [error, setError] = useState(''); const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false); const [upload, setUpload] = useState<{ id: string; file: File }>();
  const [notice, setNotice] = useState(''); const active = useRef(true);
  async function load() {
    try {
      const result = await loadInquiryFileLibraryAction();
      if (!active.current) return;
      if ('files' in result) { setFiles(result.files); setError(''); } else setError(result.error);
    } catch { if (active.current) setError('파일 보관함을 불러오지 못했습니다. 다시 시도해주세요.'); }
  }
  useEffect(() => {
    active.current = true;
    void loadInquiryFileLibraryAction().then(result => {
      if (!active.current) return;
      if ('files' in result) setFiles(result.files); else setError(result.error);
    }).catch(() => { if (active.current) setError('파일 보관함을 불러오지 못했습니다. 다시 시도해주세요.'); });
    return () => { active.current = false; };
  }, []);
  async function save(value: { id: string; file: File }) {
    setBusy(true); setError(''); setUpload(value);
    try {
      const result = await uploadInquiryFile(value.file, value.id, true);
      if (!active.current) return;
      if (result.ok) { setUpload(undefined); setNotice('파일을 보관함에 저장했습니다. 첨부를 선택하면 현재 메시지에 추가됩니다.'); await load(); }
      else setError(result.error);
    } catch { if (active.current) setError('파일 등록 결과를 확인하지 못했습니다. 같은 파일로 다시 시도해주세요.'); }
    finally { if (active.current) setBusy(false); }
  }
  return <CustomerServiceDialog title="파일 보관함" onClose={onClose} busy={busy} wide>
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">파일당 20MB · 최대 {INQUIRY_FILE_LIBRARY_LIMIT}개. {INQUIRY_FILE_FORMATS}</p>
      <div className="grid gap-4 sm:grid-cols-2"><label className="flex min-w-0 flex-col gap-1.5"><span className={FIELD_LABEL_CLASS}>파일명 검색</span><input className={KIT_INPUT_CLASS} data-slot="input" value={query} onChange={event => setQuery(event.target.value)} type="search" /></label>
        <label className="flex min-w-0 flex-col gap-1.5"><span className={FIELD_LABEL_CLASS}>파일 등록</span><input className={KIT_INPUT_CLASS} data-slot="input" aria-label="보관함 파일 등록" type="file" accept={INQUIRY_FILE_ACCEPT} disabled={busy || disabled || !!upload}
          onChange={event => { const file = event.target.files?.[0]; if (file) void save({ id: crypto.randomUUID(), file }); event.target.value = ''; }} /></label></div>
      {upload ? <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2"><span className="mr-auto min-w-0 wrap-anywhere">{upload.file.name} {busy ? '확인 중' : '등록을 완료하지 못했습니다.'}</span>
        {!busy ? <><Button onClick={() => void save(upload)} size="sm" type="button" variant="outline">같은 파일 다시 시도</Button><Button onClick={() => { setUpload(undefined); setError(''); }} size="sm" type="button" variant="ghost">등록 취소</Button></> : null}</div> : null}
      {error ? <p className="flex flex-wrap items-center gap-2 bg-transparent text-destructive" role="alert">{error} <Button disabled={busy} onClick={() => void load()} size="xs" type="button" variant="outline">목록 다시 불러오기</Button></p> : null}
      {notice ? <p className="text-muted-foreground" role="status">{notice}</p> : null}
      <p className="text-xs text-muted-foreground tabular-nums">{files ? `${files.length}/${INQUIRY_FILE_LIBRARY_LIMIT}개` : error ? '보관함 목록을 확인하지 못했습니다.' : '보관함을 불러오는 중입니다.'}</p>
      <ul className="flex max-h-[45vh] flex-col divide-y overflow-y-auto rounded-lg border px-3">{files?.filter(file => file.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(file => <li className="flex flex-wrap items-center gap-2 py-3" key={file.id}>
        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-0.5 wrap-anywhere"><strong className="font-medium text-foreground">{file.name}</strong><small className="text-xs text-muted-foreground tabular-nums">{inquiryFileSize(file.size)}</small></div>
        <a className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" href={inquiryFileUrl(file.id)} download><Download aria-hidden="true" />다운로드</a>
        <Button disabled={busy || disabled} onClick={() => { if (onSelect(file)) onClose(); }} size="sm" type="button">첨부</Button>
        <Button aria-label={`${file.name} 보관함에서 삭제`} disabled={busy || disabled} size="sm" type="button" variant="destructive" onClick={async () => {
          setBusy(true);
          try {
            const result = await removeInquiryFileAction(file.id);
            if (!active.current) return;
            if (result.ok) { setNotice('보관함에서 삭제했습니다. 이미 보낸 메시지의 파일은 유지됩니다.'); await load(); } else setError(result.error ?? '삭제하지 못했습니다.');
          } catch { if (active.current) setError('파일 삭제 결과를 확인하지 못했습니다. 목록을 다시 불러와주세요.'); }
          finally { if (active.current) setBusy(false); }
        }}>삭제</Button>
      </li>)}</ul>
      {files?.length === 0 ? <p className="py-4 text-center text-muted-foreground">등록한 파일이 없습니다.</p> : null}
    </div>
  </CustomerServiceDialog>;
}
