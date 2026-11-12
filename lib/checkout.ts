export interface CheckoutAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2?: string;
  deliveryNote?: string;
}

export type CheckoutAddressField = keyof CheckoutAddress;
export type CheckoutAddressErrors = Partial<Record<CheckoutAddressField, string>>;

export type PlaceOrderErrorCode =
  | 'account_suspended'
  | 'goods_purchase_restricted'
  | 'goods_custom_inputs_changed'
  | 'cart_changed'
  | 'empty_cart'
  | 'out_of_stock'
  | 'invalid_address'
  | 'bank_transfer_blocked'
  | 'card_payment_blocked'
  | 'purchase_limit_not_configured'
  | 'order_quantity_below_minimum'
  | 'order_quantity_above_maximum'
  | 'member_purchase_limit_exceeded'
  /** 옵션별 구매 제한(D7②). DB `option_order_limit_exceeded: <variantId>`·`option_member_limit_exceeded: <variantId>`. */
  | 'option_order_limit_exceeded'
  | 'option_member_limit_exceeded'
  /** 랜덤 판매 굿즈(D5②)의 배정 조건이 주문 순간 깨졌다(옵션 가격 불일치·판매 방식 변경 등). 재고 부족은 out_of_stock. */
  | 'random_option_unavailable'
  | 'random_option_limit_exceeded'
  | 'restricted_good_blocked'
  | 'adult_verification_required'
  | 'coupon_rejected'
  | 'store_credit_rejected'
  | 'checkout_changed'
  /** 견적·표시 뒤 다른 화면에서 장바구니 쿠폰 선택이 바뀌었다(DB `coupon_selection_changed`, PT409). 만든 주문은 없다. */
  | 'coupon_selection_changed'
  | 'shipping_region_unresolved'
  | 'goods_sale_not_open'
  | 'preorder_sale_not_open'
  | 'preorder_capacity_exceeded'
  | 'preorder_policy_not_configured'
  | 'payment_below_minimum'
  | 'checkout_payment_in_progress'
  /** 주문서 초안(ADR-0030)이 만료됐거나 이 계정의 것이 아니다(DB `checkout_draft_expired`·`checkout_draft_unavailable`). 만든 주문은 없다. */
  | 'checkout_draft_expired'
  /**
   * 이 주문서로 만든 주문이 이미 무통장 접수·결제됐다(DB `checkout_draft_used`, detail = 원 주문 id). 다른 탭·뒤로 가기의
   * 같은 주문서 재제출이라 새 주문을 만들지 않았다 — 원 주문으로 안내한다.
   */
  | 'checkout_draft_used'
  | 'unavailable';

/** 주문서에서 고르는 결제수단. DB `public.order_payment_method`와 같은 값. */
export type CheckoutPaymentMethod = 'card' | 'bank_transfer';

export function normalizeCheckoutPaymentMethod(value: unknown): CheckoutPaymentMethod | null {
  return value === 'card' || value === 'bank_transfer' ? value : null;
}

/**
 * 결제 화면이 판독하는 주문 상태.
 * - `refund_in_progress`: 결제는 승인됐는데 승인 응답을 기다리는 사이 접수된 취소 요청이
 *   처리 중이다. finalizer가 결제 원장을 paid로 남기고 주문은 pending으로 둔 채 결제 취소를
 *   시작한다(20261013110100). 확인 중(`checking`)이 아니다 — 승인은 확정됐다.
 */
export type CheckoutOrderState =
  | 'payable'
  | 'payment_closed'
  | 'checking'
  | 'refund_in_progress'
  | 'complete'
  | 'closed';

/** 주문의 카드 결제 시도(payment_attempts) 중 화면 판독에 필요한 값만. */
export interface CheckoutPaymentAttemptSnapshot {
  readonly state: string;
  readonly expiresAt: string | null;
  readonly provider: string;
}

