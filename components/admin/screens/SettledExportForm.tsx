'use client';
import { useActionState } from 'react';
import { createSettledExportAction } from '@/app/admin/settled-export-actions';
import type { SettledExportFilters } from '@/lib/admin/settled-export';

export function SettledExportForm({ filters, requestId }: { filters: SettledExportFilters; requestId: string }) {
  const [state, action, pending] = useActionState(createSettledExportAction, {});
  return <form action={action} className="admin-form-section">
    <input type="hidden" name="requestId" value={state.requestId ?? requestId} />
    <input type="hidden" name="from" value={filters.from ?? ''} />
    <input type="hidden" name="to" value={filters.to ?? ''} />
    <input type="hidden" name="query" value={filters.query} />
    <button className="btn sm" type="submit" disabled={pending}>{pending ? '엑셀 기록 생성 중…' : '현재 조건의 거래확정 엑셀 만들기'}</button>
    <p className="muted">현재 조회 조건의 전체 페이지를 담습니다. 주문 1,000건·품목 10,000행까지 생성할 수 있으며, 생성한 기록은 이후 변경과 무관하게 유지됩니다.</p>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.receipt ? <p role="status">
      주문 {state.receipt.orderCount.toLocaleString('ko-KR')}건을 보존했습니다.{' '}
      <a className="admin-console-grid-link" href={`/api/admin/settled-workbook?id=${state.receipt.id}`} download>거래확정 엑셀 다운로드</a>
      {' '}<span className="muted">같은 링크로 보존된 기록을 다시 받을 수 있습니다.</span>
    </p> : null}
  </form>;
}
