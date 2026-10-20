'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { adminListExportFileNameFromDisposition } from '@/lib/admin/list-export';
import { EXPORT_PASSWORD_HINT, exportPasswordError } from '@/lib/admin/export-password';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';

const SESSION_MESSAGE = '로그인이 만료되었거나 권한이 없습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
const FALLBACK_MESSAGE = '파일을 만들지 못했습니다. 잠시 후 다시 내려받아 주세요.';
/** Optional UI lifetime only; the server still authenticates every request. */
export interface EncryptedWorkbookRequestScope { capture(): (() => boolean) | null }
export async function adminListExportResponseError(response: Response) {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      const message = (body as { error: string }).error.trim();
      if (message) return message;
    }
  } catch { /* A sign-in redirect can return HTML. */ }
  if (response.redirected || [401, 403, 404].includes(response.status)) return SESSION_MESSAGE;
  return FALLBACK_MESSAGE;
}

/** The password exists only in uncontrolled inputs and the current POST body. */
export function EncryptedWorkbookDownloadButton({ href, label, disabled = false, describedBy, snapshot = false, requestScope }: {
  href: string; label: string; disabled?: boolean; describedBy?: string; snapshot?: boolean; requestScope?: EncryptedWorkbookRequestScope;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const hintId = useId();
  const alive = useRef(true), busy = useRef(false), generation = useRef(0), activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; activeRequest.current?.abort(); };
  }, []);
  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || requestScope && busy.current) return;
    const form = event.currentTarget;
    const input = new FormData(form);
    const password = input.get('password');
    const passwordConfirmation = input.get('passwordConfirmation');
    // Clear before awaiting any work, including validation failure or network failure.
    form.reset();
    input.delete('password'); input.delete('passwordConfirmation');
    const invalid = exportPasswordError(password, passwordConfirmation);
    if (invalid) { setError(invalid); return; }
    const scopeValid = requestScope?.capture();
    if (requestScope && !scopeValid) return;
    const currentGeneration = ++generation.current, controller = requestScope ? new AbortController() : null;
    const current = () => !requestScope || alive.current && generation.current === currentGeneration && Boolean(scopeValid?.());
    busy.current = true; activeRequest.current = controller;
    setPending(true); setError(''); setMessage('');
    try {
      const response = await fetch(href, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, passwordConfirmation }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!current()) return;
      if (!response.ok || response.redirected || response.headers.get('x-icons-export-encryption') !== 'ECMA-376-Agile'
        || !(response.headers.get('content-type') ?? '').includes('spreadsheetml.sheet')) {
        const message = await adminListExportResponseError(response);
        if (current()) setError(message);
        return;
      }
      const blob = await response.blob();
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = adminListExportFileNameFromDisposition(response.headers.get('content-disposition'), 'icons-encrypted.xlsx');
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const count = response.headers.get('x-icons-export-rows');
      const rows = count === null ? null : Number(count);
      setMessage(rows !== null && Number.isSafeInteger(rows) && rows >= 0
        ? `암호화 엑셀 ${rows.toLocaleString('ko-KR')}행을 내려받았습니다.` : '암호화 엑셀 파일을 내려받았습니다.');
      setOpen(false);
    } catch { if (current()) setError('연결이 끊겨 파일을 받지 못했습니다. 비밀번호를 다시 입력해 내려받아 주세요.'); }
    finally {
      busy.current = false;
      if (activeRequest.current === controller) activeRequest.current = null;
      if (current()) setPending(false);
    }
  }
  return <>
    <button aria-describedby={describedBy} className="btn btn-sm" disabled={disabled || pending} type="button"
      onClick={() => { setOpen(true); setMessage(''); setError(''); }}>{label}</button>
    {message ? <span role="status">{message}</span> : null}
    {open ? <div className="admin-encrypted-export"><CustomerServiceDialog title="엑셀 비밀번호 설정" busy={pending}
      onClose={() => { setOpen(false); setError(''); }}>
      <form autoComplete="off" className="admin-form-section" onSubmit={download}>
        <p>{snapshot ? '보존된 거래확정 기록을 새 비밀번호로 내려받습니다.' : '현재 검색 조건의 최신 목록을 암호화해 내려받습니다.'}</p>
        <p className="muted" id={hintId}>{EXPORT_PASSWORD_HINT}</p>
        <label>비밀번호<input aria-describedby={hintId} autoComplete="new-password" autoFocus disabled={pending}
          maxLength={64} minLength={12} name="password" required spellCheck={false} type="password" /></label>
        <label>비밀번호 확인<input aria-describedby={hintId} autoComplete="new-password" disabled={pending}
          maxLength={64} minLength={12} name="passwordConfirmation" required spellCheck={false} type="password" /></label>
        <p className="muted">비밀번호는 저장하지 않습니다. 잊어버리면 새 비밀번호로 다시 내려받아 주세요. 개인정보가 담긴 파일은 업무에 필요한 기간만 보관해주세요.</p>
        {error ? <p className="wc-admin-kit__error" role="alert">{error}</p> : null}
        <div className="wc-admin-kit__actions">
          <button className="btn btn-sm" disabled={pending} type="button" onClick={() => { setOpen(false); setError(''); }}>취소</button>
          <button className="btn btn-sm btn-primary" disabled={pending} type="submit">{pending ? '암호화 파일 만드는 중…' : '암호화 엑셀 다운로드'}</button>
        </div>
      </form>
    </CustomerServiceDialog></div> : null}
  </>;
}