/**
 * 주문은 아직 결제 대기(pending)인데 같은 주문으로 결제를 다시 시작할 수 없는 이유.
 *
 * 굿즈 주문당 결제 시도는 하나뿐이고(payment_attempts_one_goods_order_idx),
 * `prepare_goods_payment_attempt`는 기존 시도가 만료 전 `prepared`일 때만 재사용한다.
 * - `not_approved`: 승인 단계에서 거절·취소로 끝난 시도(declined·canceled). 청구 없이
 *   끝났고 같은 주문으로는 다시 결제할 수 없다.
 * - `attempt_expired`: 결제 준비 후 시도 유효 시간(최대 10분)이 지났다. 콜백도 거절되므로
 *   승인 API가 불리지 않는다.
 * - `cancellation_requested`: 처리 중인 취소 요청이 있어 DB가 결제를 막는다.
 */
export type CheckoutPaymentClosure = 'not_approved' | 'attempt_expired' | 'cancellation_requested';

/**
 * 닫힌 결제 화면에서 고객에게 줄 수 있는 정리 액션.
 * - `retry_from_cart`: 결제가 끝날 때까지 장바구니가 남는 주문(ADR-0026). 장바구니에 굿즈가
 *   그대로 있으므로 다시 담지 않고 그 주문의 줄로 주문서를 다시 연다(ADR-0030 — 장바구니에서 고르지 않은
 *   줄은 끼지 않는다). 새 주문이 이 주문을 결제 없이 닫는다.
 * - `retry_direct`: 바로구매 주문(ADR-0030). 장바구니와 무관하므로 그 상품 상세로 보내 다시 구매하게 한다.
 * - `cancel_then_reorder`·`reorder`: 주문 생성 때 장바구니를 비운 이전 주문. 취소한 뒤
 *   품목을 장바구니에 다시 담는다.
 */
export type CheckoutReorderMode = 'cancel_then_reorder' | 'reorder' | 'retry_from_cart' | 'retry_direct';

export interface CheckoutClosureInput {
  readonly status: string;
  readonly paymentMethod: CheckoutPaymentMethod;
  readonly paymentStatus: string | null;
  readonly paymentAttempt: CheckoutPaymentAttemptSnapshot | null;
  readonly hasActiveCancellationRequest: boolean;
  /** 결제가 끝날 때까지 장바구니를 남긴 카드 장바구니 주문인지(ADR-0026). */
  readonly cartRetained?: boolean;
  /** 결제를 기다리거나 결제 없이 닫힌 카드 바로구매 주문(ADR-0030)이면 그 상품 상세 굿즈. 다시 구매하기 목적지다. */
  readonly directGoodId?: string | null;
}

/**
 * 보류 원장의 상태로 본 바로구매 주문(ADR-0030)의 상품 상세 굿즈. 결제를 기다리거나 결제 없이 닫힌 보류만 해당한다 —
 * 결제가 확정됐거나(consumed) 새 주문이 떼어 낸 보류(detached)는 다시 구매를 권하지 않는다. 장바구니 보류는 null.
 */
export function directRetryGoodId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const { state, releaseReason, source, baseGoodId } = value as { state?: unknown; releaseReason?: unknown; source?: unknown; baseGoodId?: unknown };
  if (source !== 'direct' || typeof baseGoodId !== 'string' || !baseGoodId.trim()) return null;
  return state === 'awaiting_payment' || (state === 'released' && releaseReason !== 'detached') ? baseGoodId : null;
}

const RETRY_ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 바로구매 주문의 다시 구매로 이미 만든 주문(ADR-0030) — 다시 구매 초안이 무통장 접수·결제 완료·결제 확인 중인 주문을 만들었으면
 * 그 주문. 결제 화면이 처음 그릴 때부터 '이미 다시 주문했어요'와 그 주문으로 잇고 다시 구매하기를 감춘다. 아니면 null.
 */
export function directRetryReorderId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const { source, retryOrderId } = value as { source?: unknown; retryOrderId?: unknown };
  return source === 'direct' && typeof retryOrderId === 'string' && RETRY_ORDER_ID.test(retryOrderId) ? retryOrderId.toLowerCase() : null;
}

/**
 * 주문 내역·주문 상세의 다시 결제 진입(QA1 S-D2-15, service_list_order_retry_sources). 결제 대기(`awaitingPayment`)이거나 결제
 * 없이 닫힌 카드 주문의 출처다 — 장바구니 출처는 그 주문의 줄 가운데 장바구니에 남은 것만 고른 주문서로, 바로구매 출처는 같은
 * 굿즈·옵션 주문서로 잇는다. `retryOrderId`는 그 바로구매 주문의 다시 구매로 이미 만든 주문이다.
 */
