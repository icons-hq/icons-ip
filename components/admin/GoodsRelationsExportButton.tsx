'use client';
import { useEffect, useRef, useState } from 'react';
import { GOODS_RELATIONS_EXPORT_LIMIT } from '@/lib/admin/goods-relations-export';
import { adminListExportResponseError } from './AdminListExportButton';

export function GoodsRelationsExportButton({ href, total }: { href: string; total: number }) {
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function download() {
    if (request.current || total > GOODS_RELATIONS_EXPORT_LIMIT) return;
    const controller = new AbortController(); request.current = controller;
    setPending(true); setMessage(''); setError('');
    try {
      const response = await fetch(href, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.includes('spreadsheetml.sheet')) {
        const problem = await adminListExportResponseError(response);
        if (!controller.signal.aborted) setError(problem);
        return;
      }
      const bytes = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(bytes), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'icons-goods-relations.xlsx';
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      const count = Number(response.headers.get('x-icons-export-rows'));
      setMessage(Number.isSafeInteger(count) && count >= 0 ? `편성 ${count.toLocaleString('ko-KR')}개의 엑셀을 내려받았습니다.` : '엑셀을 내려받았습니다.');
    } catch { if (!controller.signal.aborted) setError('연결이 끊겨 파일을 받지 못했습니다. 다시 내려받아 주세요.'); }
    finally { if (!controller.signal.aborted) { request.current = null; setPending(false); } }
  }
  return <div className="admin-goods-relations__export">
    <button type="button" className="wc-admin-kit__button" disabled={pending || total > GOODS_RELATIONS_EXPORT_LIMIT} onClick={download}>{pending ? '엑셀 만드는 중…' : '목록 엑셀 다운로드'}</button>
    <small>{total > GOODS_RELATIONS_EXPORT_LIMIT ? '최대 2,000개 편성입니다. 검색 조건을 좁혀주세요.' : `같은 조건의 전체 ${total.toLocaleString('ko-KR')}개 편성과 구성 상품을 받습니다.`}</small>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className="wc-admin-kit__error">{error}</p> : null}
  </div>;
}
