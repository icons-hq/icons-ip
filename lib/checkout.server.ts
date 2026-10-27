import 'server-only';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';
import { readGoodsCustomInputSnapshot } from '@/lib/goods-custom-inputs';
import type { ShipmentRecord } from './orders/shipments';
import { loadOrderShipments } from './orders/shipments.server';
import { getShippingCarrierRegistry } from './orders/shipment.server';
import { loadGiftCheckoutOrder } from './gifts-order.server';
import { isOrderCancellationRequestStatus } from './orders';
import { transactionRecord } from './goods-transaction-values';
import { parseCheckoutTransactionReceipt } from './checkout-transaction';
import type { GoodsTransactionDisplay } from './goods-transaction';

import {
  cartRetentionKeepsCart,
  checkoutEffectivePaymentStatus,
  checkoutPaymentResultOutcome,
  normalizeCheckoutAddress,
  normalizeCheckoutPaymentMethod,
  type CheckoutAddress,
  readCheckoutPayment,
  type CheckoutPaymentAttemptSnapshot,
  type CheckoutPaymentMethod,
  type CheckoutPaymentReading,
  type CheckoutPaymentResultFocus,
} from './checkout';
import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';

interface OrderRow {
  id: string;
  order_number?: string | null;
  user_id: string;
  status: string;
  total: number;
  shipping_fee: number | null;
  discount_total: number | null;
  store_credit_total: number | null;
  address: unknown;
  expires_at: string | null;
  created_at: string;
  payment_method: string | null;
  calculation_version?: number;
  volume_discount_total?: number;
  shipping_collect_total?: number;
}

interface OrderItemRow {
  id: string;
  good_id: string;
  qty: number;
  unit_price: number;
  good_name_snapshot: string;
  good_type_snapshot: string;
  variant_id: string;
  variant_name_snapshot?: string | null;
  custom_inputs_snapshot?: unknown;
  variant_code_snapshot?: string | null;
  supply_source?: 'stock' | 'preorder';
  preorder_expected_ship_date?: string | null;
}

export interface CheckoutOrderItem {
  id: string;
  variantId: string;
  variantName?: string | null;
  customInputs?: import('@/lib/goods-custom-inputs').GoodsCustomInputSelection | null;
  variantCode?: string | null;
  goodId: string;
  name: string;
  type: string;
  qty: number;
  unitPrice: number;
  supplySource?: 'stock' | 'preorder';
  preorderExpectedShipDate?: string | null;
}

export interface CheckoutOrderSnapshot {
  giftId?: string;
  transaction?: GoodsTransactionDisplay;
  shipments: ShipmentRecord[];
  id: string;
  status: string;
  total: number;
  /** 주문 시점 배송비 스냅샷. total에 이미 포함되어 있다. */
  shippingFee: number;
  /** 주문 시점 쿠폰 할인 스냅샷. total에서 이미 빠져 있다(S7). */
  discountTotal: number;
  /** 주문 시 사용한 적립금. 쿠폰과 구별하며 total에서 이미 빠져 있다. */
  storeCreditTotal: number;
  address: CheckoutAddress | null;
  expiresAt: string | null;
  createdAt: string;
  paymentStatus: string | null;
  /** 주문 생성 시점에 고정된 결제수단 (#256). */
  paymentMethod: CheckoutPaymentMethod;
  /**
   * 이 주문의 결제 시도. service role 전용 원장에서 상태·만료·provider만 읽는다.
   * 같은 주문으로 다시 결제할 수 있는지(재-prepare 가능 여부)를 화면이 판독하는 근거다.
   */
  paymentAttempt: CheckoutPaymentAttemptSnapshot | null;
  /** 처리 중인 취소 요청(requested·processing·needs_review)이 있으면 DB가 결제를 막는다. */
  hasActiveCancellationRequest: boolean;
  /** DB가 발급한 16자리 주문번호(#563). 발급 전 주문이면 없다. */
  orderNumber?: string;
  /**
   * 무통장 주문의 공식 입금코드(DB `private.bank_transfer_deposit_code`). 코드 전환 전에 접수된 주문은
   * 안내된 옛 코드를 그대로 쓰므로 주문번호만으로 계산하지 않고 DB 값을 읽는다.
   */
  depositCode?: string;
  /**
   * 결제가 끝날 때까지 장바구니를 남긴 카드 장바구니 주문인지(ADR-0026). 이런 주문은 결제가
   * 닫혀도 다시 담지 않고 주문서에서 새로 결제한다.
   */
  cartRetained?: boolean;
  /** 결제 완료(paid) 원장이 만들어진 시각. 결제 전·무통장 입금 전이면 null. */
  paidAt?: string | null;
  items: CheckoutOrderItem[];
}

const ACTIVE_CANCELLATION_REQUEST_STATUSES = ['requested', 'processing', 'needs_review'];