export interface OrderRetrySource {
  readonly source: 'cart' | 'direct';
  readonly awaitingPayment: boolean;
  /** 결제 대기 주문의 결제 승인이 아직 확정되지 않았는지(승인 확인 중·결과 불명·승인 뒤 취소 환불 진행 중). 참이면 다시 결제·취소를 권하지 않는다. */
  readonly paymentUnresolved: boolean;
  readonly baseGoodId: string | null;
  readonly retryOrderId: string | null;
}

/** 목록 RPC 응답을 주문 id별로 읽는다. 모양이 틀린 줄은 버린다 — 그 주문은 다시 결제 진입 없이 지금처럼 보인다. */
export function parseOrderRetrySources(value: unknown): Map<string, OrderRetrySource> {
  const sources = new Map<string, OrderRetrySource>();
  if (!Array.isArray(value)) return sources;
  for (const row of value) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
    const { orderId, source, awaitingPayment, paymentUnresolved, baseGoodId, retryOrderId } = row as Record<string, unknown>;
    if (typeof orderId !== 'string' || !RETRY_ORDER_ID.test(orderId) || (source !== 'cart' && source !== 'direct') || typeof awaitingPayment !== 'boolean') continue;
    const goodId = typeof baseGoodId === 'string' && baseGoodId.trim() ? baseGoodId.trim() : null;
    if (source === 'direct' && !goodId) continue;
    sources.set(orderId.toLowerCase(), {
      source,
      awaitingPayment,
      paymentUnresolved: awaitingPayment && paymentUnresolved === true,
      baseGoodId: source === 'direct' ? goodId : null,
      retryOrderId: source === 'direct' && typeof retryOrderId === 'string' && RETRY_ORDER_ID.test(retryOrderId) ? retryOrderId.toLowerCase() : null,
    });
  }
  return sources;
}

/**
 * 보류 원장의 상태로 본 "결제 없이 장바구니를 남긴 주문"인지(ADR-0026). 바로구매 보류(ADR-0030)는 장바구니를 읽지도
 * 바꾸지도 않은 주문이라 해당하지 않는다. 결제를 기다리는 보류와 결제 없이
 * 닫혀 풀린 보류만 해당한다 — 결제가 확정돼 장바구니에서 이미 뺀 보류(consumed)와, 새 주문이 장바구니를
 * 넘겨받아 떼어 낸 보류(detached)는 아니다.
 */
export function cartRetentionKeepsCart(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { state, releaseReason, source } = value as { state?: unknown; releaseReason?: unknown; source?: unknown };
  if (source === 'direct') return false;
  return state === 'awaiting_payment' || (state === 'released' && releaseReason !== 'detached');
}

/**
 * 무통장 입금 선택지 아래 안내. 두 주문서(legacy·거래 런타임)가 같은 사유 문구를 쓴다(S26).
 * `goodsAllow`는 서버 견적의 결제수단 판정이다. 아직 견적 전이면 null.
 */
export function bankTransferMethodNote({
  accountConfigured,
  goodsAllow,
}: {
  accountConfigured: boolean;
  goodsAllow: boolean | null;
}): string {
  if (!accountConfigured) return '지금은 무통장 입금을 받지 않습니다.';
  if (goodsAllow === false) return '이 주문에는 무통장을 쓸 수 없는 굿즈가 있어요.';
  if (goodsAllow === null) return '배송지와 결제 금액을 확인한 뒤 고를 수 있어요.';
  return '안내된 계좌로 24시간 안에 입금하면 확인 후 확정됩니다.';
}

const ADDRESS_KEYS = new Set([
  'recipientName',
  'phone',
  'postalCode',
  'address1',
  'address2',
  'deliveryNote',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number, required: boolean) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength) return null;
  return normalized;
}

