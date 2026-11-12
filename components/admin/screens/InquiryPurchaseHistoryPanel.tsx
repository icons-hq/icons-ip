'use client';
import Link from 'next/link';
import { startTransition, useActionState, useId } from 'react';
import { loadInquiryPurchaseHistoryAction, type InquiryPurchaseHistoryState } from '@/app/admin/inquiry-purchase-history-actions';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from '@/lib/admin/orders';
import type { InquiryPurchaseHistory } from '@/lib/admin/inquiry-purchase-history';
import { statusTone } from '@/lib/admin/status-tone';
import { formatInquiryDateTime } from '@/lib/inquiries';
import { orderReferenceLabel } from '@/lib/orders';

const EMPTY: InquiryPurchaseHistoryState = {};
const RECORD_LINK_CLASS = 'text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground';

function orderStatusLabel(status: string) {
  return ADMIN_ORDER_STATUS_LABELS[status as AdminOrderStatus] ?? status;
}

/*
 * 상담 중 고객의 구매이력(1014-103). 상담 화면을 여는 모든 운영자 역할(부매니저·대행사 포함)이 그 문의 고객의 주문을
 * 금액·상태와 함께 본다. 고객 범위·열람 감사는 DB가 정한다. 주문 상세 링크는 주문 조회 권한이 있을 때만 둔다 —
 * 주문 조회 권한이 없는 역할은 주문 화면을 열 수 없다.
 *
 * `initialHistory`를 주면 버튼 없이 첫 페이지를 바로 보여 준다(상담하기, A7). 주지 않으면 [구매이력 불러오기]로 연다(고객문의 상세).
 * 페이지 이동은 같은 서버 액션과 같은 권한 검사를 쓴다. `showLinkedOrder`는 연결 주문 카드가 없는 화면(주문 조회 권한이 없는
 * 고객문의 상세)에서 그 문의의 연결 주문 요약을 목록 위에 보인다 — 상담하기는 카드 머리에 따로 보인다.
 */
export function InquiryPurchaseHistoryPanel({ inquiryId, initialHistory, canOpenOrders, title = '전체 구매이력', showLinkedOrder = false }: {
  inquiryId: string; initialHistory?: InquiryPurchaseHistory | null; canOpenOrders: boolean; title?: string; showLinkedOrder?: boolean;
}) {
  const [state, action, pending] = useActionState(loadInquiryPurchaseHistoryAction, initialHistory?.inquiryId === inquiryId ? { history: initialHistory } : EMPTY);
  const listId = useId();
  const history = state.history?.inquiryId === inquiryId ? state.history : null;
  return <section aria-label={title} aria-busy={pending} className="flex min-w-0 flex-col gap-3">
    <h3 className="text-sm font-medium text-foreground">{title}</h3>
    {!history ? <form action={action} className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">이 문의를 남긴 고객의 주문을 금액·상태와 함께 확인합니다. 열람은 기록에 남습니다.</p>
      <input type="hidden" name="inquiryId" value={inquiryId} /><input type="hidden" name="page" value="1" />
      <Button aria-controls={listId} disabled={pending} size="sm" type="submit" variant="outline">구매이력 불러오기</Button>
    </form> : null}
    {state.error ? <p className="bg-transparent text-sm text-destructive" role="alert">{state.error}</p> : null}
    <div className="flex min-w-0 flex-col gap-3" id={listId}>
      {pending ? <p className="text-sm text-muted-foreground" role="status">구매이력을 불러오는 중입니다.</p> : null}
      {history && showLinkedOrder ? history.linkedOrder ? <InquiryLinkedOrderSummary order={history.linkedOrder} canOpenOrders={canOpenOrders} />
        : <p className="text-sm text-muted-foreground">연결된 주문이 없습니다.</p> : null}
      {history ? <>
        {history.items.length ? <ul className="flex flex-col divide-y" data-inquiry-purchase-history="">{history.items.map(order => <li className="flex min-w-0 flex-col items-start gap-1.5 py-3 text-sm wrap-anywhere first:pt-0 last:pb-0" key={order.id}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <time className="tabular-nums" dateTime={order.createdAt}>{formatInquiryDateTime(order.createdAt)}</time>
            <AdminStatusBadge tone={statusTone('order', order.status)}>{orderStatusLabel(order.status)}</AdminStatusBadge>
          </div>
          <strong className="font-medium text-foreground">{order.title}</strong>
          <span className="tabular-nums">{order.amount.toLocaleString('ko-KR')}원{order.itemCount ? ` · ${order.itemCount}개 품목` : ''}</span>
          <span className="text-xs text-muted-foreground tabular-nums">주문번호 {orderReferenceLabel(order.id, order.orderNumber)}</span>
          {canOpenOrders ? <Link className={RECORD_LINK_CLASS} href={`/admin/sales/orders/${order.id}`}>주문 상세 열기</Link> : null}
        </li>)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">주문 이력이 없습니다.</p>}
        {/* 페이지 이동도 같은 서버 액션에 같은 값(inquiryId·page)을 보낸다. 폼 제출 대신 전환 안에서 부른다. */}
        <ConsolePagination className="border-t pt-3" label="구매이력 페이지" page={history.page} pageSize={history.pageSize} total={history.total} disabled={pending} onPageChange={page => {
          const form = new FormData();
          form.set('inquiryId', inquiryId); form.set('page', String(page));
          startTransition(() => action(form));
        }} />
      </> : null}
    </div>
  </section>;
}

/** 상담 중 고객의 연결 주문 한 줄 요약. 주문 상세 링크는 주문 조회 권한이 있을 때만. */
export function InquiryLinkedOrderSummary({ order, canOpenOrders }: {
  order: { id: string; orderNumber?: string | null; status?: string | null; title: string | null; quantity: number; amount?: number | null };
  canOpenOrders: boolean;
}) {
  return <div className="flex flex-col gap-1 text-sm">
    <p className="flex flex-wrap items-center gap-2"><span>연결 주문 {orderReferenceLabel(order.id, order.orderNumber)}</span>
      {order.status ? <AdminStatusBadge tone={statusTone('order', order.status)}>{orderStatusLabel(order.status)}</AdminStatusBadge> : null}</p>
    <p className="text-muted-foreground">{order.title ?? '주문 상품'} · {order.quantity}개{typeof order.amount === 'number' ? ` · ${order.amount.toLocaleString('ko-KR')}원` : ''}</p>
    {canOpenOrders ? <Link className={RECORD_LINK_CLASS} href={`/admin/sales/orders/${order.id}`}>주문 상세</Link> : null}
  </div>;
}