interface PaymentAttemptRow {
  state: string;
  expires_at: string | null;
  provider: string;
}

/** 주문의 가장 최근 결제 시도. 결제 시도 원장은 service role 전용이라 구매자 본인 것만 고른다. */
function selectLatestOrderPaymentAttempt(userId: string, orderId: string) {
  return createServiceClient()
    .from('payment_attempts')
    .select('state,expires_at,provider')
    .eq('user_id', userId)
    .eq('purpose', 'order')
    .eq('ref_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<PaymentAttemptRow>();
}

/**
 * 이 주문이 결제 없이 장바구니를 남긴 주문인지(ADR-0026, 판정은 `cartRetentionKeepsCart`). 보류 원장은
 * private이라 service role RPC로 본인 주문만 읽는다. 읽지 못하면 false — 다시 담기 경로가 원래대로 남는다.
 */
async function loadOrderCartRetained(userId: string, orderId: string): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc('service_get_order_cart_retention', {
      p_user_id: userId,
      p_order_id: orderId,
    });
    return !error && cartRetentionKeepsCart(data);
  } catch {
    return false;
  }
}

function paymentAttemptSnapshot(row: PaymentAttemptRow | null): CheckoutPaymentAttemptSnapshot | null {
  return row
    ? { state: row.state, expiresAt: row.expires_at ?? null, provider: row.provider }
    : null;
}

export async function loadLatestCheckoutAddress(userId: string): Promise<CheckoutAddress | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select('address')
    .eq('user_id', userId)
    .not('address', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ address: unknown }>();

  return error ? null : normalizeCheckoutAddress(data?.address);
}

export async function loadLatestPendingCheckoutOrderId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .not('checkout_key', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  return error ? null : data?.id ?? null;
}

/** 본인 무통장 주문의 공식 입금코드. 읽지 못하면 화면이 주문번호로 계산한 코드로 돌아간다. */
async function loadBankTransferDepositCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<{ depositCode?: string }> {
  try {
    const { data, error } = await supabase.rpc('get_my_bank_transfer_deposit_code', { p_order_id: orderId });
    return !error && typeof data === 'string' && /^[0-9A-Z]{6,8}$/.test(data) ? { depositCode: data } : {};
  } catch {
    return {};
  }
}