export function normalizeCheckoutAddress(value: unknown): CheckoutAddress | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !ADDRESS_KEYS.has(key))) return null;

  const recipientName = boundedString(value.recipientName, 50, true);
  const postalCode = boundedString(value.postalCode, 5, true);
  const address1 = boundedString(value.address1, 200, true);
  const address2 = value.address2 === undefined
    ? undefined
    : boundedString(value.address2, 200, false);
  const deliveryNote = value.deliveryNote === undefined
    ? undefined
    : boundedString(value.deliveryNote, 200, false);

  if (
    !recipientName
    || !postalCode
    || !/^\d{5}$/.test(postalCode)
    || !address1
    || address2 === null
    || deliveryNote === null
    || typeof value.phone !== 'string'
    || !/^[0-9\s()+-]+$/.test(value.phone)
  ) return null;

  const phone = value.phone.replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) return null;

  return {
    recipientName,
    phone,
    postalCode,
    address1,
    ...(address2 === undefined ? {} : { address2 }),
    ...(deliveryNote === undefined ? {} : { deliveryNote }),
  };
}

export function checkoutAddressErrors(value: CheckoutAddress): CheckoutAddressErrors {
  const errors: CheckoutAddressErrors = {};
  const recipientName = value.recipientName.trim();
  const phone = value.phone.replace(/\D/g, '');
  const postalCode = value.postalCode.trim();
  const address1 = value.address1.trim();
  const address2 = value.address2?.trim() ?? '';
  const deliveryNote = value.deliveryNote?.trim() ?? '';

  if (!recipientName || recipientName.length > 50) {
    errors.recipientName = recipientName.length > 50
      ? '받는 분은 50자 이하로 입력해주세요.'
      : '받는 분을 입력해주세요.';
  }
  if (!/^[0-9\s()+-]+$/.test(value.phone) || phone.length < 8 || phone.length > 15) {
    errors.phone = '연락처는 숫자 8~15자리로 입력해주세요.';
  }
  if (!/^\d{5}$/.test(postalCode)) {
    errors.postalCode = '우편번호 5자리를 입력해주세요.';
  }
  if (!address1 || address1.length > 200) {
    errors.address1 = address1.length > 200
      ? '기본 주소는 200자 이하로 입력해주세요.'
      : '기본 주소를 입력해주세요.';
  }
  if (address2.length > 200) {
    errors.address2 = '상세 주소는 200자 이하로 입력해주세요.';
  }
  if (deliveryNote.length > 200) {
    errors.deliveryNote = '배송 메모는 200자 이하로 입력해주세요.';
  }

  return errors;
}

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

export const normalizeCheckoutKey = normalizeUuid;
export const normalizeOrderReference = normalizeUuid;

export function checkoutOrderName(itemNames: readonly string[]) {
  const firstName = itemNames[0]?.trim() || 'ICONS 굿즈';
  const suffix = itemNames.length > 1 ? ` 외 ${itemNames.length - 1}건` : '';
  const maxFirstLength = Math.max(1, 100 - suffix.length);
  return `${firstName.slice(0, maxFirstLength)}${suffix}`;
}

