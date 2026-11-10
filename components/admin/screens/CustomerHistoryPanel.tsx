'use client';
import { startTransition, useActionState, useId } from 'react';
import { loadCustomerHistoryAction, type CustomerHistoryState } from '@/app/admin/customer-actions';
import { AdminSectionCard } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { CUSTOMER_TAB_LABELS } from '@/lib/admin/customer-detail';
import { CustomerRecordList } from './CustomerRecordList';
import { KIT_SEGMENT_CLASS, KIT_SEGMENT_ITEM_CLASS } from './cs-kit-classes';

const EMPTY: CustomerHistoryState = {};
/* `initialHistory`를 주면 버튼 없이 첫 페이지를 바로 보여 준다(상담 화면 구매이력, A7).
   이후 페이지 이동·탭 전환은 같은 서버 액션과 권한 검사를 쓴다.
   `framed={false}`는 바깥 카드(상담하기 컨텍스트) 안에 놓일 때 카드 테두리를 뺀다. */
export function CustomerHistoryPanel({ userId, canReadClaims = true, initialHistory, title = '고객 이력', framed = true }: {
  userId: string; canReadClaims?: boolean; initialHistory?: NonNullable<CustomerHistoryState['history']> | null; title?: string; framed?: boolean;
}) {
  const [state, action, pending] = useActionState(loadCustomerHistoryAction, initialHistory?.userId === userId ? { history: initialHistory } : EMPTY);
  const panelId = useId();
  const history = state.history?.userId === userId ? state.history : null;
  const body = <>
    <p className="text-sm text-muted-foreground">답변 작성 중 고객의 다른 주문과 요청을 함께 확인할 수 있습니다.</p>
    {canReadClaims || !history ? <form action={action} className={KIT_SEGMENT_CLASS}>
      <input type="hidden" name="userId" value={userId} /><input type="hidden" name="page" value="1" />
      {(['orders', ...(canReadClaims ? ['claims'] : [])] as ('orders' | 'claims')[]).map((tab) => <button key={tab} type="submit" name="tab" value={tab}
        className={KIT_SEGMENT_ITEM_CLASS} data-slot="button" aria-pressed={history?.tab === tab} aria-controls={panelId} disabled={pending}>
        {CUSTOMER_TAB_LABELS[tab]}
      </button>)}
    </form> : null}
    {state.error ? <p className="bg-transparent text-sm text-destructive" role="alert">{state.error}</p> : null}
    <div className="flex min-w-0 flex-col gap-3" id={panelId}>
      {pending ? <p className="text-sm text-muted-foreground" role="status">이력을 불러오는 중입니다.</p> : null}
      {history ? <>
        <CustomerRecordList tab={history.tab} items={history.items} />
        {/* 페이지 이동도 탭과 같은 서버 액션에 같은 값(userId·tab·page)을 보낸다. 폼 제출 대신 전환 안에서 부른다. */}
        <ConsolePagination className="border-t pt-3" label="고객 이력 페이지" page={history.page} pageSize={history.pageSize} total={history.total} disabled={pending} onPageChange={page => {
          const form = new FormData();
          form.set('userId', userId); form.set('tab', history.tab); form.set('page', String(page));
          startTransition(() => action(form));
        }} />
      </> : null}
    </div>
  </>;
  return <div className="min-w-0" aria-busy={pending}>
    {framed ? <AdminSectionCard title={title}>{body}</AdminSectionCard>
      : <section aria-label={title} className="flex min-w-0 flex-col gap-3"><h3 className="text-sm font-medium text-foreground">{title}</h3>{body}</section>}
  </div>;
}
