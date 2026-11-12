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
import { isClosedCheckoutDraft, normalizeCheckoutDraftId } from '@/lib/checkout-draft';
import { loadCheckoutDraft } from '@/lib/checkout-draft.server';

type PlaceOrderActionError =
  | PlaceOrderErrorCode
  | 'invalid_request'
  | 'auth_required'
  | 'onboarding_required'
  | 'payment_unavailable';

export type PlaceOrderActionResult =
  | { ok: true; orderId: string }
  /**
   * `orderId`: `checkout_draft_used`면 이 주문서로 이미 접수·결제한 원 주문, `checkout_payment_in_progress`면 결제 승인을
   * 확인하고 있는 주문(ADR-0030). 화면이 그 주문으로 안내하고 결제 버튼을 잠근다.
   */
  | { ok: false; error: PlaceOrderActionError; pendingOrder?: boolean; orderId?: string };

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
       provider의 것을 본다 — 제한 주문은 nicepay gate가 열릴 때(19금 오픈 트랙)
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

/**
 * 주문을 만든다. 초안(`draftIdValue`, ADR-0030)이 있으면 그 초안의 줄만 주문한다 — 장바구니 선택 주문은
 * `place_order_with_cart_selection`, 바로구매는 `place_direct_order`. 초안이 없으면 지금처럼 장바구니 전체
 * 스냅샷(`expectedCartValue`)으로 주문한다. 초안의 줄과 결제사 파생은 서버가 다시 읽는다(화면 신호를 믿지 않는다).
 */
export async function placeOrderAction(
  addressValue: unknown,
  checkoutKeyValue: unknown,
  paymentMethodValue: unknown = 'card',
  storeCreditAmountValue: unknown = 0,
  expectedUserCouponIdValue: unknown = undefined,
  expectedCartValue?: unknown,
  draftIdValue?: unknown,
): Promise<PlaceOrderActionResult> {
  if (draftIdValue !== undefined && draftIdValue !== null) {
    return placeDraftOrder(addressValue, checkoutKeyValue, paymentMethodValue, storeCreditAmountValue, expectedUserCouponIdValue, draftIdValue);
  }
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
  // 카드 gate는 카트 구성으로 파생한 provider의 것이다 — 19금 굿즈가 섞이면 나이스페이다.
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
  let error: { message: string; details?: string | null } | null;
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

  if (error) {
    const code = mapPlaceOrderError(error.message);
    return { ok: false, error: code, ...blockingOrder(code, error),
      ...(couponErrorNeedsPendingOrder(error.message) ? { pendingOrder: true } : {}) };
  }

  const orderId = normalizeOrderReference(data);
  if (!orderId) return { ok: false, error: 'unavailable' };
  await bindStoreAnalyticsOrder(orderId, auth.user.id);
  return { ok: true, orderId };
}

/**
 * 주문을 막은 주문(DB detail = 주문 id): 같은 주문서의 재제출이면 이미 접수·결제한 원 주문(checkout_draft_used), 결제 승인을
 * 확인하는 주문이 있으면 그 주문(checkout_payment_in_progress, ADR-0026·0030). 모양이 틀리면 주문 없이 안내만 한다.
 */
function blockingOrder(code: PlaceOrderErrorCode, error: { details?: string | null }): { orderId: string } | Record<string, never> {
  if (code !== 'checkout_draft_used' && code !== 'checkout_payment_in_progress') return {};
  const orderId = normalizeOrderReference(error.details ?? null);
  return orderId ? { orderId } : {};
}

