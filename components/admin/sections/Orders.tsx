'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  approveAdminOrderCancellationAction,
  reconcileAdminOrderCancellationAction,
  rejectAdminOrderCancellationAction,
  updateAdminOrderStatusAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';
import {
  adminOrdersHref,
  type AdminOrderCancellationRequestRecord,
  type AdminOrderConsoleData,
  type AdminOrderFilters,
  type AdminOrderRecord,
  type OrderCancellationRequestStatus,
} from '@/lib/admin/orders';
import {
  formatOrderDateTime,
  orderReferenceLabel,
  orderStatusMeta,
  paymentStatusLabel,
  refundStatusLabel,
} from '@/lib/orders';
import { formatKrw } from '../format';

const STATUS_OPTIONS: Array<{ value: AdminOrderFilters['status']; label: string }> = [
  { value: 'all', label: '전체 상태' },
  { value: 'pending', label: '결제 대기' },
  { value: 'paid', label: '결제 완료' },
  { value: 'shipping', label: '배송 중' },
  { value: 'done', label: '완료' },
  { value: 'canceled', label: '취소' },
];

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

const CANCELLATION_STATUS_LABELS: Record<OrderCancellationRequestStatus, string> = {
  requested: '승인 대기',
  processing: '결제 취소 중',
  needs_review: '운영 확인 필요',
  completed: '취소 완료',
  rejected: '요청 거절',
};

function confirmAction(event: React.FormEvent<HTMLFormElement>, message: string) {
  if (!window.confirm(message)) event.preventDefault();
}

