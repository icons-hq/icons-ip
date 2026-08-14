'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';
import {
  approveAdminOrderCancellationAction,
  recoverAdminGoodsPaymentAction,
  reconcileAdminOrderCancellationAction,
  rejectAdminOrderCancellationAction,
  updateAdminOrderStatusAction,
  updateAdminOrderTrackingAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';
import {
  ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS,
  adminOrdersHref,
  isKorpayManualRecoveryState,
  type AdminOrderCancellationRequestRecord,
  type AdminOrderConsoleData,
  type AdminOrderFilters,
  type AdminOrderRecord,
  type OrderCancellationRequestStatus,
} from '@/lib/admin/orders';
import {
  formatOrderDateTime,
  ORDER_WITHDRAWAL_DEADLINE_LABELS,
  ORDER_WITHDRAWAL_REASON_LABELS,
  orderReferenceLabel,
  orderStatusMeta,
  paymentStatusLabel,
  refundStatusLabel,
  type OrderWithdrawalReasonType,
} from '@/lib/orders';
import { SHIPPING_CARRIERS, type OrderShipment } from '@/lib/orders/shipment';
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

const GOODS_PAYMENT_ATTEMPT_STATE_LABELS: Record<
  NonNullable<AdminOrderRecord['manualRecoveryAttempt']>['state'],
  string
> = {
  prepared: '결제 준비',
  confirming: '승인 확인 중',
  approved: '승인 완료',
  declined: '승인 거절',
  canceled: '취소 완료',
  unknown: '결과 불명',
  needs_review: '운영 확인 필요',
};

/** 사유 배지. 하자·오배송은 기한과 배송비 부담이 달라 색으로도 구분한다. */
function CancellationReasonBadge({
  className,
  reasonType,
}: {
  className?: string;
  reasonType: OrderWithdrawalReasonType;
}) {
  return (
    <span className={`${className ? `${className} ` : ''}admin-order-reason admin-order-reason--${reasonType}`}>
      {ORDER_WITHDRAWAL_REASON_LABELS[reasonType]}
    </span>
  );
}

/** 승인·거절 판단이 남은 요청. 종결된 요청까지 목록에 표시하면 미처리 건과 섞인다. */
const OPEN_CANCELLATION_STATUSES = new Set<OrderCancellationRequestStatus>([
  'requested',
  'processing',
  'needs_review',
]);

function openCancellationRequest(order: AdminOrderRecord) {
  const request = order.cancellationRequest;
  return request && OPEN_CANCELLATION_STATUSES.has(request.status) ? request : null;
}

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

function CarrierSelect({
  defaultValue,
  describedBy,
  disabled,
  id,
}: {
  defaultValue?: string;
  describedBy?: string;
  disabled: boolean;
  id: string;
}) {
  return (
    <select
      aria-describedby={describedBy}
      defaultValue={defaultValue ?? ''}
      disabled={disabled}
      id={id}
      name="carrier"
      required
    >
      <option disabled value="">택배사 선택</option>
      {SHIPPING_CARRIERS.map((carrier) => (
        <option key={carrier.code} value={carrier.code}>{carrier.label}</option>
      ))}
    </select>
  );
}

function TrackingFields({
  errors,
  idPrefix,
  orderId,
  pending,
  shipment,
}: {
  errors: AdminOrderActionState['errors'];
  idPrefix: string;
  orderId: string;
  pending: boolean;
  shipment: OrderShipment | null;
}) {
  const carrierId = `${idPrefix}-carrier-${orderId}`;
  const trackingId = `${idPrefix}-tracking-${orderId}`;
  // 오류 span에 id를 주고 입력에 연결해야 스크린리더가 어느 필드가 틀렸는지 읽는다.
  const carrierErrorId = `${idPrefix}-carrier-error-${orderId}`;
  const trackingErrorId = `${idPrefix}-tracking-error-${orderId}`;

  return (
    <div className="admin-order-tracking-fields">
      <label htmlFor={carrierId}>택배사</label>
      <CarrierSelect
        defaultValue={shipment?.carrier}
        describedBy={errors?.carrier ? carrierErrorId : undefined}
        disabled={pending}
        id={carrierId}
      />
      {errors?.carrier ? <span id={carrierErrorId} role="alert">{errors.carrier}</span> : null}
      <label htmlFor={trackingId}>운송장번호</label>
      <input
        aria-describedby={errors?.trackingNumber ? trackingErrorId : undefined}
        defaultValue={shipment?.trackingNumber ?? ''}
        disabled={pending}
        id={trackingId}
        inputMode="numeric"
        maxLength={30}
        name="trackingNumber"
        placeholder="하이픈 없이 입력"
        required
        type="text"
      />
      {errors?.trackingNumber ? (
        <span id={trackingErrorId} role="alert">{errors.trackingNumber}</span>
      ) : null}
    </div>
  );
}

function OrderStatusAction({
  label,
  orderId,
  shipment,
  status,
}: {
  label: string;
  orderId: string;
  shipment: OrderShipment | null;
  status: 'shipping' | 'done';
}) {
  const [state, action, pending] = useActionState(updateAdminOrderStatusAction, EMPTY_ACTION_STATE);
  const confirmation = status === 'shipping'
    ? '입력한 택배사·운송장번호로 배송을 시작할까요? 고객 주문 상세에 그대로 노출됩니다.'
    : '주문을 배송 완료 처리할까요?';

  return (
    <form
      action={action}
      className={status === 'shipping'
        ? 'admin-order-action-form admin-order-shipment-form'
        : 'admin-order-action-form'}
      data-confirm={confirmation}
      onSubmit={(event) => confirmAction(event, confirmation)}
    >
      <input name="orderId" type="hidden" value={orderId} />
      <input name="status" type="hidden" value={status} />
      {/* 운송장 없이 배송을 시작하면 고객이 추적할 수 없다. DB도 같은 조건으로 거절한다. */}
      {status === 'shipping' ? (
        <TrackingFields
          errors={state.errors}
          idPrefix="admin-order"
          orderId={orderId}
          pending={pending}
          shipment={shipment}
        />
      ) : null}
      <button className="btn btn-sm" disabled={pending} type="submit">
        {pending ? '처리 중' : label}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

function UpdateTrackingForm({
  orderId,
  shipment,
}: {
  orderId: string;
  shipment: OrderShipment | null;
}) {
  const [state, action, pending] = useActionState(updateAdminOrderTrackingAction, EMPTY_ACTION_STATE);
  const confirmation = '운송장번호를 수정할까요? 변경 이력이 감사 로그에 남습니다.';

  return (
    <form
      action={action}
      className="admin-order-action-form admin-order-shipment-form"
      data-confirm={confirmation}
      onSubmit={(event) => confirmAction(event, confirmation)}
    >
      <input name="orderId" type="hidden" value={orderId} />
      <TrackingFields
        errors={state.errors}
        idPrefix="admin-order-edit"
        orderId={orderId}
        pending={pending}
        shipment={shipment}
      />
      <button className="btn btn-sm btn-ghost" disabled={pending} type="submit">
        {pending ? '저장 중' : '운송장 수정'}
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
  preparedKorpay,
  request,
}: {
  preparedKorpay?: {
    amount: number;
    currency: string;
    providerOrderId: string;
  };
  request: AdminOrderCancellationRequestRecord;
}) {
  const [state, action, pending] = useActionState(reconcileAdminOrderCancellationAction, EMPTY_ACTION_STATE);
  const confirmation = preparedKorpay
    ? `Korpay 주문 ${preparedKorpay.providerOrderId} · ₩${preparedKorpay.amount.toLocaleString('ko-KR')} ${preparedKorpay.currency} 결제 세션의 만료를 확인할까요? 이미 만료됐다면 주문 취소와 재고 복원이 즉시 완료됩니다.`
    : '결제 취소 상태를 다시 확인할까요?';
  const label = preparedKorpay
    ? 'Korpay 만료·취소 처리'
    : request.status === 'processing' ? '처리 상태 확인' : '상태 다시 확인';

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

function ManualKorpayCancellationForm({
  amount,
  attemptId,
  currency,
  providerOrderId,
  requestId,
}: {
  amount: number;
  attemptId: string;
  currency: string;
  providerOrderId: string;
  requestId: string;
}) {
  const [state, action, pending] = useActionState(
    recoverAdminGoodsPaymentAction,
    EMPTY_ACTION_STATE,
  );
  const attestationRef = useRef<HTMLInputElement>(null);
  const confirmation = `Korpay 주문 ${providerOrderId} · ₩${amount.toLocaleString('ko-KR')} ${currency}의 전액 취소 완료를 원장에서 확인했습니다. 반영하면 확인된 결제에는 환불 원장을 남기고, 주문 취소와 재고 복원을 즉시 완료합니다. 계속할까요?`;
  const attestationId = `admin-korpay-cancel-attestation-${attemptId}`;
  const attestationErrorId = `admin-korpay-cancel-attestation-error-${attemptId}`;
  const attestationError = state.errors?.operatorAttestation;

  useEffect(() => {
    if (attestationError) attestationRef.current?.focus();
  }, [attestationError]);

  return (
    <form
      action={action}
      className="admin-order-korpay-recovery-form"
      data-confirm={confirmation}
      onSubmit={(event) => confirmAction(event, confirmation)}
    >
      <input name="attemptId" type="hidden" value={attemptId} />
      <input name="requestId" type="hidden" value={requestId} />
      <label htmlFor={attestationId}>
        <input
          aria-describedby={attestationError ? attestationErrorId : undefined}
          aria-invalid={attestationError ? true : undefined}
          disabled={pending}
          id={attestationId}
          name="operatorAttestation"
          ref={attestationRef}
          required
          type="checkbox"
          value="provider_cancel_confirmed"
        />
        <span>표시된 Korpay 주문번호와 금액의 전액 취소 완료를 원장에서 확인했습니다.</span>
      </label>
      <button
        className="btn btn-sm admin-order-korpay-recovery-submit"
        disabled={pending}
        type="submit"
      >
        {pending ? '반영 중' : 'Korpay 전액 취소 반영'}
      </button>
      {attestationError ? (
        <span
          className="admin-order-korpay-recovery-error"
          id={attestationErrorId}
          role="alert"
        >
          {attestationError}
        </span>
      ) : null}
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
  const hasShipped = order.status === 'shipping' || order.status === 'done';
  const manualRecoveryAttempt = order.manualRecoveryAttempt
    && cancellationRequest
    && order.manualRecoveryAttempt.requestId === cancellationRequest.id
    && (cancellationRequest.status === 'processing' || cancellationRequest.status === 'needs_review')
    ? order.manualRecoveryAttempt
    : null;
  const usesKorpayManualRecovery = manualRecoveryAttempt
    ? isKorpayManualRecoveryState(manualRecoveryAttempt.state)
    : false;

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
          <div className="admin-order-cancellation-reason">
            <CancellationReasonBadge reasonType={cancellationRequest.reasonType} />
            <small>
              {ORDER_WITHDRAWAL_DEADLINE_LABELS[cancellationRequest.reasonType]}
              {/* 반송은 배송이 시작된 주문에서만 일어난다. 미출고 건에 부담 주체를
                  띄우면 존재하지 않는 사건을 판단 근거로 제시하게 된다. */}
              {hasShipped
                ? ` · ${ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS[cancellationRequest.reasonType]}`
                : ''}
            </small>
          </div>
          {cancellationRequest.decisionNote ? (
            <p>처리 메모 · {cancellationRequest.decisionNote}</p>
          ) : null}
          {manualRecoveryAttempt ? (
            <>
              <h4 className="admin-order-korpay-title">Korpay 원장 확인 정보</h4>
              <dl className="admin-order-summary admin-order-korpay-summary">
                <div>
                  <dt>Korpay 주문번호</dt>
                  <dd className="mono">{manualRecoveryAttempt.providerOrderId}</dd>
                </div>
                <div>
                  <dt>결제 시도 ID</dt>
                  <dd className="mono">{manualRecoveryAttempt.attemptId}</dd>
                </div>
                <div>
                  <dt>시도 상태</dt>
                  <dd>{GOODS_PAYMENT_ATTEMPT_STATE_LABELS[manualRecoveryAttempt.state]}</dd>
                </div>
                <div>
                  <dt>원장 확인 금액</dt>
                  <dd>₩{manualRecoveryAttempt.amount.toLocaleString('ko-KR')} · {manualRecoveryAttempt.currency}</dd>
                </div>
              </dl>
              {usesKorpayManualRecovery && !manualRecoveryAttempt.manualRecoveryAvailable ? (
                <p>현재 결제 처리 또는 다른 운영 확인이 진행 중입니다.</p>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <div className="admin-order-actions">
        {canAdvanceOrderStatus && order.status === 'paid' ? (
          <OrderStatusAction
            label="배송 시작"
            orderId={order.id}
            shipment={order.shipment}
            status="shipping"
          />
        ) : null}
        {canAdvanceOrderStatus && order.status === 'shipping' ? (
          <OrderStatusAction
            label="배송 완료"
            orderId={order.id}
            shipment={order.shipment}
            status="done"
          />
        ) : null}
        {order.status === 'shipping' || order.status === 'done' ? (
          <UpdateTrackingForm orderId={order.id} shipment={order.shipment} />
        ) : null}
        {cancellationRequest?.status === 'requested' ? (
          <>
            <ApproveCancellationForm orderStatus={order.status} requestId={cancellationRequest.id} />
            <RejectCancellationForm requestId={cancellationRequest.id} />
          </>
        ) : null}
        {(cancellationRequest?.status === 'processing' || cancellationRequest?.status === 'needs_review')
          && !usesKorpayManualRecovery ? (
          <ReconcileCancellationForm
            preparedKorpay={manualRecoveryAttempt?.state === 'prepared'
              ? {
                  amount: manualRecoveryAttempt.amount,
                  currency: manualRecoveryAttempt.currency,
                  providerOrderId: manualRecoveryAttempt.providerOrderId,
                }
              : undefined}
            request={cancellationRequest}
          />
        ) : null}
        {manualRecoveryAttempt?.manualRecoveryAvailable ? (
          <ManualKorpayCancellationForm
            amount={manualRecoveryAttempt.amount}
            attemptId={manualRecoveryAttempt.attemptId}
            currency={manualRecoveryAttempt.currency}
            providerOrderId={manualRecoveryAttempt.providerOrderId}
            requestId={manualRecoveryAttempt.requestId}
          />
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
          {data.items.map((order) => {
            const openRequest = openCancellationRequest(order);
            return (
            <Link
              aria-current={selected?.id === order.id ? 'true' : undefined}
              /* aria-label이 행 내용을 덮어쓰므로 사유 배지를 이름에도 넣는다. 넣지
                 않으면 스크린리더 사용자에게만 사유가 사라진다. */
              aria-label={`주문 ${orderReferenceLabel(order.id)} 선택${
                openRequest ? ` · 청약철회 ${ORDER_WITHDRAWAL_REASON_LABELS[openRequest.reasonType]}` : ''
              }`}
              className={selected?.id === order.id ? 'admin-order-row on' : 'admin-order-row'}
              href={adminOrdersHref(data.filters, { orderId: order.id })}
              key={order.id}
            >
              <span className={`order-status order-status--${order.status}`}>{orderStatusMeta(order.status).label}</span>
              <strong>@{order.buyerName}</strong>
              <span className="faint mono">{orderReferenceLabel(order.id)}</span>
              <span className="admin-order-row-total">{formatKrw(order.total)}</span>
              {openRequest ? (
                <CancellationReasonBadge
                  className="admin-order-row-reason"
                  reasonType={openRequest.reasonType}
                />
              ) : null}
            </Link>
            );
          })}
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
