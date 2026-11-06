'use server';

import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import {
  checkoutPaymentClosure,
  mapPlaceOrderError,
  normalizeCheckoutAddress,
  normalizeCheckoutKey,
  normalizeCheckoutPaymentMethod,
  normalizeOrderReference,
  type PlaceOrderErrorCode,
} from '@/lib/checkout';
import { loadCheckoutOrder, type CheckoutOrderSnapshot } from '@/lib/checkout.server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { bankTransferCheckoutEnabled } from '@/lib/payments/bank-transfer.server';
import { goodsCheckoutPaymentsEnabled } from '@/lib/payments/goods-checkout-availability';
import { GoodsPaymentRepositoryError } from '@/lib/payments/goods-checkout.server';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';
import { deriveGoodsCartProvider, deriveGoodsOrderProvider } from '@/lib/payments/goods-sale-restriction.server';
import { createServiceClient } from '@/lib/supabase/service';
import { normalizeStoreCreditAmount } from '@/lib/store-credits';
import { couponErrorNeedsPendingOrder } from '@/lib/coupons';
import { normalizeCartItems } from '@/lib/cart';
import { bindStoreAnalyticsOrder } from '@/lib/store-analytics.server';
import { goodsCustomInputValues } from '@/lib/goods-custom-inputs';

type PlaceOrderActionError =
  | PlaceOrderErrorCode
  | 'invalid_request'
  | 'auth_required'
  | 'onboarding_required'
  | 'payment_unavailable';

export type PlaceOrderActionResult =
  | { ok: true; orderId: string }
  | { ok: false; error: PlaceOrderActionError; pendingOrder?: boolean };

export interface PrepareGoodsPaymentActionState {
  readonly prepared?: PreparedCheckout;
  /**
   * `payment_closed`: 주문은 아직 결제 대기지만 같은 주문으로 결제를 다시 시작할 수
   * 없다(승인 거절·결제 준비 시간 경과·처리 중인 취소 요청). "잠시 후 다시 시도"로
   * 안내하면 같은 실패만 반복되므로 결제 환경 문제(`payment_unavailable`)와 나눈다.
   */
  readonly error?: 'auth_required' | 'not_found' | 'not_payable' | 'goods_sale_not_open' | 'payment_closed' | 'payment_unavailable';
}

function orderStillPayable(order: CheckoutOrderSnapshot, now: number) {
  return order.status === 'pending'
    && order.paymentStatus === null
    && Boolean(order.expiresAt)
    && Date.parse(order.expiresAt as string) > now;
}

/**
 * prepare RPC가 실패한 뒤 원장을 다시 읽어 실패를 분류한다. 저장소 오류는 DB 사유를
 * 싣지 않으므로(provider·DB 원문 비노출) 사유를 문자열에서 추측하지 않고 상태로 판독한다.
 */
async function classifyPrepareFailure(
  userId: string,
  orderId: string,
): Promise<NonNullable<PrepareGoodsPaymentActionState['error']>> {
  try {
    const order = await loadCheckoutOrder(userId, orderId);
    if (!order) return 'not_found';
    const now = Date.now();
    if (!orderStillPayable(order, now)) return 'not_payable';
    return checkoutPaymentClosure(order, now) ? 'payment_closed' : 'payment_unavailable';
  } catch {
    return 'payment_unavailable';
  }
}

export async function prepareGoodsPaymentAction(
  _state: PrepareGoodsPaymentActionState,
  formData: FormData,
): Promise<PrepareGoodsPaymentActionState> {
  const orderId = normalizeOrderReference(formData.get('orderId'));
  if (!orderId) return { error: 'not_found' };

  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { error: 'auth_required' };
  if (
    isAccountSuspended(auth.profile)
    || !isOnboarded(auth.profile, auth.user.email)
  ) return { error: 'auth_required' };

  const order = await loadCheckoutOrder(auth.user.id, orderId);
  if (!order) return { error: 'not_found' };
  if (!orderStillPayable(order, Date.now())) return { error: 'not_payable' };
  if (checkoutPaymentClosure(order, Date.now())) return { error: 'payment_closed' };

  try {
    /* 카드 provider는 주문의 판매 제한 여부에서 파생된다(#392). gate도 파생된
       provider의 것을 본다 — 제한 주문은 korpay gate가 열릴 때(19금 오픈 트랙)
       까지 payment_unavailable로 남는다. DB prepare가 같은 파생을 최종 강제한다. */
    const provider = await deriveGoodsOrderProvider(order.id);
    if (!goodsCheckoutPaymentsEnabled(auth.user.id, provider)) {
      return { error: 'payment_unavailable' };
    }
    const prepared = await createRuntimeGoodsPaymentCheckout(provider).prepare({
      userId: auth.user.id,
      orderId: order.id,
    });
    if (Date.parse(prepared.expiresAt) <= Date.now()) return { error: 'payment_closed' };
    return { prepared };
  } catch (error) {
    if (error instanceof GoodsPaymentRepositoryError && error.code === 'goods_sale_not_open') return { error: 'goods_sale_not_open' };
    return { error: await classifyPrepareFailure(auth.user.id, order.id) };
  }
}