function ActionFeedback({ state }: { state: AdminOrderActionState }) {
  return (
    <div aria-live="polite" className="admin-order-action-feedback">
      {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
      {state.message ? <span role="status">{state.message}</span> : null}
    </div>
  );
}

function OrderStatusAction({
  label,
  orderId,
  status,
}: {
  label: string;
  orderId: string;
  status: 'shipping' | 'done';
}) {
  const [state, action, pending] = useActionState(updateAdminOrderStatusAction, EMPTY_ACTION_STATE);
  const confirmation = status === 'shipping'
    ? '배송을 시작하면 사용자 셀프 취소가 제한됩니다. 배송을 시작할까요?'
    : '주문을 배송 완료 처리할까요?';

  return (
    <form
      action={action}
      className="admin-order-action-form"
      data-confirm={confirmation}
      onSubmit={(event) => confirmAction(event, confirmation)}
    >
      <input name="orderId" type="hidden" value={orderId} />
      <input name="status" type="hidden" value={status} />
      <button className="btn btn-sm" disabled={pending} type="submit">
        {pending ? '처리 중' : label}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

function ApproveCancellationForm({
  orderStatus,
  requestId,
}: {
  orderStatus: AdminOrderRecord['status'];
  requestId: string;
}) {
  const [state, action, pending] = useActionState(approveAdminOrderCancellationAction, EMPTY_ACTION_STATE);
  // 반품 입고 확인은 별도 상태가 아니라 승인 행위에 내포된다(D11). 배송이 나간 주문은
  // 승인 즉시 결제가 취소되고 재고가 복원되므로 확인 문구로 그 전제를 묻는다.
  const confirmation = orderStatus === 'shipping' || orderStatus === 'done'
    ? '반품 물건 입고를 확인하셨나요? 승인하면 결제 취소와 재고 복원이 진행됩니다.'
    : '청약철회를 승인하고 결제 취소를 시작할까요?';

  return (
    <form
      action={action}
      className="admin-order-action-form"
      data-confirm={confirmation}
      onSubmit={(event) => confirmAction(event, confirmation)}
    >
      <input name="requestId" type="hidden" value={requestId} />
      <button className="btn btn-sm" disabled={pending} type="submit">
        {pending ? '승인 중' : '청약철회 승인'}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

function RejectCancellationForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(rejectAdminOrderCancellationAction, EMPTY_ACTION_STATE);
  const confirmation = '청약철회 요청을 거절할까요? 입력한 사유가 기록됩니다.';

  return (
    <form
      action={action}
      className="admin-order-reject-form"
      data-confirm={confirmation}
      onSubmit={(event) => confirmAction(event, confirmation)}
    >
      <input name="requestId" type="hidden" value={requestId} />
      <label htmlFor={`admin-order-reject-reason-${requestId}`}>거절 사유</label>
      <textarea
        aria-describedby={state.errors?.reason ? `admin-order-reject-error-${requestId}` : undefined}
        disabled={pending}
        id={`admin-order-reject-reason-${requestId}`}
        maxLength={200}
        minLength={10}
        name="reason"
        placeholder="거절 근거를 10자 이상 입력해주세요"
        required
        rows={3}
      />
      {state.errors?.reason ? (
        <span id={`admin-order-reject-error-${requestId}`} role="alert">{state.errors.reason}</span>
      ) : null}
      <button className="btn btn-sm btn-ghost" disabled={pending} type="submit">
        {pending ? '거절 중' : '요청 거절'}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

function ReconcileCancellationForm({
  request,
}: {
  request: AdminOrderCancellationRequestRecord;
}) {
  const [state, action, pending] = useActionState(reconcileAdminOrderCancellationAction, EMPTY_ACTION_STATE);
  const confirmation = '결제 취소 상태를 다시 확인할까요?';
  const label = request.status === 'processing' ? '처리 상태 확인' : '상태 다시 확인';

  return (
    <form
      action={action}
      className="admin-order-action-form"
      data-confirm={confirmation}
      onSubmit={(event) => confirmAction(event, confirmation)}
    >
      <input name="requestId" type="hidden" value={request.id} />
      <button className="btn btn-sm" disabled={pending} type="submit">
        {pending ? '확인 중' : label}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

function OrderFilters({ filters }: { filters: AdminOrderFilters }) {
  return (
    <form action="/admin" className="admin-order-filters card" method="get">
      <input name="section" type="hidden" value="orders" />
      <label>
        <span>주문 검색</span>
        <input
          aria-label="주문번호 또는 구매자 검색"
          defaultValue={filters.query}
          name="query"
          placeholder="주문 UUID · 닉네임 · 이메일"
          type="search"
        />
      </label>
      <label>
        <span>상태</span>
        <select aria-label="주문 상태" defaultValue={filters.status} name="status">
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>시작일</span>
        <input aria-label="주문 시작일" defaultValue={filters.from ?? ''} name="from" type="date" />
      </label>
      <label>
        <span>종료일</span>
        <input aria-label="주문 종료일" defaultValue={filters.to ?? ''} name="to" type="date" />
      </label>
      <div className="admin-order-filter-actions">
        <button className="btn btn-sm" type="submit">검색</button>
        <Link className="btn btn-sm btn-ghost" href="/admin?section=orders&page=1">초기화</Link>
      </div>
    </form>
  );
}

function OrderDetail({ order }: { order: AdminOrderRecord }) {
  const status = orderStatusMeta(order.status);
  const cancellationRequest = order.cancellationRequest;
  const canAdvanceOrderStatus = !cancellationRequest || cancellationRequest.status === 'rejected';

  return (
    <article aria-labelledby="admin-order-detail-title" className="admin-order-detail card">
      <header className="admin-order-detail-header">
        <div>
          <span className={`order-status order-status--${order.status}`}>{status.label}</span>
          <h2 id="admin-order-detail-title">주문 {orderReferenceLabel(order.id)}</h2>
          <p className="faint mono">{order.id}</p>
        </div>
        <strong>{formatKrw(order.total)}</strong>
      </header>

      <dl className="admin-order-summary">
        <div><dt>구매자</dt><dd>@{order.buyerName}</dd></div>
        <div><dt>이메일</dt><dd>{order.buyerEmail ?? '미등록'}</dd></div>
        <div><dt>주문 시각</dt><dd>{formatOrderDateTime(order.createdAt)}</dd></div>
        <div><dt>최근 변경</dt><dd>{formatOrderDateTime(order.updatedAt)}</dd></div>
      </dl>

      <section className="admin-order-detail-section" aria-labelledby="admin-order-items-title">
        <h3 id="admin-order-items-title">주문 품목</h3>
        <div className="admin-order-items">
          {order.items.map((item) => (
            <div className="admin-order-item" key={item.id}>
              <div><strong>{item.name}</strong><span>{item.type}</span></div>
              <span>{item.qty.toLocaleString('ko-KR')}개</span>
              <strong>{formatKrw(item.unitPrice * item.qty)}</strong>
            </div>
          ))}
        </div>
      </section>

      {order.address && (
        <section className="admin-order-detail-section" aria-labelledby="admin-order-address-title">
          <h3 id="admin-order-address-title">배송지</h3>
          <address className="admin-order-address">
            <strong>{order.address.recipientName}</strong>
            <span>{order.address.phone}</span>
            <span>[{order.address.postalCode}] {order.address.address1}</span>
            {order.address.address2 ? <span>{order.address.address2}</span> : null}
            {order.address.deliveryNote ? <small>배송 메모 · {order.address.deliveryNote}</small> : null}
          </address>
        </section>
      )}

      <section className="admin-order-detail-section" aria-labelledby="admin-order-payment-title">
        <h3 id="admin-order-payment-title">결제·환불</h3>
        <div className="admin-order-ledger">
          {order.payments.map((payment) => (
            <div key={payment.id}>
              <span>결제 · {paymentStatusLabel(payment.status)}</span>
              <span>{formatOrderDateTime(payment.createdAt)}</span>
              <strong>{formatKrw(payment.amount)}</strong>
            </div>
          ))}
          {order.refunds.map((refund) => (
            <div key={refund.id}>
              <span>환불 · {refundStatusLabel(refund.status)}</span>
              <span>{formatOrderDateTime(refund.createdAt)}</span>
              <strong>{formatKrw(refund.amount)}</strong>
            </div>
          ))}
          {!order.payments.length && !order.refunds.length ? <p className="muted">결제 기록이 없습니다.</p> : null}
        </div>
      </section>

      {cancellationRequest ? (
        <section className="admin-order-cancellation" aria-labelledby="admin-order-cancellation-title">
          <div className="admin-order-cancellation-heading">
            <div>
              <span>청약철회 요청</span>
              <h3 id="admin-order-cancellation-title">
                {CANCELLATION_STATUS_LABELS[cancellationRequest.status]}
              </h3>
            </div>
            <time dateTime={cancellationRequest.requestedAt}>
              {formatOrderDateTime(cancellationRequest.requestedAt)}
            </time>
          </div>
          {cancellationRequest.decisionNote ? (
            <p>처리 메모 · {cancellationRequest.decisionNote}</p>
          ) : null}
        </section>
      ) : null}

      <div className="admin-order-actions">
        {canAdvanceOrderStatus && order.status === 'paid' ? (
          <OrderStatusAction label="배송 시작" orderId={order.id} status="shipping" />
        ) : null}
        {canAdvanceOrderStatus && order.status === 'shipping' ? (
          <OrderStatusAction label="배송 완료" orderId={order.id} status="done" />
        ) : null}
        {cancellationRequest?.status === 'requested' ? (
          <>
            <ApproveCancellationForm orderStatus={order.status} requestId={cancellationRequest.id} />
            <RejectCancellationForm requestId={cancellationRequest.id} />
          </>
        ) : null}
        {cancellationRequest?.status === 'processing' || cancellationRequest?.status === 'needs_review' ? (
          <ReconcileCancellationForm request={cancellationRequest} />
        ) : null}
      </div>
    </article>
  );
}

export function OrdersSection({ data }: { data: AdminOrderConsoleData }) {
  const selected = data.items.find((order) => order.id === data.filters.orderId) ?? data.items[0] ?? null;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <section className="admin-orders col">
      <OrderFilters filters={data.filters} />
      <div className="admin-master-detail admin-order-master-detail">
        <aside className="admin-order-list card" aria-label="주문 목록">
          <div className="admin-order-list-heading">
            <strong>주문 {data.total.toLocaleString('ko-KR')}건</strong>
            <span className="faint mono">최근순</span>
          </div>
          {data.items.map((order) => (
            <Link
              aria-current={selected?.id === order.id ? 'true' : undefined}
              aria-label={`주문 ${orderReferenceLabel(order.id)} 선택`}
              className={selected?.id === order.id ? 'admin-order-row on' : 'admin-order-row'}
              href={adminOrdersHref(data.filters, { orderId: order.id })}
              key={order.id}
            >
              <span className={`order-status order-status--${order.status}`}>{orderStatusMeta(order.status).label}</span>
              <strong>@{order.buyerName}</strong>
              <span className="faint mono">{orderReferenceLabel(order.id)}</span>
              <span>{formatKrw(order.total)}</span>
            </Link>
          ))}
          {!data.items.length ? <p className="muted">조건에 맞는 주문이 없습니다.</p> : null}
          {totalPages > 1 ? (
            <nav aria-label="주문 목록 페이지" className="admin-order-pagination">
              {data.filters.page > 1 ? (
                <Link
                  aria-label="이전 페이지"
                  className="btn btn-sm btn-ghost"
                  href={adminOrdersHref(data.filters, { orderId: null, page: data.filters.page - 1 })}
                >
                  이전
                </Link>
              ) : <span />}
              <span aria-live="polite">{data.filters.page} / {totalPages} 페이지</span>
              {data.filters.page < totalPages ? (
                <Link
                  aria-label="다음 페이지"
                  className="btn btn-sm btn-ghost"
                  href={adminOrdersHref(data.filters, { orderId: null, page: data.filters.page + 1 })}
                >
                  다음
                </Link>
              ) : <span />}
            </nav>
          ) : null}
        </aside>
        {selected ? <OrderDetail order={selected} /> : null}
      </div>
    </section>
  );
}