export async function loadCheckoutOrder(
  userId: string,
  orderId: string,
): Promise<CheckoutOrderSnapshot | null> {
  try {
    const gift = await loadGiftCheckoutOrder(userId, orderId);
    if (gift.kind === 'gift') {
      // The gift projection has already verified the payer and removes recipient details.
      // Add only current payment state; never read the ordinary order/address projection.
      const client = await createClient();
      const [{ data: attempt, error: attemptError }, { data: claim, error: requestError }] = await Promise.all([
        selectLatestOrderPaymentAttempt(userId, orderId),
        client.rpc('get_my_gift_latest_claim', { p_order_id: orderId }),
      ]);
      if (attemptError || requestError || (claim !== null && (!transactionRecord(claim) || typeof claim.status !== 'string' || !isOrderCancellationRequestStatus(claim.status)))) return null;
      return { ...gift.order, paymentAttempt: paymentAttemptSnapshot(attempt),
        paymentStatus: checkoutEffectivePaymentStatus(attempt?.state, gift.order.paymentStatus),
        hasActiveCancellationRequest: claim !== null && ACTIVE_CANCELLATION_REQUEST_STATUSES.includes(claim.status as string) };
    }
    if (gift.kind !== 'ordinary') return null;
  } catch { return null; }
  const supabase = await createClient();
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id,order_number,user_id,status,total,shipping_fee,discount_total,store_credit_total,address,expires_at,created_at,payment_method,calculation_version,volume_discount_total,shipping_collect_total')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle<OrderRow>();
  if (orderError || !orderData) return null;

  const [
    { data: itemData, error: itemError },
    { data: paymentData, error: paymentError },
    { data: attemptData, error: attemptError },
    receiptResult,
    { data: requestData, error: requestError },
  ] = await Promise.all([
    readCompleteIdPages<OrderItemRow>((afterId,pageSize)=>{
      let query=supabase.from('order_items')
        .select('id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,variant_id,variant_name_snapshot,variant_code_snapshot,custom_inputs_snapshot,supply_source,preorder_expected_ship_date',{count:'exact'})
        .eq('order_id',orderId).order('id',{ascending:true}).limit(pageSize);
      if(afterId)query=query.gt('id',afterId);
      return query;
    }),
    supabase
      .from('payment_summaries')
      .select('status,created_at')
      .eq('purpose', 'order')
      .eq('ref_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ status: string; created_at: string }>(),
    selectLatestOrderPaymentAttempt(userId, orderId),
    orderData.calculation_version === 2 ? supabase.rpc('get_my_goods_transaction_receipt', { p_order_id: orderId }) : Promise.resolve({ data: null, error: null }),
    supabase
      .from('order_cancellation_requests')
      .select('status')
      .eq('order_id', orderId)
      .in('status', ACTIVE_CANCELLATION_REQUEST_STATUSES)
      .limit(1),
  ]);
  if (itemError || paymentError || attemptError || requestError) return null;

  const itemRows = (itemData ?? []) as OrderItemRow[];
  const receipt = orderData.calculation_version === 2 ? parseCheckoutTransactionReceipt(receiptResult.data) : null;
  if (orderData.calculation_version === 2 && (receiptResult.error || !receipt || receipt.orderId !== orderId
    || receipt.display.totals.onlineTotal !== orderData.total || receipt.display.totals.prepaidShippingTotal !== (orderData.shipping_fee ?? 0)
    || receipt.display.totals.volumeDiscountTotal !== orderData.volume_discount_total || receipt.display.totals.collectShippingTotal !== orderData.shipping_collect_total
    || receipt.display.totals.couponDiscountTotal !== (orderData.discount_total ?? 0) || receipt.display.totals.storeCreditTotal !== (orderData.store_credit_total ?? 0)
    || receipt.display.lines.length !== itemRows.length || receipt.display.lines.some(line => !itemRows.some(item => item.id === line.lineId && item.variant_id === line.variantId && item.qty === line.qty && item.unit_price === line.unitPrice)))) return null;

  return {
    ...(receipt ? { transaction: receipt.display } : {}),
    id: orderData.id,
    status: orderData.status,
    total: orderData.total,
    shippingFee: orderData.shipping_fee ?? 0,
    discountTotal: orderData.discount_total ?? 0,
    storeCreditTotal: orderData.store_credit_total ?? 0,
    address: normalizeCheckoutAddress(orderData.address),
    expiresAt: orderData.expires_at,
    createdAt: orderData.created_at,
    paymentStatus: checkoutEffectivePaymentStatus(attemptData?.state, paymentData?.status ?? null),
    paymentMethod: normalizeCheckoutPaymentMethod(orderData.payment_method) ?? 'card',
    paymentAttempt: paymentAttemptSnapshot(attemptData),
    hasActiveCancellationRequest: ((requestData ?? []) as unknown[]).length > 0,
    ...(orderData.order_number ? { orderNumber: orderData.order_number } : {}),
    ...(orderData.payment_method === 'bank_transfer' ? await loadBankTransferDepositCode(supabase, orderId) : {}),
    cartRetained: orderData.payment_method === 'card' ? await loadOrderCartRetained(userId, orderId) : false,
    paidAt: paymentData?.status === 'paid' ? paymentData.created_at : null,
    shipments: await loadOrderShipments(supabase, [orderId], await getShippingCarrierRegistry()),
    items: itemRows.map((item) => ({
      id: item.id,
      goodId: item.good_id,
      name: item.good_name_snapshot,
      ...(item.custom_inputs_snapshot == null ? {} : {customInputs:readGoodsCustomInputSnapshot(item.custom_inputs_snapshot)}),
      variantId: item.variant_id, variantName: item.variant_name_snapshot ?? null, variantCode: item.variant_code_snapshot ?? null,
      type: item.good_type_snapshot,
      qty: item.qty,
      unitPrice: item.unit_price,
      supplySource: item.supply_source ?? 'stock',
      preorderExpectedShipDate: item.preorder_expected_ship_date ?? null,
    })),
  };
}

/**
 * 주문 상세가 결제 대기 카드 주문에 보일 결제 국면. 결제 화면(`/checkout/{orderId}`)과 같은
 * 규칙(`readCheckoutPayment`)으로 읽는다 — 주문 상세만 "확인 중"·"이어가기"를 말하면 같은
 * 주문이 화면마다 다르게 읽힌다. 주문·결제 요약·취소 요청은 주문 상세가 이미 본인 RLS로
 * 읽었으므로 결제 시도만 원장에서 더 읽는다. 시도를 읽지 못하면 null — 화면은 상태를
 * 단정하지 않는다.
 */
export async function loadPendingCardPaymentReading(
  userId: string,
  order: {
    readonly id: string;
    readonly status: string;
    readonly paymentMethod: CheckoutPaymentMethod;
    readonly expiresAt: string | null;
    /** 결제 요약(payment_summaries)의 최근 상태. 행이 없으면 null. */
    readonly ledgerPaymentStatus: string | null;
    /** 최근 취소 요청의 상태. 없으면 null. */
    readonly cancellationRequestStatus: string | null;
  },
  now: number = Date.now(),
): Promise<CheckoutPaymentReading | null> {
  if (order.status !== 'pending' || order.paymentMethod !== 'card') return null;
  try {
    const [{ data, error }, cartRetained] = await Promise.all([
      selectLatestOrderPaymentAttempt(userId, order.id),
      loadOrderCartRetained(userId, order.id),
    ]);
    if (error) return null;
    return readCheckoutPayment({
      status: order.status,
      paymentMethod: order.paymentMethod,
      cartRetained,
      paymentStatus: checkoutEffectivePaymentStatus(data?.state, order.ledgerPaymentStatus),
      paymentAttempt: paymentAttemptSnapshot(data),
      hasActiveCancellationRequest: order.cancellationRequestStatus !== null
        && ACTIVE_CANCELLATION_REQUEST_STATUSES.includes(order.cancellationRequestStatus),
      expiresAt: order.expiresAt,
    }, now);
  } catch {
    return null;
  }
}

/** 결제 결과 화면이 "방금 돌아온 결제"로 볼 최근 창. 토스 결제창 30분을 넉넉히 덮는다. */
const PAYMENT_RESULT_FOCUS_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * `/orders?payment=…` 배너가 가리킬 주문과 그 실제 결과.
 *
 * 토스 successUrl 콜백 라우트는 결과를 주문 식별자 없이 `approved|checking|failed`로만
 * 돌려보내고, 늦게 끝낸 인증(시도 만료)이나 DB 오류도 `checking`으로 보낸다. 그래서
 * 구매자의 토스 결제 시도 중 가장 최근에 **바뀐** 시도와 그 주문을 원장에서 읽어 실제
 * 상태로 안내한다. 만든 시각이 아니라 `updated_at`으로 고르는 이유: 결제창을 열어 둔 채
 * 다른 주문을 새로 준비하면 만든 시각이 가장 늦은 시도는 그 다른 주문이다. 콜백이 처리한
 * 시도는 claim·finalize가 행을 갱신하므로(trg_payment_attempts_updated) 방금 돌아온 결제가
 * 가장 최근에 바뀐 시도가 된다. 그래도 콜백이 claim 전에 거절된 경우까지 주문을 정확히
 * 짚지는 못한다 — 근본 해결은 콜백 리다이렉트가 주문을 싣는 것이다.
 * 결제 시도 원장은 service role 전용이고, 주문·결제 요약·취소 요청은 본인 RLS로 읽는다.
 * 코페이 시도는 청구 여부 판단 근거(인증 후 승인 API 미호출 → 만료)를 확인하지 않았으므로
 * 대상에서 빼고 쿼리 기반 기본 안내에 맡긴다.
 */
export async function loadLatestCardPaymentResultFocus(
  userId: string,
  now: number = Date.now(),
): Promise<CheckoutPaymentResultFocus | null> {
  try {
    const { data: attempt, error: attemptError } = await createServiceClient()
      .from('payment_attempts')
      .select('ref_id,state,expires_at')
      .eq('user_id', userId)
      .eq('purpose', 'order')
      .eq('provider', 'toss')
      .gte('created_at', new Date(now - PAYMENT_RESULT_FOCUS_WINDOW_MS).toISOString())
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ ref_id: string; state: string; expires_at: string | null }>();
    if (attemptError || !attempt) return null;

    const supabase = await createClient();
    const [
      { data: order, error: orderError },
      { data: payment, error: paymentError },
      { data: requestData, error: requestError },
    ] = await Promise.all([
      supabase
        .from('orders')
        .select('id,status')
        .eq('id', attempt.ref_id)
        .eq('user_id', userId)
        .maybeSingle<{ id: string; status: string }>(),
      supabase
        .from('payment_summaries')
        .select('status')
        .eq('purpose', 'order')
        .eq('ref_id', attempt.ref_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ status: string }>(),
      /* claim은 처리 중인 취소 요청이 있으면 결제를 막는다(goods_order_not_payable).
         그 주문에 재시도를 약속하지 않도록 함께 읽는다. 승인과 겹친 취소(결제 원장 paid ·
         주문 pending)도 이 요청으로 결제 취소 진행을 가린다. 요청자는 언제나 주문 구매자다. */
      supabase
        .from('order_cancellation_requests')
        .select('status')
        .eq('order_id', attempt.ref_id)
        .in('status', ACTIVE_CANCELLATION_REQUEST_STATUSES)
        .limit(1),
    ]);
    if (orderError || paymentError || requestError || !order) return null;

    return {
      orderId: order.id,
      ...(await loadOrderCartRetained(userId, order.id) ? { cartRetained: true } : {}),
      outcome: checkoutPaymentResultOutcome({
        orderStatus: order.status,
        paymentStatus: payment?.status ?? null,
        attempt: { state: attempt.state, expiresAt: attempt.expires_at },
        hasActiveCancellationRequest: ((requestData ?? []) as unknown[]).length > 0,
      }, now),
    };
  } catch {
    return null;
  }
}
