'use client';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';

import Link from 'next/link';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import {
  approveAdminOrderCancellationAction,
  bulkConfirmAdminOrdersAction,
  recoverAdminGoodsPaymentAction,
  reconcileAdminOrderCancellationAction,
  rejectAdminOrderCancellationAction,
  startAdminOrderCancellationAction,
  updateAdminOrderStatusAction,
  updateAdminOrderTrackingAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';
import {
  ADMIN_CANCELLATION_RECHECK_LABELS,
  ADMIN_ORDER_STATUSES,
  ADMIN_ORDER_SEARCH_FIELDS,
  ADMIN_ORDER_STATUS_LABELS,
  ADMIN_STAFF_CANCELLATION_NOTE_LIMIT,
  ADMIN_STAFF_CANCELLATION_REASONS,
  ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS,
  adminOrderDetailHref,
  adminOrderSearchHref,
  adminStaffCancellationAvailability,
  adminOrdersHref,
  isKorpayManualRecoveryState,
  isLegacyDecidableCancellation,
  normalizeAdminStaffCancellationForm,
  type AdminOrderCancellationRequestRecord,
  type AdminOrderConsoleData,
  type AdminOrderFieldErrors,
  type AdminOrderFilters,
  type AdminOrderFormStatus,
  type AdminOrderRecord,
} from '@/lib/admin/orders';
import {
  formatOrderDateTime,
  ORDER_WITHDRAWAL_DEADLINE_LABELS,
  orderReferenceLabel,
  orderStatusMeta,
  paymentStatusLabel,
  refundStatusLabel,
} from '@/lib/orders';
import { adminClaimReasonText } from '@/lib/admin/claims';
import {
  isOpenOrderClaimStage,
  ORDER_CLAIM_STAGE_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  ORDER_CLAIM_TYPE_SLUGS,
} from '@/lib/orders/claims';
import {
  orderShipment,
  selectableShippingCarriers,
  type OrderShipment,
  type ShippingCarrierRegistry,
} from '@/lib/orders/shipment';
import { formatKrwExact } from '../format';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { isParcelShipment } from '@/lib/admin/shipment-dispatch';
import { DELIVERY_METHOD_LABELS, deliveryStatusLabel } from '@/lib/shipment-delivery';
import { adminListExportHref } from '@/lib/admin/list-export';
import { AdminListExportButton } from '@/components/admin/AdminListExportButton';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { SALES_DATE_FIELDS } from '@/lib/admin/sales-list';
import { SalesFilterField, SalesFilterPanel, SalesGuide, SalesResultsHeader, SalesSelect, SalesStatusSummary } from '@/components/admin/sales/SalesConsole';
import { SellerClaimIntakeButton } from '@/components/admin/screens/SellerClaimIntakeForm';
import { OrderViewTabs } from '@/components/admin/sales/OrderViewTabs';

/* 사다리 순서 그대로 둔다 — 드롭다운 순서가 운영자에게는 단계 순서다(#250).
   문구는 ADMIN_ORDER_STATUS_LABELS에서 가져온다. 여기에 다시 적으면 일괄 등록
   실패 리포트가 쓰는 말과 갈라진다(#251). */
const STATUS_OPTIONS: Array<{ value: AdminOrderFilters['status']; label: string }> = [
  { value: 'all', label: '전체 상태' },
  ...ADMIN_ORDER_STATUSES.map((status) => ({
    value: status,
    label: ADMIN_ORDER_STATUS_LABELS[status],
  })),
];

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

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

/**
 * 사유 배지. 하자·오배송은 기한과 배송비 부담이 달라 색으로도 구분한다. 운영자 전액
 * 취소는 구매자 단순 변심과 섞지 않고 운영 사유를 적는다(2026-10-12 QA-4).
 */
function CancellationReasonBadge({
  className,
  request,
}: {
  className?: string;
  request: Pick<AdminOrderCancellationRequestRecord, 'reasonType' | 'staffReasonCode'>;
}) {
  return (
    <span className={`${className ? `${className} ` : ''}admin-order-reason admin-order-reason--${request.reasonType}`}>
      {adminClaimReasonText(request.reasonType, request.staffReasonCode)}
    </span>
  );
}

/** 목록 행 이름에 붙는 사유. 구매자 사유만 "청약철회"다. */
function cancellationReasonAccessibleName(
  request: Pick<AdminOrderCancellationRequestRecord, 'reasonType' | 'staffReasonCode'>,
) {
  const label = adminClaimReasonText(request.reasonType, request.staffReasonCode);
  return request.reasonType === 'staff' ? label : `청약철회 ${label}`;
}

/** 처리가 남은 클레임. 종결된 요청까지 목록에 표시하면 미처리 건과 섞인다. */
function openCancellationRequest(order: AdminOrderRecord) {
  const request = order.cancellationRequest;
  return request && isOpenOrderClaimStage(request.stage) ? request : null;
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

/*
 * 취소 처리 결과(2차 재검토 C2-1).
 *
 * 청약철회 승인·거절, 처리 상태 재확인, 운영자 전액 취소, Korpay 반영은 결과가 나오는
 * 순간 그 양식을 그리던 조건(요청 단계·주문 상태)이 바뀐다. 서버 액션의 revalidatePath가
 * 같은 응답에 새 주문 패널을 실어 오므로, 결과를 양식 안에 그리면 양식과 함께 사라진다 —
 * 운영자는 결과 코드도 "주문과 재고는 그대로"도 재시도 위치도 보지 못한다. 상태 필터로
 * 보던 목록에서는 주문 자체가 빠지기도 한다.
 *
 * 그래서 다섯 액션을 주문 콘솔 수준의 useActionState 하나로 묶고, 결과에 어느 주문의
 * 어떤 액션인지 붙여 양식 밖에 그린다. 묶인 액션은 한 번에 하나만 돈다 — 결제사 취소가
 * 도는 동안 다른 취소 처리를 누르지 못한다.
 */
const ORDER_CANCELLATION_ACTIONS = {
  approve: approveAdminOrderCancellationAction,
  reject: rejectAdminOrderCancellationAction,
  reconcile: reconcileAdminOrderCancellationAction,
  staffCancel: startAdminOrderCancellationAction,
  korpayRecovery: recoverAdminGoodsPaymentAction,
} as const;
type OrderCancellationIntent = keyof typeof ORDER_CANCELLATION_ACTIONS;

export interface OrderCancellationActionState extends AdminOrderActionState {
  intent?: OrderCancellationIntent;
  orderId?: string;
}

const EMPTY_CANCELLATION_STATE: OrderCancellationActionState = {};

function isOrderCancellationIntent(value: unknown): value is OrderCancellationIntent {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ORDER_CANCELLATION_ACTIONS, value);
}

/** 양식이 고른 취소 액션을 실행하고 결과에 액션과 주문을 붙인다. 주문 id는 표시 범위에만 쓴다. */
export async function runOrderCancellationAction(
  _previous: OrderCancellationActionState,
  formData: FormData,
): Promise<OrderCancellationActionState> {
  const intent = formData.get('cancellationIntent');
  const orderId = String(formData.get('cancellationOrderId') ?? '');
  if (!isOrderCancellationIntent(intent)) {
    return { errors: { form: '처리할 작업을 확인하지 못했습니다. 새로고침한 뒤 다시 시도해주세요.' }, orderId };
  }
  const result = await ORDER_CANCELLATION_ACTIONS[intent](EMPTY_ACTION_STATE, formData);
  return { ...result, intent, orderId };
}

type CancellationFormValidator = (formData: FormData) => AdminOrderFieldErrors | null;

/*
 * 취소 처리 양식의 React action 자리. 아무것도 보내지 않는다.
 *
 * 서버 렌더는 이 자리가 있어야 하이드레이션 전 제출을 페이지 이동(입력값이 주소에 실린
 * GET)으로 보내지 않는다. 대신 React는 그 제출을 담아 두었다가 하이드레이션 뒤 이 action으로
 * 재생하는데, 그 경로는 입력 검사와 확인 창을 거치지 않는다. 되돌릴 수 없는 결제 취소가
 * 확인 없이 나가지 않도록 재생된 제출은 버린다 — 운영자는 화면이 준비된 뒤 다시 누른다.
 */
function ignoreUnconfirmedCancellationSubmit() {}

interface OrderCancellationConsole {
  state: OrderCancellationActionState;
  /*
   * 양식의 React action 자리. 실제 전송은 아래 submit(검사 → 확인 → 전송)이 한다 —
   * ignoreUnconfirmedCancellationSubmit 참고.
   */
  action: () => void;
  pending: boolean;
  /** 확인 창을 통과해 보낸 마지막 취소 액션. "처리 중" 라벨을 그 양식에만 붙인다. */
  submitted: { intent: OrderCancellationIntent; orderId: string } | null;
  /** 확인 창 전에 잡힌 입력 오류. 서버를 부르지 않았으므로 서버 결과와 따로 둔다. */
  clientErrors: { intent: OrderCancellationIntent; orderId: string; errors: AdminOrderFieldErrors } | null;
  submit: (
    event: React.FormEvent<HTMLFormElement>,
    confirmation: string,
    intent: OrderCancellationIntent,
    orderId: string,
    validate?: CancellationFormValidator,
  ) => void;
}

export type OrderCancellationSubmitPlan =
  | { kind: 'invalid'; errors: AdminOrderFieldErrors }
  | { kind: 'dismissed' }
  | { kind: 'dispatch' };

/**
 * 취소 처리 양식 제출 순서(2026-10-12 브라우저 QA QA-5).
 *
 * 입력 검사가 확인 창보다 먼저다. "되돌릴 수 없다"를 승인받은 뒤에 입력 오류로 돌려보내면
 * 운영자는 이미 실행했다고 믿는다. 확인을 통과하면 React 양식 action을 거치지 않고 직접
 * 보낸다 — 양식 action은 끝나면 비제어 입력을 초기화해서, 서버가 거절해도 운영자가 고른
 * 사유·메모가 비워진다.
 */
export function planOrderCancellationSubmit(
  formData: FormData,
  confirmation: string,
  confirm: (message: string) => boolean,
  validate?: CancellationFormValidator,
): OrderCancellationSubmitPlan {
  const errors = validate?.(formData) ?? null;
  if (errors && Object.keys(errors).length) return { kind: 'invalid', errors };
  return confirm(confirmation) ? { kind: 'dispatch' } : { kind: 'dismissed' };
}

/**
 * 운영자 전액 취소 입력 검사. 서버 액션과 같은 규칙(normalizeAdminStaffCancellationForm)에
 * 화면만 아는 조건 — 출고지시가 나간 배송 건의 창고 중단 확인 — 을 더한다.
 */
export function staffCancellationClientErrors(
  formData: FormData,
  requiresWarehouseStop: boolean,
): AdminOrderFieldErrors | null {
  const normalized = normalizeAdminStaffCancellationForm(formData);
  const errors: AdminOrderFieldErrors = normalized.ok ? {} : { ...normalized.errors };
  if (requiresWarehouseStop && formData.get('warehouseStopConfirmed') !== 'confirmed') {
    errors.warehouseStopConfirmed = '창고에 출고 중단을 확인한 뒤 확인란을 체크해주세요.';
  }
  return Object.keys(errors).length ? errors : null;
}

/** 한 양식이 볼 결과 조각. 필드 오류는 그 양식이 보낸 결과일 때만 붙인다. */
function cancellationFormView(
  cancellation: OrderCancellationConsole,
  intent: OrderCancellationIntent,
  orderId: string,
) {
  const { clientErrors, pending, state, submitted } = cancellation;
  const local = clientErrors?.intent === intent && clientErrors.orderId === orderId ? clientErrors.errors : undefined;
  return {
    errors: local ?? (state.intent === intent && state.orderId === orderId ? state.errors : undefined),
    pending,
    running: pending && submitted?.intent === intent && submitted.orderId === orderId,
  };
}

function CancellationIntentFields({ intent, orderId }: { intent: OrderCancellationIntent; orderId: string }) {
  return (
    <>
      <input name="cancellationIntent" type="hidden" value={intent} />
      <input name="cancellationOrderId" type="hidden" value={orderId} />
    </>
  );
}

function CancellationResultBody({ state }: { state: OrderCancellationActionState }) {
  return (
    <div className="admin-order-action-feedback">
      {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
      {state.message ? <span role="status">{state.message}</span> : null}
    </div>
  );
}

function hasCancellationResult(state: OrderCancellationActionState) {
  return Boolean(state.orderId && (state.errors?.form || state.message));
}

/** 주문 패널의 취소 처리 결과. 처리 버튼이 사라진 뒤에도 그 주문 패널에 남는다. */
function OrderCancellationResult({ orderId, state }: { orderId: string; state: OrderCancellationActionState }) {
  return (
    <div aria-live="polite">
      {state.orderId === orderId && hasCancellationResult(state) ? (
        <section aria-label="취소 처리 결과" className="admin-order-cancellation-result">
          <p>취소 처리 결과</p>
          <CancellationResultBody state={state} />
        </section>
      ) : null}
    </div>
  );
}

/**
 * 택배사 드롭다운.
 *
 * 목록은 DB 레지스트리에서 온다(#251). 비활성 택배사는 뺀다 — 고를 수 있는데
 * 저장이 거절되는 선택지는 운영자에게 원인 없는 실패로 보인다. 이미 그 택배사로
 * 나간 주문의 조회 링크는 별개로 살아 있다.
 */
function CarrierSelect({
  carriers,
  defaultValue,
  describedBy,
  disabled,
  id,
}: {
  carriers: ShippingCarrierRegistry;
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
      {selectableShippingCarriers(carriers).map((carrier) => (
        <option key={carrier.code} value={carrier.code}>{carrier.label}</option>
      ))}
    </select>
  );
}

function TrackingFields({
  carriers,
  errors,
  idPrefix,
  orderId,
  pending,
  shipment,
}: {
  carriers: ShippingCarrierRegistry;
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
        carriers={carriers}
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

/* 거래확정(done)은 자동 잡이 소유한다 — 여기 버튼으로 미는 칸이 아니다. */
const STATUS_ACTION_CONFIRMATIONS: Record<AdminOrderFormStatus, string> = {
  confirmed: '주문을 발주확인 처리할까요? 이후 발송처리 단계로 넘어갑니다.',
  shipping: '입력한 택배사·운송장번호로 배송을 시작할까요? 고객 주문 상세에 그대로 노출됩니다.',
  delivered: '주문을 배송완료로 변경할까요? 이 시점부터 청약철회 기한이 시작됩니다.',
};

function OrderStatusAction({
  carriers,
  label,
  orderId,
  shipment,
  status,
}: {
  carriers: ShippingCarrierRegistry;
  label: string;
  orderId: string;
  shipment: OrderShipment | null;
  status: AdminOrderFormStatus;
}) {
  const [state, action, pending] = useActionState(updateAdminOrderStatusAction, EMPTY_ACTION_STATE);
  const confirmation = STATUS_ACTION_CONFIRMATIONS[status];

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
          carriers={carriers}
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
  carriers,
  orderId,
  shipmentId,
  shipment,
}: {
  carriers: ShippingCarrierRegistry;
  orderId: string;
  shipmentId: string;
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
      <input name="shipmentId" type="hidden" value={shipmentId} />
      <TrackingFields
        carriers={carriers}
        errors={state.errors}
        idPrefix={`admin-order-edit-${shipmentId}`}
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
  cancellation,
  orderId,
  orderStatus,
  requestId,
}: {
  cancellation: OrderCancellationConsole;
  orderId: string;
  orderStatus: AdminOrderRecord['status'];
  requestId: string;
}) {
  const { pending, running } = cancellationFormView(cancellation, 'approve', orderId);
  // 반품 입고 확인은 별도 상태가 아니라 승인 행위에 내포된다(D11). 배송이 나간 주문은
  // 승인 즉시 결제가 취소되고 재고가 복원되므로 확인 문구로 그 전제를 묻는다.
  const confirmation = orderStatus === 'shipping' || orderStatus === 'done'
    ? '반품 물건 입고를 확인하셨나요? 승인하면 결제 취소와 재고 복원이 진행됩니다.'
    : '청약철회를 승인하고 결제 취소를 시작할까요?';

  return (
    <form
      action={cancellation.action}
      className="admin-order-action-form"
      data-confirm={confirmation}
      onSubmit={(event) => cancellation.submit(event, confirmation, 'approve', orderId)}
    >
      <CancellationIntentFields intent="approve" orderId={orderId} />
      <input name="requestId" type="hidden" value={requestId} />
      <button className="btn btn-sm" disabled={pending} type="submit">
        {running ? '승인 중' : '청약철회 승인'}
      </button>
    </form>
  );
}

function RejectCancellationForm({
  cancellation,
  orderId,
  requestId,
}: {
  cancellation: OrderCancellationConsole;
  orderId: string;
  requestId: string;
}) {
  const { errors, pending, running } = cancellationFormView(cancellation, 'reject', orderId);
  const confirmation = '청약철회 요청을 거절할까요? 입력한 사유가 기록됩니다.';

  return (
    <form
      action={cancellation.action}
      className="admin-order-reject-form"
      data-confirm={confirmation}
      onSubmit={(event) => cancellation.submit(event, confirmation, 'reject', orderId)}
    >
      <CancellationIntentFields intent="reject" orderId={orderId} />
      <input name="requestId" type="hidden" value={requestId} />
      <label htmlFor={`admin-order-reject-reason-${requestId}`}>거절 사유</label>
      <textarea
        aria-describedby={errors?.reason ? `admin-order-reject-error-${requestId}` : undefined}
        disabled={pending}
        id={`admin-order-reject-reason-${requestId}`}
        maxLength={200}
        minLength={10}
        name="reason"
        placeholder="거절 근거를 10자 이상 입력해주세요"
        required
        rows={3}
      />
      {errors?.reason ? (
        <span id={`admin-order-reject-error-${requestId}`} role="alert">{errors.reason}</span>
      ) : null}
      <button className="btn btn-sm btn-ghost" disabled={pending} type="submit">
        {running ? '거절 중' : '요청 거절'}
      </button>
    </form>
  );
}

function ReconcileCancellationForm({
  cancellation,
  orderId,
  preparedKorpay,
  request,
}: {
  cancellation: OrderCancellationConsole;
  orderId: string;
  preparedKorpay?: {
    amount: number;
    currency: string;
    providerOrderId: string;
  };
  request: AdminOrderCancellationRequestRecord;
}) {
  const { pending, running } = cancellationFormView(cancellation, 'reconcile', orderId);
  const confirmation = preparedKorpay
    ? `Korpay 주문 ${preparedKorpay.providerOrderId} · ₩${preparedKorpay.amount.toLocaleString('ko-KR')} ${preparedKorpay.currency} 결제 세션의 만료를 확인할까요? 이미 만료됐다면 주문 취소와 재고 복원이 즉시 완료됩니다.`
    : '결제 취소 상태를 다시 확인할까요?';
  const label = preparedKorpay
    ? ADMIN_CANCELLATION_RECHECK_LABELS.preparedKorpay
    : request.status === 'processing'
      ? ADMIN_CANCELLATION_RECHECK_LABELS.processing
      : ADMIN_CANCELLATION_RECHECK_LABELS.needsReview;

  return (
    <form
      action={cancellation.action}
      className="admin-order-action-form"
      data-confirm={confirmation}
      onSubmit={(event) => cancellation.submit(event, confirmation, 'reconcile', orderId)}
    >
      <CancellationIntentFields intent="reconcile" orderId={orderId} />
      <input name="requestId" type="hidden" value={request.id} />
      <button className="btn btn-sm" disabled={pending} type="submit">
        {running ? '확인 중' : label}
      </button>
    </form>
  );
}

/**
 * 운영자 전액 취소(ADR-0018).
 *
 * 발송 전 주문의 결제 전액을 바로 취소한다 — 누르면 DB가 사유와 함께 취소 요청을
 * 열고 서버가 토스 전액 취소를 발행·확인한 뒤 주문·재고·쿠폰·적립금을 정리한다.
 * 출고지시 파일이 나간 배송 건이 있으면 창고 출고 중단 확인을 체크해야 한다.
 * 결과가 나오면 이 양식은 사라진다(요청이 생기거나 주문이 취소된다) — 결과는
 * 주문 패널의 취소 처리 결과에 남는다.
 */
function StaffCancellationForm({
  cancellation,
  orderId,
  requiresWarehouseStop,
}: {
  cancellation: OrderCancellationConsole;
  orderId: string;
  requiresWarehouseStop: boolean;
}) {
  const { errors, pending, running } = cancellationFormView(cancellation, 'staffCancel', orderId);
  const confirmation = '이 주문 전체를 취소하고 결제 금액 전액을 결제사에서 취소할까요? 되돌릴 수 없고 구매자에게 취소 알림이 갑니다.';
  const reasonId = `admin-order-staff-cancel-reason-${orderId}`;
  const noteId = `admin-order-staff-cancel-note-${orderId}`;
  const stopId = `admin-order-staff-cancel-stop-${orderId}`;

  return (
    <form
      action={cancellation.action}
      aria-label="운영자 전액 취소"
      className="admin-order-reject-form admin-order-staff-cancel-form"
      data-confirm={confirmation}
      noValidate
      onSubmit={(event) => cancellation.submit(
        event,
        confirmation,
        'staffCancel',
        orderId,
        (formData) => staffCancellationClientErrors(formData, requiresWarehouseStop),
      )}
    >
      <CancellationIntentFields intent="staffCancel" orderId={orderId} />
      <input name="orderId" type="hidden" value={orderId} />
      <label htmlFor={reasonId}>
        운영자 전액 취소 사유
        <select
          aria-describedby={errors?.reasonCode ? `${reasonId}-error` : undefined}
          aria-invalid={errors?.reasonCode ? true : undefined}
          defaultValue=""
          disabled={pending}
          id={reasonId}
          name="reasonCode"
          required
        >
          <option disabled value="">사유를 선택해주세요</option>
          {ADMIN_STAFF_CANCELLATION_REASONS.map((reason) => (
            <option key={reason.value} value={reason.value}>{reason.label}</option>
          ))}
        </select>
      </label>
      {errors?.reasonCode ? <span id={`${reasonId}-error`} role="alert">{errors.reasonCode}</span> : null}
      <label htmlFor={noteId}>메모 (기타는 필수 · 구매자에게 보이지 않습니다)</label>
      <textarea
        aria-describedby={errors?.note ? `${noteId}-error` : undefined}
        aria-invalid={errors?.note ? true : undefined}
        disabled={pending}
        id={noteId}
        maxLength={ADMIN_STAFF_CANCELLATION_NOTE_LIMIT}
        name="note"
        placeholder="예: 창고 실재고 0개 확인, 1:1 문의 #123 고객 취소 요청"
        rows={2}
      />
      {errors?.note ? <span id={`${noteId}-error`} role="alert">{errors.note}</span> : null}
      {requiresWarehouseStop ? (
        <label htmlFor={stopId}>
          <input
            aria-describedby={errors?.warehouseStopConfirmed ? `${stopId}-error` : undefined}
            aria-invalid={errors?.warehouseStopConfirmed ? true : undefined}
            disabled={pending}
            id={stopId}
            name="warehouseStopConfirmed"
            required
            type="checkbox"
            value="confirmed"
          />
          {' '}출고지시 파일이 나간 배송 건이 있습니다. 창고에 출고 중단을 확인했습니다.
        </label>
      ) : null}
      {errors?.warehouseStopConfirmed ? (
        <span id={`${stopId}-error`} role="alert">{errors.warehouseStopConfirmed}</span>
      ) : null}
      <small>
        발송 전 주문의 결제 금액 전액을 바로 취소합니다. 품절·출고 불가, 1:1 문의로 받은 취소 요청, 라이브 전환 전 심사용 테스트 결제 정리에 씁니다.
      </small>
      <button className="btn btn-sm btn-ghost" disabled={pending} type="submit">
        {running ? '취소 처리 중' : '전액 취소 실행'}
      </button>
    </form>
  );
}

function ManualKorpayCancellationForm({
  amount,
  attemptId,
  cancellation,
  currency,
  orderId,
  providerOrderId,
  requestId,
}: {
  amount: number;
  attemptId: string;
  cancellation: OrderCancellationConsole;
  currency: string;
  orderId: string;
  providerOrderId: string;
  requestId: string;
}) {
  const { errors, pending, running } = cancellationFormView(cancellation, 'korpayRecovery', orderId);
  const attestationRef = useRef<HTMLInputElement>(null);
  const confirmation = `Korpay 주문 ${providerOrderId} · ₩${amount.toLocaleString('ko-KR')} ${currency}의 전액 취소 완료를 원장에서 확인했습니다. 반영하면 확인된 결제에는 환불 원장을 남기고, 주문 취소와 재고 복원을 즉시 완료합니다. 계속할까요?`;
  const attestationId = `admin-korpay-cancel-attestation-${attemptId}`;
  const attestationErrorId = `admin-korpay-cancel-attestation-error-${attemptId}`;
  const attestationError = errors?.operatorAttestation;

  useEffect(() => {
    if (attestationError) attestationRef.current?.focus();
  }, [attestationError]);

  return (
    <form
      action={cancellation.action}
      className="admin-order-korpay-recovery-form"
      data-confirm={confirmation}
      onSubmit={(event) => cancellation.submit(event, confirmation, 'korpayRecovery', orderId)}
    >
      <CancellationIntentFields intent="korpayRecovery" orderId={orderId} />
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
        {running ? '반영 중' : 'Korpay 전액 취소 반영'}
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
    </form>
  );
}

function OrderFilters({ filters }: { filters: AdminOrderFilters }) {
  return (
    <SalesFilterPanel currentHref={adminOrdersHref(filters)} id="sales-orders"
      date={{ from: filters.from, to: filters.to, field: filters.dateField ?? 'ordered', options: SALES_DATE_FIELDS }}
      search={{ value: filters.query, field: filters.field, options: ADMIN_ORDER_SEARCH_FIELDS, placeholder: '검색어 입력' }}>
      <SalesFilterField label="주문상태" htmlFor="sales-orders-status">
        <SalesSelect id="sales-orders-status" name="status" value={filters.status} options={STATUS_OPTIONS} />
      </SalesFilterField>
      <SalesFilterField label="결제수단" htmlFor="sales-orders-payment">
        <SalesSelect id="sales-orders-payment" name="paymentMethod" value={filters.paymentMethod ?? ''}
          options={[{value:'',label:'전체'},{value:'card',label:'카드'},{value:'bank_transfer',label:'무통장 입금'}]} />
      </SalesFilterField>
    </SalesFilterPanel>
  );
}

function OrderDetail({
  cancellation,
  carriers,
  filters,
  order,
  canManage,
}: {
  cancellation: OrderCancellationConsole;
  carriers: ShippingCarrierRegistry;
  filters: AdminOrderFilters;
  order: AdminOrderRecord;
  canManage: boolean;
}) {
  const status = orderStatusMeta(order.status);
  const statusLabel = ADMIN_ORDER_STATUS_LABELS[order.status] ?? status.label;
  const cancellationRequest = order.cancellationRequest;
  /* 기한·반송비 부담은 구매자 청약철회 사유에만 있다. 운영자 전액 취소에는 없다. */
  const withdrawalReasonType = cancellationRequest && cancellationRequest.reasonType !== 'staff'
    ? cancellationRequest.reasonType
    : null;
  const canAdvanceOrderStatus = !cancellationRequest || cancellationRequest.status === 'rejected';
  /* 반송비 부담 주체는 실제로 물건이 나간 뒤에만 의미가 있다. 사다리가 늘어
     배송 이후 상태가 셋이 됐다(#250). */
  const hasShipped = order.status === 'shipping'
    || order.status === 'delivered'
    || order.status === 'done';
  const hasParcelShipment = !order.shipments.length || order.shipments.some(isParcelShipment);
  const manualRecoveryAttempt = order.manualRecoveryAttempt
    && cancellationRequest
    && order.manualRecoveryAttempt.requestId === cancellationRequest.id
    && (cancellationRequest.status === 'processing' || cancellationRequest.status === 'needs_review')
    ? order.manualRecoveryAttempt
    : null;
  const usesKorpayManualRecovery = manualRecoveryAttempt
    ? isKorpayManualRecoveryState(manualRecoveryAttempt.state)
    : false;
  const staffCancellation = adminStaffCancellationAvailability(order);

  return (
    <article aria-labelledby="admin-order-detail-title" className="admin-order-detail card">
      <header className="admin-order-detail-header">
        <div>
          <span className={`order-status order-status--${order.status}`}
            title={order.status === 'done' ? ADMIN_VOCABULARY.settledHint : undefined}
            data-admin-tooltip={order.status === 'done' ? ADMIN_VOCABULARY.settledHint : undefined}
            aria-label={order.status === 'done' ? `${statusLabel}: ${ADMIN_VOCABULARY.settledHint}` : undefined}
            tabIndex={order.status === 'done' ? 0 : undefined}>{statusLabel}</span>
          <h2 id="admin-order-detail-title">주문 {orderReferenceLabel(order.id)}</h2>
          <p className="faint mono">{order.id}</p>
          <Link
            className="btn btn-sm btn-ghost"
            href={adminOrderDetailHref(order.id, filters)}
            rel="noopener noreferrer"
            target="_blank"
          >
            상세 열기 (새 탭)
          </Link>
        </div>
        <strong>{formatKrwExact(order.total)}</strong>
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
              <div><strong>{item.name}</strong><span>{item.type}</span><GoodsCustomInputsSummary selection={item.customInputs} /></div>
              <span>{item.qty.toLocaleString('ko-KR')}개</span>
              <strong>{formatKrwExact(item.unitPrice * item.qty)}</strong>
            </div>
          ))}
        </div>
      </section>

      {order.address && (
        <section className="admin-order-detail-section" aria-labelledby="admin-order-address-title">
          <h3 id="admin-order-address-title">배송지</h3>
          {order.addressNeedsReview && <p role="status">주문 당시 주소 형식 확인이 필요합니다. 배송 처리 전 원본 기록과 수령 주소를 확인해주세요.</p>}
          <address className="admin-order-address">
            <strong>{order.address.recipientName}</strong>
            <span>{order.address.phone}</span>
            <span>[{order.address.postalCode}] {order.address.address1}</span>
            {order.address.address2 ? <span>{order.address.address2}</span> : null}
            {order.address.deliveryNote ? <small>배송 메모 · {order.address.deliveryNote}</small> : null}
          </address>
        </section>
      )}

      {canManage ? <section className="admin-order-detail-section" aria-labelledby="admin-order-payment-title">
        <h3 id="admin-order-payment-title">결제·환불</h3>
        <div className="admin-order-ledger">
          {order.payments.map((payment) => (
            <div key={payment.id}>
              <span>결제 · {paymentStatusLabel(payment.status)}</span>
              <span>{formatOrderDateTime(payment.createdAt)}</span>
              <strong>{formatKrwExact(payment.amount)}</strong>
            </div>
          ))}
          {order.refunds.map((refund) => (
            <div key={refund.id}>
              <span>환불 · {refundStatusLabel(refund.status)}</span>
              <span>{formatOrderDateTime(refund.createdAt)}</span>
              <strong>{formatKrwExact(refund.amount)}</strong>
            </div>
          ))}
          {!order.payments.length && !order.refunds.length ? <p className="muted">결제 기록이 없습니다.</p> : null}
        </div>
      </section> : null}

      {canManage && cancellationRequest ? (
        <section className="admin-order-cancellation" aria-labelledby="admin-order-cancellation-title">
          <div className="admin-order-cancellation-heading">
            <div>
              {/* 유형과 절차 단계를 그대로 쓴다. status 투영만 보이면 수거 중인
                  반품이 "청약철회 요청 · 요청 접수"로 표시된다(#252). */}
              <span>{ORDER_CLAIM_TYPE_LABELS[cancellationRequest.claimType]} 요청</span>
              <h3 id="admin-order-cancellation-title">
                {ORDER_CLAIM_STAGE_LABELS[cancellationRequest.stage]}
              </h3>
            </div>
            <time dateTime={cancellationRequest.requestedAt}>
              {formatOrderDateTime(cancellationRequest.requestedAt)}
            </time>
          </div>
          <div className="admin-order-cancellation-reason">
            <CancellationReasonBadge request={cancellationRequest} />
            <small>
              {withdrawalReasonType
                ? (
                  <>
                    {ORDER_WITHDRAWAL_DEADLINE_LABELS[withdrawalReasonType]}
                    {/* 반송은 배송이 시작된 주문에서만 일어난다. 미출고 건에 부담 주체를
                        띄우면 존재하지 않는 사건을 판단 근거로 제시하게 된다. */}
                    {hasShipped
                      ? ` · ${ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS[withdrawalReasonType]}`
                      : ''}
                  </>
                )
                : '운영자가 시작한 발송 전 전액 취소 · 구매자 청약철회 기한과 무관'}
            </small>
          </div>
          {cancellationRequest.decisionNote ? (
            <p>처리 메모 · {cancellationRequest.decisionNote}</p>
          ) : null}
          {/* 재시도 결과와 같은 원인 코드를 요청 영역에도 남긴다(QA-10). 결과 문구는 다른
              주문을 처리하거나 새로고침하면 사라지지만 코드는 요청이 열려 있는 동안 남는다. */}
          {cancellationRequest.lastErrorCode
            && (cancellationRequest.status === 'needs_review' || cancellationRequest.status === 'processing') ? (
            <p>
              정합화 오류 · <code className="mono">{cancellationRequest.lastErrorCode}</code>
              {' · 코드별 조치는 어드민 가이드 "클레임 처리"에 있습니다.'}
            </p>
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

      {canManage ? <OrderCancellationResult orderId={order.id} state={cancellation.state} /> : null}

      {canManage ? <div className="admin-order-actions">
        {['shipping', 'delivered', 'done'].includes(order.status) && !openCancellationRequest(order) ? <SellerClaimIntakeButton orderId={order.id} /> : null}
        {canAdvanceOrderStatus && order.status === 'paid' ? (
          <OrderStatusAction
            carriers={carriers}
            label="발주확인"
            orderId={order.id}
            shipment={null}
            status="confirmed"
          />
        ) : null}
        {canAdvanceOrderStatus && hasParcelShipment && order.status === 'confirmed' ? <Link href={`/admin/sales/dispatch?tab=ready&query=${order.id}`}>배송 건별 운송장 등록</Link> : null}
        {canAdvanceOrderStatus && hasParcelShipment && order.status === 'shipping' ? <Link href={`/admin/sales/shipping?tab=transit&query=${order.id}`}>배송 건별 배송완료 처리</Link> : null}
        {/* delivered→done은 자동 거래확정 잡이 맡는다. 운영자 버튼을 두면
            청약철회 창을 사람 손으로 조기 종료시킬 수 있다. */}
        {hasShipped ? order.shipments.filter(shipment=>isParcelShipment(shipment)&&(shipment.status==='shipping'||shipment.status==='delivered')).map(shipment=>(
          <section key={shipment.id} aria-label={`${shipment.originName} 운송장 수정`}>
            <h4>{shipment.originName} · {shipment.id.slice(-8).toUpperCase()}</h4>
            <UpdateTrackingForm carriers={carriers} orderId={order.id} shipmentId={shipment.id} shipment={orderShipment(carriers,shipment.carrier,shipment.trackingNumber)} />
          </section>
        )) : null}
        {order.shipments.filter(shipment=>!isParcelShipment(shipment)).map(shipment=>(
          <section key={shipment.id} aria-label={`${shipment.originName} 인계·수령 확인`}>
            <h4>{shipment.originName} · {shipment.id.slice(-8).toUpperCase()}</h4>
            <p>{shipment.delivery ? deliveryStatusLabel(shipment.delivery.method,shipment.status) : '배송 방식 확인 필요'}</p>
            <Link href={adminOrderDetailHref(order.id,filters)} target="_blank" rel="noopener noreferrer">
              {shipment.delivery ? DELIVERY_METHOD_LABELS[shipment.delivery.method] : '배송 방식'} 인계·수령 확인
            </Link>
          </section>
        ))}
        {/* 주문 콘솔이 소유하는 것은 "접수 단계의 취소"뿐이다. 반품·교환과 검토중·
            수거중·입고완료·보류는 절차가 다르고, 여기서 승인하면 입고 확인을
            건너뛴 채 전액 환불과 재고 복원이 끝난다. DB도 같은 경계를 지키지만
            (claim_requires_claim_console), 버튼을 그려 두고 실패 문구로 알리는
            것은 안내가 아니다. */}
        {cancellationRequest && isLegacyDecidableCancellation(cancellationRequest) ? (
          <>
            <ApproveCancellationForm
              cancellation={cancellation}
              orderId={order.id}
              orderStatus={order.status}
              requestId={cancellationRequest.id}
            />
            <RejectCancellationForm cancellation={cancellation} orderId={order.id} requestId={cancellationRequest.id} />
          </>
        ) : null}
        {cancellationRequest
          && !isLegacyDecidableCancellation(cancellationRequest)
          && isOpenOrderClaimStage(cancellationRequest.stage) ? (
          <Link
            className="btn btn-sm btn-ghost"
            href={`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[cancellationRequest.claimType]}/${cancellationRequest.id}`}
          >
            {ADMIN_VOCABULARY.claims}에서 처리
          </Link>
        ) : null}
        {(cancellationRequest?.status === 'processing' || cancellationRequest?.status === 'needs_review')
          && !usesKorpayManualRecovery ? (
          <ReconcileCancellationForm
            cancellation={cancellation}
            orderId={order.id}
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
        {staffCancellation.available ? (
          <StaffCancellationForm
            cancellation={cancellation}
            orderId={order.id}
            requiresWarehouseStop={staffCancellation.requiresWarehouseStop}
          />
        ) : null}
        {manualRecoveryAttempt?.manualRecoveryAvailable ? (
          <ManualKorpayCancellationForm
            amount={manualRecoveryAttempt.amount}
            attemptId={manualRecoveryAttempt.attemptId}
            cancellation={cancellation}
            currency={manualRecoveryAttempt.currency}
            orderId={order.id}
            providerOrderId={manualRecoveryAttempt.providerOrderId}
            requestId={manualRecoveryAttempt.requestId}
          />
        ) : null}
      </div> : null}
    </article>
  );
}

export function OrdersSection({ data, canManage = true }: { data: AdminOrderConsoleData; canManage?: boolean }) {
  const [selection, setSelection] = useState<string[]>([]);
  const [bulkState, bulkAction, bulkPending] = useActionState(bulkConfirmAdminOrdersAction, EMPTY_ACTION_STATE);
  const selected = data.filters.orderId
    ? data.items.find((order) => order.id === data.filters.orderId) ?? null
    : data.items[0] ?? null;
  const currentHref = adminOrdersHref(data.filters);
  const eligible = new Set(data.items.filter((order) => canManage && order.status === 'paid' && !openCancellationRequest(order)).map((order) => order.id));
  const selectedIds = selection.filter((id) => eligible.has(id));
  const columns: ConsoleGridColumn[] = [
    {key:'reference',label:'주문번호',width:'140px'}, {key:'status',label:'주문상태',width:'110px'},
    {key:'ordered',label:'주문일시',width:'160px'}, {key:'buyer',label:'구매자명',width:'130px'},
    {key:'recipient',label:'수취인명',width:'110px'}, {key:'items',label:'상품명 / 옵션',width:'300px'},
    {key:'qty',label:'수량',width:'65px',align:'end'}, {key:'total',label:'결제금액',width:'120px',align:'end'},
    {key:'claim',label:'취소·반품·교환',width:'140px'}, {key:'detail',label:canManage?'주문 처리':'주문 상세',width:'105px'},
  ];
  const rows = data.items.map((order) => {
    const request = canManage ? openCancellationRequest(order) : null;
    return {id:order.id,selectable:eligible.has(order.id),selectLabel:`주문 ${orderReferenceLabel(order.id)} 선택`,cells:[
      <Link key="reference" className="mono" href={adminOrderDetailHref(order.id,data.filters)} target="_blank" rel="noopener noreferrer"
        aria-label={`주문 ${orderReferenceLabel(order.id)} 상세 열기 (새 탭)`}>{orderReferenceLabel(order.id)}</Link>,
      <span key="status" className={`order-status order-status--${order.status}`} title={order.status==='done'?ADMIN_VOCABULARY.settledHint:undefined}>{ADMIN_ORDER_STATUS_LABELS[order.status]}</span>,
      <time key="created" dateTime={order.createdAt}>{formatOrderDateTime(order.createdAt)}</time>,
      <span key="buyer">{order.buyerName}</span>, <span key="recipient">{order.address?.recipientName??'-'}</span>,
      <ul key="items">{order.items.map(item=><li key={item.id}>{item.name}{item.variantName?` · ${item.variantName}`:''}<GoodsCustomInputsSummary selection={item.customInputs} /></li>)}</ul>,
      order.items.reduce((qty,item)=>qty+item.qty,0), formatKrwExact(order.total),
      request?<div key="claim"><Link href={`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[request.claimType]}/${request.id}`}>{ORDER_CLAIM_TYPE_LABELS[request.claimType]} · {ORDER_CLAIM_STAGE_LABELS[request.stage]}</Link><br/><CancellationReasonBadge className="admin-order-row-reason" request={request}/></div>:'-',
      <Link key="detail" aria-label={`주문 ${orderReferenceLabel(order.id)} 선택${request?` · ${cancellationReasonAccessibleName(request)}`:''}`} href={`${adminOrdersHref(data.filters,{orderId:order.id})}#sales-order-detail`}>{canManage ? '상세·처리' : '상세 보기'}</Link>,
    ]};
  });
  const [cancellationState, cancellationAction, cancellationPending] = useActionState(
    runOrderCancellationAction,
    EMPTY_CANCELLATION_STATE,
  );
  const [submittedCancellation, setSubmittedCancellation] = useState<OrderCancellationConsole['submitted']>(null);
  const [cancellationClientErrors, setCancellationClientErrors] = useState<OrderCancellationConsole['clientErrors']>(null);
  const cancellation: OrderCancellationConsole = {
    state: cancellationState,
    action: ignoreUnconfirmedCancellationSubmit,
    pending: cancellationPending,
    submitted: submittedCancellation,
    clientErrors: cancellationClientErrors,
    submit: (event, confirmation, intent, orderId, validate) => {
      /* 양식 action으로 보내지 않는다 — 끝나면 입력이 초기화된다(planOrderCancellationSubmit). */
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const plan = planOrderCancellationSubmit(formData, confirmation, (message) => window.confirm(message), validate);
      if (plan.kind === 'invalid') {
        setCancellationClientErrors({ intent, orderId, errors: plan.errors });
        return;
      }
      if (plan.kind === 'dismissed') return;
      setCancellationClientErrors(null);
      setSubmittedCancellation({ intent, orderId });
      startTransition(() => cancellationAction(formData));
    },
  };
  /* 상태 필터로 보던 목록에서는 방금 취소한 주문이 빠진다. 그 결과는 목록 위에 남긴다. */
  const resultOrderId = hasCancellationResult(cancellationState) ? cancellationState.orderId ?? null : null;
  const resultOutsideList = resultOrderId && !data.items.some((order) => order.id === resultOrderId)
    ? resultOrderId
    : null;

  return (
    <section className="admin-orders admin-sales-console">
      <OrderViewTabs filters={data.filters} view="orders" />
      <SalesGuide title="주문 검색과 주문별 결제·배송·요청 내역을 확인할 수 있습니다.">
        <p>{canManage ? '주문번호를 누르면 상세 정보를 새 탭으로 엽니다. 신규주문은 선택하여 발주확인할 수 있으며, 발송과 배송완료는 출고지별 배송건을 확인해 처리합니다.' : '주문번호를 누르면 주문과 배송 정보를 조회할 수 있습니다.'}</p>
      </SalesGuide>
      <SalesStatusSummary label="주문 처리 단계" items={STATUS_OPTIONS.map(option=>({label:option.label,active:data.filters.status===option.value,
        count:option.value==='all'?(data.counts?Object.values(data.counts).reduce((sum,value)=>sum+value,0):undefined):data.counts?.[option.value],
        href:adminOrdersHref(data.filters,{status:option.value,page:1,orderId:null})}))}/>
      <OrderFilters filters={data.filters} />
      {canManage && resultOutsideList ? (
        <section aria-label="취소 처리 결과" className="admin-order-cancellation-result">
          <p>주문 {orderReferenceLabel(resultOutsideList)} 취소 처리 결과 · 지금 검색 조건의 목록에는 없는 주문입니다.</p>
          <CancellationResultBody state={cancellationState} />
          <Link className="btn btn-sm btn-ghost" href={adminOrderSearchHref(resultOutsideList)}>이 주문 열기</Link>
        </section>
      ) : null}
      <div className="admin-sales-results">
        <SalesResultsHeader currentHref={currentHref} total={data.total} pageSize={data.pageSize} sort={data.filters.sort??'newest'}>
          <AdminListExportButton href={adminListExportHref('orders', currentHref)} total={data.total} />
        </SalesResultsHeader>
        <form action={bulkAction} onSubmit={(event)=>confirmAction(event,`선택한 신규주문 ${selectedIds.length}건을 발주확인할까요?`)}>
          {selectedIds.map(id=><input key={id} type="hidden" name="orderIds" value={id}/>)}
          <ConsoleGrid caption="주문 목록" preferencesKey="sales-orders" columns={columns} rows={rows} selectable={eligible.size>0}
            selectedIds={selectedIds} onSelectionChange={setSelection} emptyLabel="조건에 맞는 주문이 없습니다.">
            {canManage ? <div className="admin-sales-workbar">
              <span className="admin-sales-selection">{selectedIds.length}건 선택</span>
              <button type="submit" disabled={bulkPending||selectedIds.length===0}>{bulkPending?'처리 중…':'선택 주문 발주확인'}</button>
              <Link href="/admin/sales/dispatch">발송관리</Link><Link href="/admin/sales/shipping">배송현황</Link>
            </div> : null}
          </ConsoleGrid>
          <ActionFeedback state={bulkState}/>
        </form>
        <ConsolePagination label="주문 목록 페이지" page={data.filters.page} pageSize={data.pageSize} total={data.total}
          hrefForPage={page=>adminOrdersHref(data.filters,{page,orderId:null})}/>
      </div>
        {selected ? <details id="sales-order-detail" className="admin-sales-detail-disclosure" open={Boolean(data.filters.orderId)} key={selected.id}>
          <summary>주문 {orderReferenceLabel(selected.id)} {canManage ? '상세·처리' : '상세 보기'}</summary>
          <OrderDetail cancellation={cancellation} carriers={data.carriers} filters={data.filters} order={selected} canManage={canManage} />
        </details> : data.filters.orderId ? (
          <div className="card col" role="status">
            <p>선택한 주문은 현재 목록에 없습니다.</p>
            <Link
              href={adminOrderDetailHref(data.filters.orderId, data.filters)}
              rel="noopener noreferrer"
              target="_blank"
            >
              지정한 주문 상세 열기 (새 탭)
            </Link>
          </div>
        ) : null}
    </section>
  );
}