export async function placeOrderAction(
  addressValue: unknown,
  checkoutKeyValue: unknown,
  paymentMethodValue: unknown = 'card',
  storeCreditAmountValue: unknown = 0,
  expectedUserCouponIdValue: unknown = undefined,
  expectedCartValue?: unknown,
): Promise<PlaceOrderActionResult> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { ok: false, error: 'auth_required' };
  if (isAccountSuspended(auth.profile)) return { ok: false, error: 'account_suspended' };
  if (!isOnboarded(auth.profile, auth.user.email)) {
    return { ok: false, error: 'onboarding_required' };
  }

  const address = normalizeCheckoutAddress(addressValue);
  if (!address) return { ok: false, error: 'invalid_address' };

  const checkoutKey = normalizeCheckoutKey(checkoutKeyValue);
  if (!checkoutKey) return { ok: false, error: 'invalid_request' };

  const paymentMethod = normalizeCheckoutPaymentMethod(paymentMethodValue);
  if (!paymentMethod) return { ok: false, error: 'invalid_request' };
  const storeCreditAmount = normalizeStoreCreditAmount(storeCreditAmountValue);
  if (storeCreditAmount === null) return { ok: false, error: 'invalid_request' };
  const expectedCouponId = expectedUserCouponIdValue === null || expectedUserCouponIdValue === undefined
    ? null : normalizeOrderReference(expectedUserCouponIdValue);
  if (expectedUserCouponIdValue != null && expectedCouponId === null) return { ok: false, error: 'invalid_request' };
  const expectedCart=normalizeCartItems(expectedCartValue);
  if(!Array.isArray(expectedCartValue)||expectedCart.length!==expectedCartValue.length) return {ok:false,error:'invalid_request'};

  // 수단별로 게이트가 다르다. 무통장에는 결제사가 없으므로 PG rollout gate가
  // 닫혀 있어도 열릴 수 있고, 반대로 계좌가 없으면 카드가 열려 있어도 닫힌다.
  // 카드 gate는 카트 구성으로 파생한 provider의 것이다 — 19금 굿즈가 섞이면 코페이다.
  let available: boolean;
  try {
    available = paymentMethod === 'bank_transfer'
      ? await bankTransferCheckoutEnabled()
      : goodsCheckoutPaymentsEnabled(auth.user.id, await deriveGoodsCartProvider(expectedCart.map(item => item.goodId)));
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  if (!available) {
    return { ok: false, error: 'payment_unavailable' };
  }

  let data: unknown;
  let error: { message: string } | null;
  try {
    const service = createServiceClient();
    const result = await service.rpc('place_order_with_cart_snapshot', {
      p_user_id: auth.user.id,
      p_address: address,
      p_checkout_key: checkoutKey,
      p_payment_method: paymentMethod,
      p_store_credit_amount: storeCreditAmount,
      p_expected_user_coupon_id: expectedCouponId,
      p_expected_cart:expectedCart.map(item=>({good_id:item.goodId,variant_id:item.variantId,qty:item.qty,input_revision:item.customInputs?.revision??0,input_values:goodsCustomInputValues(item.customInputs)})),
    });
    data = result.data;
    error = result.error;
  } catch {
    return { ok: false, error: 'unavailable' };
  }

  if (error) return { ok: false, error: mapPlaceOrderError(error.message),
    ...(couponErrorNeedsPendingOrder(error.message) ? { pendingOrder: true } : {}) };

  const orderId = normalizeOrderReference(data);
  if (!orderId) return { ok: false, error: 'unavailable' };
  await bindStoreAnalyticsOrder(orderId, auth.user.id);
  return { ok: true, orderId };
}
