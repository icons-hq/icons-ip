'use client';

import { useId, useState } from 'react';
import {
  ADMIN_LIST_EXPORT_BUTTON_LABEL,
  ADMIN_LIST_EXPORT_ROW_LIMIT,
  adminListExportFileNameFromDisposition,
  adminListExportLimitMessage,
} from '@/lib/admin/list-export';

const XLSX_TYPE = 'spreadsheetml.sheet';
const SESSION_MESSAGE = '로그인이 만료되었거나 권한이 없습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
const FALLBACK_MESSAGE = '파일을 만들지 못했습니다. 잠시 후 다시 내려받아 주세요.';

/** 실패 응답에서 운영자에게 보여 줄 문구를 고른다. 서버 본문의 `error`를 우선한다. */
export async function adminListExportResponseError(response: Response) {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      const message = (body as { error: string }).error.trim();
      if (message) return message;
    }
  } catch {
    /* 로그인 화면 HTML 같은 비JSON 응답 */
  }
  if (response.redirected || [401, 403, 404].includes(response.status)) return SESSION_MESSAGE;
  return FALLBACK_MESSAGE;
}

/**
 * 주문·배송 목록의 엑셀 다운로드 버튼.
 *
 * 화면에 적용된 조건(서버가 정규화한 필터)으로 만든 주소를 받는다. 폼에 입력만 하고
 * 검색하지 않은 값은 담기지 않는다. 오류 응답의 본문 문구를 그대로 보여 준다.
 */
export function AdminListExportButton({ href, total }: { href: string; total: number }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const hintId = useId();
  const overLimit = total > ADMIN_LIST_EXPORT_ROW_LIMIT;
  const limit = ADMIN_LIST_EXPORT_ROW_LIMIT.toLocaleString('ko-KR');
  /* 미입금 확인만 주문 한 건이 한 행이다. 나머지 화면은 상품 줄로 펼쳐 행이 건수보다 많을 수 있다. */
  const expandsLines = new URLSearchParams(href.split('?')[1] ?? '').get('screen') !== 'unpaid';

  async function download() {
    if (pending || overLimit) return;
    setPending(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch(href, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes(XLSX_TYPE)) {
        setError(await adminListExportResponseError(response));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = adminListExportFileNameFromDisposition(response.headers.get('content-disposition'), 'icons-list.xlsx');
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const rows = Number(response.headers.get('x-icons-export-rows'));
      setMessage(Number.isSafeInteger(rows) && rows >= 0
        ? `엑셀 ${rows.toLocaleString('ko-KR')}행을 내려받았습니다.`
        : '엑셀 파일을 내려받았습니다.');
    } catch {
      setError('연결이 끊겨 파일을 받지 못했습니다. 잠시 후 다시 내려받아 주세요.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="wc-admin-kit__actions admin-list-export" data-export-href={href}>
      <button
        aria-describedby={hintId}
        className="btn btn-sm"
        disabled={pending || overLimit}
        onClick={download}
        type="button"
      >
        {pending ? '엑셀 파일 만드는 중…' : ADMIN_LIST_EXPORT_BUTTON_LABEL}
      </button>
      <span className="muted" id={hintId}>
        {overLimit
          ? adminListExportLimitMessage()
          : `현재 검색 조건의 전체 ${total.toLocaleString('ko-KR')}건을 받습니다(최대 ${limit}건). ${
            expandsLines ? `한 행은 상품 한 줄이며 한 파일은 최대 ${limit}행입니다. ` : ''
          }개인정보가 담긴 파일이라 내려받은 기록이 남습니다.`}
      </span>
      {message ? <span role="status">{message}</span> : null}
      {error ? <span className="wc-admin-kit__error" role="alert">{error}</span> : null}
    </div>
  );
}
