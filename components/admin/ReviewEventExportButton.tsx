'use client';
import { useId, useState } from 'react';
import { adminListExportFileNameFromDisposition } from '@/lib/admin/list-export';
import { adminListExportResponseError } from './AdminListExportButton';

export function ReviewEventExportButton({ href, total, entries = false, disabled = false }: { href: string; total: number; entries?: boolean; disabled?: boolean }) {
  const id = useId(), [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  async function download() {
    if (disabled || pending || !confirmed || total > 10000) return;
    setPending(true); setMessage(''); setError('');
    try {
      const response = await fetch(`${href}&privacyConfirmed=yes`, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok || !response.headers.get('content-type')?.includes('spreadsheetml.sheet')) { setError(await adminListExportResponseError(response)); return; }
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = adminListExportFileNameFromDisposition(response.headers.get('content-disposition'), 'icons-review-events.xlsx');
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      const rows = Number(response.headers.get('x-icons-export-rows')); setMessage(Number.isSafeInteger(rows) && rows >= 0 ? `엑셀 ${rows.toLocaleString('ko-KR')}행을 내려받았습니다.` : '엑셀 파일을 내려받았습니다.');
    } catch { setError('연결이 끊겨 파일을 받지 못했습니다. 다시 내려받아 주세요.'); }
    finally { setPending(false); }
  }
  return <div className="admin-review-events__export">
    <label><input type="checkbox" checked={confirmed} disabled={disabled || pending} onChange={event => setConfirmed(event.target.checked)} />암호화되지 않은 파일의 업무용 보관·삭제 책임을 확인합니다.</label>
    <button type="button" className="btn btn-sm" aria-describedby={id} disabled={disabled || pending || !confirmed || total > 10000} onClick={download}>{pending ? '엑셀 파일 만드는 중…' : entries ? '응모 엑셀 다운로드' : '목록 엑셀 다운로드'}</button>
    <p id={id}>{total > 10000 ? '최대 10,000건입니다. 검색 조건을 좁혀주세요.' : `현재 검색 조건의 전체 ${total.toLocaleString('ko-KR')}건을 받습니다. 최대 10,000건이며 내려받은 기록이 남습니다.`}{entries ? ' 저장된 선정 상태만 포함합니다. 본문·사진 주소·연락처·회원번호·주문번호는 제외합니다.' : ''}{disabled ? ' 수정 중인 내용을 저장하거나 되돌린 뒤 내려받아 주세요.' : ''}</p>
    {message ? <p role="status">{message}</p> : null}{error ? <p className="wc-admin-kit__error" role="alert">{error}</p> : null}
  </div>;
}
