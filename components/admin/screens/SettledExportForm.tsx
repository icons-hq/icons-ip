'use client';
import { useActionState, useEffect, useRef } from 'react';
import { createSettledExportAction } from '@/app/admin/settled-export-actions';
import { ADMIN_LIST_EXPORT_BUTTON_LABEL } from '@/lib/admin/list-export';
import type { SettledExportFilters } from '@/lib/admin/settled-export';

const settledWorkbookHref = (id: string) => `/api/admin/settled-workbook?id=${id}`;

export function SettledExportForm({ filters, requestId }: { filters: SettledExportFilters; requestId: string }) {
  const [state, action, pending] = useActionState(createSettledExportAction, {});
  const downloaded = useRef<string | null>(null);
  const receiptId = state.receipt?.id ?? null;
  /* 다른 목록과 같은 한 번 누름 동선: 보존 기록이 만들어지면 바로 파일을 받는다.
     기록·영수증 방식은 그대로이며, 같은 기록은 아래 링크로 다시 받는다. */
  useEffect(() => {
    if (!receiptId || downloaded.current === receiptId) return;
    downloaded.current = receiptId;
    const anchor = document.createElement('a');
    anchor.href = settledWorkbookHref(receiptId);
    anchor.download = '';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, [receiptId]);
  return <form action={action} className="admin-form-section">
    <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
    <input type="hidden" name="from" value={filters.from ?? ''} />
    <input type="hidden" name="to" value={filters.to ?? ''} />
    <input type="hidden" name="query" value={filters.query} />
    <div className="wc-admin-kit__actions admin-list-export">
      <button className="btn btn-sm" type="submit" disabled={pending}>{pending ? '엑셀 파일 만드는 중…' : ADMIN_LIST_EXPORT_BUTTON_LABEL}</button>
      <span className="muted">현재 조회 조건의 전체 페이지를 담습니다. 주문 1,000건·품목 10,000행까지 생성할 수 있으며, 생성한 기록은 이후 변경과 무관하게 유지됩니다.</span>
    </div>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.receipt ? <p role="status">
      주문 {state.receipt.orderCount.toLocaleString('ko-KR')}건을 보존하고 파일을 내려받았습니다.{' '}
      <a className="admin-console-grid-link" href={settledWorkbookHref(state.receipt.id)} download>거래확정 엑셀 다시 받기</a>
      {' '}<span className="muted">같은 링크로 보존된 기록을 다시 받을 수 있습니다.</span>
    </p> : null}
  </form>;
}