export function mapPlaceOrderError(message: unknown): PlaceOrderErrorCode {
  const normalized = typeof message === 'string' ? message.toLowerCase() : '';
  /* 같은 계정의 이전 장바구니 주문 결제를 승인 확인하는 중이다(ADR-0026). 이중 결제를 막으려고
     새 주문을 받지 않는다 — 확인이 끝나면 다시 주문할 수 있다. */
  if (normalized.includes('checkout_payment_in_progress')) return 'checkout_payment_in_progress';
  if (/cart_snapshot_changed/.test(normalized)) return 'cart_changed';
  /* 같은 주문서로 이미 접수·결제한 주문이 있다(다른 탭·뒤로 가기 재제출). 만료보다 먼저 나눈다. */
  if (normalized.includes('checkout_draft_used')) return 'checkout_draft_used';
  /* 주문서 초안(ADR-0030)의 시간이 지났거나 이 계정의 초안이 아니다. 장바구니·상품 상세에서 다시 연다. */
  if (/checkout_draft_(?:expired|unavailable)/.test(normalized)) return 'checkout_draft_expired';
  if (/goods_custom_inputs|invalid_goods_custom_inputs/.test(normalized)) return 'goods_custom_inputs_changed';
  if (normalized.includes('goods_purchase_restricted')) return 'goods_purchase_restricted';
  if (normalized.includes('account_suspended')) return 'account_suspended';
  if (normalized.includes('checkout key conflict')) return 'checkout_changed';
  /* 표시한 쿠폰과 주문 순간의 선택(cart_coupon_selections)이 다르다 — 대개 다른 탭에서 쿠폰을 바꾼 경우라
     만든 주문이 없다. 아래 coupon_ 일반 거절보다 먼저 나눈다. */
  if (normalized.includes('coupon_selection_changed')) return 'coupon_selection_changed';
  if (normalized.includes('shipping_region_')) return 'shipping_region_unresolved';
  if (normalized.includes('store_credit_')) return 'store_credit_rejected';
  for (const code of ['goods_sale_not_open', 'preorder_sale_not_open', 'preorder_capacity_exceeded', 'preorder_policy_not_configured'] as const) {
    if (normalized.includes(code)) return code;
  }
  if (normalized.includes('cart empty')) return 'empty_cart';
  if (normalized.includes('out of stock')) return 'out_of_stock';
  if (normalized.includes('invalid checkout address')) return 'invalid_address';
  if (normalized.includes('bank transfer blocked')) return 'bank_transfer_blocked';
  if (normalized.includes('card_payment_blocked') || normalized.includes('card payment blocked')) return 'card_payment_blocked';
  /* 옵션별 구매 제한(주문당·1인 누적)은 order_items 트리거가 막는다. 상품 단위 코드와 이름이 겹치지 않는다. */
  for (const code of ['option_order_limit_exceeded', 'option_member_limit_exceeded'] as const) {
    if (normalized.includes(code)) return code;
  }
  /* 같은 옵션 배정 상한 때문에 랜덤 굿즈 수량을 배정할 수 없다(추출 전에 판정, 배정 결과와 무관). */
  if (normalized.includes('random_option_limit_exceeded')) return 'random_option_limit_exceeded';
  if (normalized.includes('random_option_unavailable') || normalized.includes('random_option_checkout_unsupported')) {
    return 'random_option_unavailable';
  }
  for (const code of ['purchase_limit_not_configured', 'order_quantity_below_minimum', 'order_quantity_above_maximum', 'member_purchase_limit_exceeded'] as const) {
    if (normalized.includes(code)) return code;
  }
  /* 19금 굿즈는 유효한 성인 인증이 있어야 주문된다(ADR-0024). 그 밖의 판매 제한 유형은
     계속 서버가 주문을 차단한다(#392). */
  if (normalized.includes('adult verification required')) return 'adult_verification_required';
  if (normalized.includes('restricted good blocked')) return 'restricted_good_blocked';
  /* 적용해 둔 쿠폰이 주문 확정 시점 재검증에서 거부된 경우(만료·조건 미달 등).
     세부 사유는 카트가 안내한다 — 주문서는 카트로 돌아가라고만 말한다. */
  if (normalized.includes('coupon_')) return 'coupon_rejected';
  /* orders_korpay_minimum_amount 트리거: 결제 대기 주문의 total이 최소 결제 금액(1,000원)
     미만이면 거절한다. 다시 눌러도 같은 결과라 "잠시 후 다시 시도"로 두지 않는다. */
  if (normalized.includes('payment amount below provider minimum')) return 'payment_below_minimum';
  return 'unavailable';
}

/**
 * 카드 주문의 결제가 닫힌 이유. 무통장 주문은 시도 TTL이 곧 입금 기한이라 주문 만료
 * (`closed`)와 같은 축이므로 여기서 다루지 않는다.
 */
export function checkoutPaymentClosure(
  order: Pick<CheckoutClosureInput, 'paymentMethod' | 'paymentAttempt' | 'hasActiveCancellationRequest'>,
  now: number,
): CheckoutPaymentClosure | null {
  if (order.paymentMethod !== 'card') return null;
  if (order.hasActiveCancellationRequest) return 'cancellation_requested';
  const attempt = order.paymentAttempt;
  if (!attempt) return null;
  if (attempt.state === 'declined' || attempt.state === 'canceled') return 'not_approved';
  if (
    attempt.state === 'prepared'
    && (!attempt.expiresAt || Date.parse(attempt.expiresAt) <= now)
  ) return 'attempt_expired';
  return null;
}

/**
 * 승인과 구매자 취소 요청이 겹친 주문인지. 결제 원장은 paid인데 주문은 pending이고 처리 중인
 * 취소 요청(requested·processing·needs_review)이 있다 — 승인은 확정됐고 그 결제를 취소하는
 * 중이다. 자동 결제 취소가 실패해 요청이 needs_review로 넘어가도 사실은 같다.
 */
