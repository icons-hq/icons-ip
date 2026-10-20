'use client';
import { useEffect, useRef, useState } from 'react';
import { loadInquiryFileLibraryAction, removeInquiryFileAction } from '@/app/admin/inquiry-file-actions';
import { INQUIRY_FILE_ACCEPT, INQUIRY_FILE_FORMATS, INQUIRY_FILE_LIBRARY_LIMIT, INQUIRY_MESSAGE_FILE_LIMIT, inquiryFileSize, inquiryFileUrl, type InquiryFile } from '@/lib/inquiry-files';
import { INQUIRY_IMAGE_ACCEPT } from '@/lib/inquiries';
import { uploadInquiryFile } from '@/lib/inquiry-files-upload.client';
import { CustomerServiceDialog } from './CustomerServiceDialog';

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
    <button type="button" disabled={disabled} onClick={() => input.current?.click()}>사진 첨부</button>
    <input ref={input} type="file" aria-label="상담 사진 첨부" accept={INQUIRY_IMAGE_ACCEPT} multiple hidden disabled={disabled}
      onChange={event => { select(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <button type="button" disabled={disabled} onClick={() => setOpen(true)}>파일 보관함</button>
    {open ? <InquiryChatFileLibrary disabled={disabled} onClose={() => setOpen(false)} onSelect={file => {
      if (current.current.some(entry => entry.id === file.id)) return true;
      if (current.current.length >= INQUIRY_MESSAGE_FILE_LIMIT) { setError('사진·파일은 한 메시지에 최대 3개 첨부할 수 있습니다.'); return false; }
      change([...current.current, { id: file.id, name: file.name, file }]); return true;
    }} /> : null}
    {entries.length || error ? <div className="admin-inquiry-chat__selected-files" role="group" aria-label="전송할 첨부 파일">
      {entries.map(entry => <div key={entry.id}><span>{entry.name}{entry.file ? ` · ${inquiryFileSize(entry.file.size)}` : entry.error ? '' : ' · 업로드 확인 중'}</span>
        {entry.error ? <><span role="alert">{entry.error}</span><button type="button" disabled={disabled} onClick={() => { change(current.current.map(value => value.id === entry.id ? { ...value, error: undefined } : value)); void upload(entry); }}>다시 시도</button></> : null}
        <button type="button" aria-label={`${entry.name} 첨부 취소`} disabled={disabled} onClick={() => change(current.current.filter(value => value.id !== entry.id))}>취소</button>
      </div>)}
      {error ? <p role="alert">{error}</p> : null}
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
    <div className="admin-inquiry-chat__file-library">
      <p>파일당 20MB · 최대 {INQUIRY_FILE_LIBRARY_LIMIT}개. {INQUIRY_FILE_FORMATS}</p>
      <div className="admin-inquiry-chat__file-tools"><label>파일명 검색<input value={query} onChange={event => setQuery(event.target.value)} type="search" /></label>
        <label>파일 등록<input aria-label="보관함 파일 등록" type="file" accept={INQUIRY_FILE_ACCEPT} disabled={busy || disabled || !!upload}
          onChange={event => { const file = event.target.files?.[0]; if (file) void save({ id: crypto.randomUUID(), file }); event.target.value = ''; }} /></label></div>
      {upload ? <div><span>{upload.file.name} {busy ? '확인 중' : '등록을 완료하지 못했습니다.'}</span>
        {!busy ? <><button type="button" onClick={() => void save(upload)}>같은 파일 다시 시도</button><button type="button" onClick={() => { setUpload(undefined); setError(''); }}>등록 취소</button></> : null}</div> : null}
      {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>목록 다시 불러오기</button></p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <p>{files ? `${files.length}/${INQUIRY_FILE_LIBRARY_LIMIT}개` : error ? '보관함 목록을 확인하지 못했습니다.' : '보관함을 불러오는 중입니다.'}</p>
      <ul>{files?.filter(file => file.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(file => <li key={file.id}>
        <div><strong>{file.name}</strong><small>{inquiryFileSize(file.size)}</small></div>
        <a href={inquiryFileUrl(file.id)} download>다운로드</a>
        <button type="button" disabled={busy || disabled} onClick={() => { if (onSelect(file)) onClose(); }}>첨부</button>
        <button type="button" aria-label={`${file.name} 보관함에서 삭제`} disabled={busy || disabled} onClick={async () => {
          setBusy(true);
          try {
            const result = await removeInquiryFileAction(file.id);
            if (!active.current) return;
            if (result.ok) { setNotice('보관함에서 삭제했습니다. 이미 보낸 메시지의 파일은 유지됩니다.'); await load(); } else setError(result.error ?? '삭제하지 못했습니다.');
          } catch { if (active.current) setError('파일 삭제 결과를 확인하지 못했습니다. 목록을 다시 불러와주세요.'); }
          finally { if (active.current) setBusy(false); }
        }}>삭제</button>
      </li>)}</ul>
      {files?.length === 0 ? <p>등록한 파일이 없습니다.</p> : null}
    </div>
  </CustomerServiceDialog>;
}
