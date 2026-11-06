'use client';
import { useActionState, useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { loadCustomerHistoryAction, type CustomerHistoryState } from '@/app/admin/customer-actions';
import { AdminSectionCard } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
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
  const totalPages = history ? Math.max(1, Math.ceil(history.total / history.pageSize)) : 1;
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
        <form action={action} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm" aria-label="고객 이력 페이지">
          <input type="hidden" name="userId" value={userId} /><input type="hidden" name="tab" value={history.tab} />
          <Button disabled={pending || history.page <= 1} name="page" size="sm" type="submit" value={history.page - 1} variant="outline"><ChevronLeft aria-hidden="true" />이전</Button>
          <span className="text-muted-foreground tabular-nums">{history.page} / {totalPages} · {history.total}건</span>
          <Button disabled={pending || history.page >= totalPages} name="page" size="sm" type="submit" value={history.page + 1} variant="outline">다음<ChevronRight aria-hidden="true" /></Button>
        </form>
      </> : null}
    </div>
  </>;
  return <div className="min-w-0" aria-busy={pending}>
    {framed ? <AdminSectionCard title={title}>{body}</AdminSectionCard>
      : <section aria-label={title} className="flex min-w-0 flex-col gap-3"><h3 className="text-sm font-medium text-foreground">{title}</h3>{body}</section>}
  </div>;
}