async function placeDraftOrder(
  addressValue: unknown,
  checkoutKeyValue: unknown,
  paymentMethodValue: unknown,
  storeCreditAmountValue: unknown,
  userCouponIdValue: unknown,
  draftIdValue: unknown,
): Promise<PlaceOrderActionResult> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { ok: false, error: 'auth_required' };
  if (isAccountSuspended(auth.profile)) return { ok: false, error: 'account_suspended' };
  if (!isOnboarded(auth.profile, auth.user.email)) return { ok: false, error: 'onboarding_required' };

  const draftId = normalizeCheckoutDraftId(draftIdValue);
  const address = normalizeCheckoutAddress(addressValue);
  if (!address) return { ok: false, error: 'invalid_address' };
  const checkoutKey = normalizeCheckoutKey(checkoutKeyValue);
  const paymentMethod = normalizeCheckoutPaymentMethod(paymentMethodValue);
  const storeCreditAmount = normalizeStoreCreditAmount(storeCreditAmountValue);
  const userCouponId = userCouponIdValue === null || userCouponIdValue === undefined ? null : normalizeOrderReference(userCouponIdValue);
  if (!draftId || !checkoutKey || !paymentMethod || storeCreditAmount === null
    || (userCouponIdValue !== null && userCouponIdValue !== undefined && userCouponId === null)) return { ok: false, error: 'invalid_request' };

  const draft = await loadCheckoutDraft(auth.user.id, draftId);
  if (draft === 'error') return { ok: false, error: 'unavailable' };
  if (!draft) return { ok: false, error: 'checkout_draft_expired' };
  /* 만료된 주문서는 줄이 없다. 이미 주문한 주문서면 원 주문으로, 아니면 고른 화면으로 돌려보낸다. 살아 있는 주문서는
     이미 주문했어도 DB에 맡긴다 — 같은 checkout key의 재요청은 원래 주문을 돌려줘야 한다(멱등). */
  if (isClosedCheckoutDraft(draft)) {
    return draft.usedOrderId ? { ok: false, error: 'checkout_draft_used', orderId: draft.usedOrderId } : { ok: false, error: 'checkout_draft_expired' };
  }

  // 카드 gate는 초안 줄로 파생한 provider의 것이다 — 19금 굿즈가 섞이면 나이스페이다. 장바구니 전체가 아니다.
  let available: boolean;
  try {
    available = paymentMethod === 'bank_transfer'
      ? await bankTransferCheckoutEnabled()
      : goodsCheckoutPaymentsEnabled(auth.user.id, await deriveGoodsCartProvider(draft.lines.map(item => item.goodId)));
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  if (!available) return { ok: false, error: 'payment_unavailable' };

  let data: unknown;
  let error: { message: string; details?: string | null } | null;
  try {
    const service = createServiceClient();
    const result = draft.source === 'direct'
      ? await service.rpc('place_direct_order', {
        p_user_id: auth.user.id,
        p_draft_id: draft.id,
        p_address: address,
        p_checkout_key: checkoutKey,
        p_payment_method: paymentMethod,
        p_store_credit_amount: storeCreditAmount,
        p_user_coupon_id: userCouponId,
      })
      : await service.rpc('place_order_with_cart_selection', {
        p_user_id: auth.user.id,
        p_draft_id: draft.id,
        p_address: address,
        p_checkout_key: checkoutKey,
        p_payment_method: paymentMethod,
        p_store_credit_amount: storeCreditAmount,
        p_expected_user_coupon_id: userCouponId,
      });
    data = result.data;
    error = result.error;
  } catch {
    return { ok: false, error: 'unavailable' };
  }

  if (error) {
    const code = mapPlaceOrderError(error.message);
    /* 같은 주문서의 재제출(다른 탭·뒤로 가기)·결제 확인 중인 주문: DB detail이 그 주문 id다. */
    return { ok: false, error: code, ...blockingOrder(code, error),
      ...(couponErrorNeedsPendingOrder(error.message) ? { pendingOrder: true } : {}) };
  }

  const orderId = normalizeOrderReference(data);
  if (!orderId) return { ok: false, error: 'unavailable' };
  await bindStoreAnalyticsOrder(orderId, auth.user.id);
  return { ok: true, orderId };
}