export function checkoutRefundInProgress(input: {
  readonly orderStatus: string;
  readonly paymentStatus: string | null;
  readonly hasActiveCancellationRequest: boolean;
}): boolean {
  return input.orderStatus === 'pending'
    && input.paymentStatus === 'paid'
    && input.hasActiveCancellationRequest;
}

export function checkoutOrderState(
  orderStatus: string,
  paymentStatus: string | null,
  expiresAt: string | null,
  now: number = Date.now(),
  closure: CheckoutPaymentClosure | null = null,
  hasActiveCancellationRequest = false,
): CheckoutOrderState {
  // 결제가 끝난 뒤의 모든 사다리 단계는 "결제 완료"다(#250). 새 단계가 빠지면
  // 발주확인된 주문의 결제 화면이 만료된 주문처럼 닫혀 보인다.
  if (orderStatus !== 'pending' && orderStatus !== 'canceled') {
    return 'complete';
  }
  if (orderStatus !== 'pending') return 'closed';
  /* finalizer가 주문 결제 기한(expires_at)을 비우므로 기한 판정보다 앞에서 본다. */
  if (checkoutRefundInProgress({ orderStatus, paymentStatus, hasActiveCancellationRequest })) {
    return 'refund_in_progress';
  }
  if (paymentStatus === 'pending' || paymentStatus === 'paid') return 'checking';
  if (!expiresAt || Date.parse(expiresAt) <= now) return 'closed';
  if (closure) return 'payment_closed';
  return 'payable';
}

/**
 * 고객 취소가 결제와 겹칠 수 없는 시도인지. 승인 단계에서 끝난 시도(declined·canceled)와,
 * 유효 시간(`expires_at`, 서버가 원장에서 읽은 값)이 지난 prepared 시도다. 시간이 지난
 * prepared 시도는 콜백 claim도 재-prepare도 거절되므로(goods_payment_attempt_expired·
 * goods_payment_attempt_not_preparable) 승인 API가 불릴 수 없다.
 */
