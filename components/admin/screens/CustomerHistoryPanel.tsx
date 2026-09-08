'use client';
import { useActionState, useId } from 'react';
import { loadCustomerHistoryAction, type CustomerHistoryState } from '@/app/admin/customer-actions';
import { AdminSectionCard } from '@/components/admin/console/AdminKit';
import { CUSTOMER_TAB_LABELS } from '@/lib/admin/customer-detail';
import { CustomerRecordList } from './CustomerRecordList';

const EMPTY: CustomerHistoryState = {};
export function CustomerHistoryPanel({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(loadCustomerHistoryAction, EMPTY);
  const panelId = useId();
  const history = state.history?.userId === userId ? state.history : null;
  const totalPages = history ? Math.max(1, Math.ceil(history.total / history.pageSize)) : 1;
  return <div className="admin-customer admin-customer--inline" aria-busy={pending}>
    <AdminSectionCard title="고객 이력">
      <p className="admin-customer__muted">답변 작성 중 고객의 다른 주문과 요청을 함께 확인할 수 있습니다.</p>
      <form action={action} className="admin-customer__history-tabs">
        <input type="hidden" name="userId" value={userId} /><input type="hidden" name="page" value="1" />
        {(['orders', 'claims'] as const).map((tab) => <button key={tab} type="submit" name="tab" value={tab}
          className="admin-customer__link-button" aria-pressed={history?.tab === tab} aria-controls={panelId} disabled={pending}>
          {CUSTOMER_TAB_LABELS[tab]}
        </button>)}
      </form>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <div id={panelId}>
        {pending ? <p role="status">이력을 불러오는 중입니다.</p> : null}
        {history ? <>
          <CustomerRecordList tab={history.tab} items={history.items} />
          <form action={action} className="admin-customer__history-pages" aria-label="고객 이력 페이지">
            <input type="hidden" name="userId" value={userId} /><input type="hidden" name="tab" value={history.tab} />
            <button type="submit" className="admin-customer__link-button" name="page" value={history.page - 1} disabled={pending || history.page <= 1}>이전</button>
            <span>{history.page} / {totalPages} · {history.total}건</span>
            <button type="submit" className="admin-customer__link-button" name="page" value={history.page + 1} disabled={pending || history.page >= totalPages}>다음</button>
          </form>
        </> : null}
      </div>
    </AdminSectionCard>
  </div>;
}