function checkoutAttemptSettledBeforeApproval(
  attempt: CheckoutPaymentAttemptSnapshot,
  now: number,
): boolean {
  if (attempt.state === 'declined' || attempt.state === 'canceled') return true;
  if (attempt.state !== 'prepared' || !attempt.expiresAt) return false;
  const expiresAt = Date.parse(attempt.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

/**
 * 결제가 닫힌 주문에 "취소하고 다시 주문하기"를 보일지.
 *
 * 취소 단계는 기존 고객 취소 경로(`/api/orders/[orderId]/cancel` → `request_order_claim`)를
 * 그대로 쓴다. 그 RPC는 결제 원장 행이 없는 pending 주문에 결제와 겹칠 수 있는 시도
 * (유효한 prepared·confirming·unknown·needs_review·approved)가 없을 때 즉시 취소하고
 * 재고·쿠폰·적립금·첫구매 예약을 같은 트랜잭션에서 돌려준다. 유효 시간이 지난 prepared
 * 시도만 남은 주문도 즉시 취소한다(2026-10-12 QA-1). 그 밖에는 취소 요청으로 접수되므로
 * 즉시 취소가 확실한 경우에만 이 액션을 연다. 시각을 모르면(`now` 0) 시도 만료를
 * 단정하지 않는다. 화면과 DB의 시계가 어긋나 요청으로 접수되면 액션이 그 사실을 알린다.
 */
export function checkoutReorderMode(
  order: CheckoutClosureInput,
  state: CheckoutOrderState,
  now: number,
): CheckoutReorderMode | null {
  if (order.paymentMethod !== 'card') return null;
  /* 장바구니가 그대로 있는 주문은 다시 담지 않는다. 결제 없이 끝났거나(취소·시도 만료·승인
     거절) 결제 기한이 지난 주문이면 주문서에서 새로 결제한다. 바로구매 주문(ADR-0030)은 같은 조건에서
     그 상품 상세로 보내 다시 구매하게 한다 — 새 주문이 이 주문을 닫는다. */
  const retryMode = order.cartRetained ? 'retry_from_cart' : order.directGoodId ? 'retry_direct' : null;
  /* 결제가 잡혔다가 환불된 취소 주문(승인과 취소가 겹친 주문)은 '결제 없이' 닫힌 주문이 아니다 — 다시 결제 진입 대신 일반 취소 안내로 간다. */
  const paidThenCanceled = order.status === 'canceled' && order.paymentStatus !== null;
  if (retryMode && !paidThenCanceled) {
    if (order.status === 'canceled') return retryMode;
    if (
      order.status !== 'pending'
      || order.paymentStatus !== null
      || (state !== 'payment_closed' && state !== 'closed')
    ) return null;
    /* 처리 중인 취소 요청은 그 흐름이 끝내게 둔다. 결제와 겹칠 수 있는 시도가 남아 있으면
       주문서도 이 주문을 닫지 않으므로(승인 확인 중) 다시 결제하기를 권하지 않는다. */
    if (order.hasActiveCancellationRequest) return null;
    if (order.paymentAttempt && !checkoutAttemptSettledBeforeApproval(order.paymentAttempt, now)) return null;
    return retryMode;
  }
  if (order.status === 'canceled') return 'reorder';
  if (
    order.status !== 'pending'
    || order.paymentStatus !== null
    || order.hasActiveCancellationRequest
    || (state !== 'payment_closed' && state !== 'closed')
  ) return null;
  const attempt = order.paymentAttempt;
  if (attempt && !checkoutAttemptSettledBeforeApproval(attempt, now)) return null;
  return 'cancel_then_reorder';
}

/**
 * 결제 원장보다 결제 시도가 앞선 경우를 반영한 결제 상태. 승인 API를 부른 뒤 아직
 * 확정하지 못한 시도(confirming·unknown·needs_review)는 결제가 잡혔을 수 있으므로
 * 원장에 행이 없어도 확인 중(`pending`)으로 본다.
 */
export function checkoutEffectivePaymentStatus(
  attemptState: string | null | undefined,
  ledgerStatus: string | null,
): string | null {
  return attemptState === 'confirming' || attemptState === 'unknown' || attemptState === 'needs_review'
    ? 'pending'
    : ledgerStatus;
}

/** 결제 화면과 주문 상세가 같은 규칙으로 읽는 카드 주문의 결제 국면. */
export interface CheckoutPaymentReading {
  readonly state: CheckoutOrderState;
  /** `state`가 `payment_closed`일 때만 값이 있다. */
  readonly closure: CheckoutPaymentClosure | null;
  readonly reorderMode: CheckoutReorderMode | null;
  /** 결제 시도의 provider. 시도가 없으면 null. */
  readonly provider: string | null;
  /** 바로구매 주문(ADR-0030)의 상품 상세 굿즈 — `retry_direct` 안내의 목적지. 아니면 null. */
  readonly directGoodId?: string | null;
}

export function readCheckoutPayment(
  order: CheckoutClosureInput & { readonly expiresAt: string | null },
  now: number,
): CheckoutPaymentReading {
  const closure = order.status === 'pending' ? checkoutPaymentClosure(order, now) : null;
  const state = checkoutOrderState(
    order.status,
    order.paymentStatus,
    order.expiresAt,
    now,
    closure,
    order.hasActiveCancellationRequest,
  );
  return {
    state,
    closure: state === 'payment_closed' ? closure : null,
    reorderMode: checkoutReorderMode(order, state, now),
    provider: order.paymentAttempt?.provider ?? null,
    ...(order.directGoodId ? { directGoodId: order.directGoodId } : {}),
  };
}

/**
 * 결제 콜백이 돌려보낸 `/orders?payment=…`의 실제 결과. 콜백 리다이렉트에는 주문
 * 식별자가 없고 쿼리는 위조할 수 있으므로, 배너 문구는 쿼리가 아니라 구매자의 최근
 * 결제 시도·주문 원장으로 고른다.
 * - `attempt_expired`: 결제 준비 후 유효 시간이 지나 콜백이 와도 승인 API를 부르지
 *   않았다(늦게 끝낸 인증). 청구 없이 끝났고 같은 주문으로는 결제할 수 없다.
 * - `retryable`: 승인으로 이어지지 않았지만 시도가 아직 유효하다(같은 주문 재시도 가능).
 * - `cancellation_requested`: 처리 중인 취소 요청이 있어 DB가 결제를 막는다. 콜백이 와도
 *   claim이 `goods_order_not_payable`로 거절해 승인 API를 부르지 않으므로, 같은 주문
 *   재시도를 약속하지 않고 주문 상세의 취소 진행 상태로 안내한다.
 * - `refund_in_progress`: 승인을 기다리는 사이 접수된 취소 요청 때문에 승인된 결제를 취소하는
 *   중이다(`checkoutRefundInProgress`). 확인 중이 아니다 — 승인은 확정됐다.
 * - `refunded`: 결제가 승인된 뒤 결제사 취소까지 끝나 주문이 취소됐다(결제 원장 refunded).
 */
export type CheckoutPaymentResultOutcome =
  | 'approved'
  | 'checking'
  | 'not_approved'
  | 'attempt_expired'
  | 'retryable'
  | 'cancellation_requested'
  | 'refund_in_progress'
  | 'refunded'
  | 'canceled';

/**
 * 방금 승인된 그 결제를 가리키는 결과인지. 콜백 리다이렉트에는 주문 식별자가 없어 원장
 * 결과가 다른 주문을 짚을 수 있으므로 승인 콜백은 승인이 아닌 결과로 덮지 않는데, 이 결과들은
 * 결제 승인이 원장에 남은 경우라 승인 콜백과 어긋나지 않는다.
 */
export function checkoutPaymentResultFollowsApproval(outcome: CheckoutPaymentResultOutcome): boolean {
  return outcome === 'approved' || outcome === 'refund_in_progress' || outcome === 'refunded';
}

export interface CheckoutPaymentResultFocus {
  readonly orderId: string;
  readonly outcome: CheckoutPaymentResultOutcome;
  /** 결제 없이 장바구니를 남긴 주문인지(ADR-0026). 다시 담지 않고 주문서에서 다시 결제하게 한다. */
  readonly cartRetained?: boolean;
  /** 바로구매 주문인지(ADR-0030). 결제 화면의 '다시 구매하기'로 같은 굿즈·옵션 주문서를 다시 연다. */
  readonly directRetry?: boolean;
}

export function checkoutPaymentResultOutcome(
  input: {
    readonly orderStatus: string;
    readonly paymentStatus: string | null;
    readonly attempt: Pick<CheckoutPaymentAttemptSnapshot, 'state' | 'expiresAt'>;
    /** 처리 중인 취소 요청(requested·processing·needs_review)이 있는지. */
    readonly hasActiveCancellationRequest?: boolean;
  },
  now: number,
): CheckoutPaymentResultOutcome {
  if (input.orderStatus === 'canceled') {
    return input.paymentStatus === 'refunded' ? 'refunded' : 'canceled';
  }
  if (input.orderStatus !== 'pending') return 'approved';
  if (checkoutRefundInProgress({
    orderStatus: input.orderStatus,
    paymentStatus: input.paymentStatus,
    hasActiveCancellationRequest: input.hasActiveCancellationRequest ?? false,
  })) return 'refund_in_progress';
  if (input.paymentStatus === 'pending' || input.paymentStatus === 'paid') return 'checking';
  const { state, expiresAt } = input.attempt;
  const closedBeforeApproval = state === 'prepared' || state === 'declined' || state === 'canceled';
  /* 승인 API까지 가지 않은 시도에서만 취소 요청을 앞세운다. 결제가 잡혔을 수 있는 시도는
     아래에서 확인 중으로 둔다 — 취소 요청이 있어도 승인과의 경합은 원장이 정리한다. */
  if (closedBeforeApproval && input.hasActiveCancellationRequest) return 'cancellation_requested';
  if (state === 'declined' || state === 'canceled') return 'not_approved';
  if (state === 'prepared') {
    return !expiresAt || Date.parse(expiresAt) <= now ? 'attempt_expired' : 'retryable';
  }
  // confirming·unknown·needs_review·approved(주문 확정 전), 그리고 모르는 값은 확정하지
  // 못한 결제로 본다 — 결제가 잡혔을 수 있는 쪽으로 안내해야 안전하다.
  return 'checking';
}

/** 결제 기한 시각을 KST "HH:MM"으로. 서버·브라우저가 같은 값을 내도록 시간대를 고정한다. */
export function checkoutDeadlineTimeLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
