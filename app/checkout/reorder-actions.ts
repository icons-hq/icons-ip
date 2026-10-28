'use server';

import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { aggregateCartVariantQuantities, cartItemKey, normalizeCartItems, type CartItem } from '@/lib/cart';
import { cartRetentionKeepsCart, normalizeCheckoutAddress, normalizeOrderReference } from '@/lib/checkout';
import { loadGoodsTransactionRuntimeMode } from '@/lib/checkout-transaction.server';
import { loadGiftCheckoutOrder } from '@/lib/gifts-order.server';
import { goodsCustomInputSummary, goodsCustomInputValues, readGoodsCustomInputSnapshot } from '@/lib/goods-custom-inputs';
import { loadGoodsSalesQuote } from '@/lib/goods-sales.server';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';
import { readMyOrderItems } from '@/lib/orders/customer-items.server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { quoteCartTransactionAction } from './transaction-actions';

/*
 * 취소된 일반 굿즈 주문의 품목(굿즈·옵션·직접입력값·수량)을 장바구니에 다시 담는다.
 *
 * 결제가 닫힌 주문을 "취소하고 다시 주문"하는 흐름의 두 번째 단계다. 취소는 기존 고객
 * 취소 경로(/api/orders/[orderId]/cancel)가 끝내고, 이 액션은 DB가 취소를 확정한
 * (`orders.status = 'canceled'`) 주문만 받는다 — 클라이언트가 "취소됐다"고 말하는 것을
 * 근거로 삼지 않는다.
 *
 * 담기는 기존 `merge_cart_items`를 한 줄씩 쓴다. 직접입력값의 revision과 값을 전달해
 * 현재 상품 설정으로 다시 검증하고, DB 잠금 안에서 현재 수량과 큰 값을 유지한다. 게시·보관·
 * 판매 제한·옵션 재고 검증이 그 RPC 안에 있으므로, 품절·판매 중지는 기존 규칙대로 그
 * 줄만 실패하고 나머지는 담긴다. 1인 구매 한도·쿠폰 조건은 주문서 견적과 주문 RPC가
 * 다시 판정한다. 이미 장바구니에 같은 옵션과 직접입력값이 있으면 수량을 더하지 않고 둘 중 큰 값으로
 * 맞춘다(장바구니 병합과 같은 규칙) — 같은 주문을 두 번 복원해도 수량이 불어나지 않는다.
 *
 * 혜택: 주문 생성이 장바구니 쿠폰 선택을 소비하므로(place_order), 취소 트리거가 보유
 * 쿠폰을 active로 되돌려도 새 주문서에는 쿠폰이 없다. 그 주문의 쿠폰 사용 원장
 * (`coupon_redemptions`, 취소로 released)에서 보유 쿠폰을 찾아 기존 RPC
 * `apply_cart_coupon`으로 다시 선택한다. 장바구니에 이미 다른 쿠폰이 선택돼 있으면
 * 고객의 새 선택을 덮지 않는다. `apply_cart_coupon`은 최소 주문 금액 미달·대상 굿즈
 * 없음도 선택으로 받아들이고, 그 선택은 주문서 제출을 막는다(판매 견적의 쿠폰 사유).
 * 그래서 고른 뒤 장바구니·주문서가 쓰는 판매 견적으로 지금 장바구니에서 할인이
 * 인정되는지 다시 읽고, 인정되지 않으면 이 액션이 만든 선택을 풀어 새 막힘을 만들지
 * 않는다. 적립금은 주문서에서 매번 입력하는 값이라 다시 적용할 상태가 없으므로, 원
 * 주문의 사용액을 돌려줘 화면이 다시 입력하라고 안내하게 한다.
 */

/**
 * 담지 못한 줄의 사유. `sold_out`은 게시 중인 굿즈가 품절로 바뀐 경우,
 * `unavailable`은 그 밖에 지금 담을 수 없는 경우(비게시·보관·판매 제한·결제수단
 * 비활성·옵션 보관·옵션 식별자 없는 옛 주문)다.
 */
export type RestoreOrderLineFailure = 'out_of_stock' | 'sold_out' | 'unavailable' | 'custom_inputs_changed' | 'failed';

/**
 * 원 주문 쿠폰의 재적용 결과.
 * - `none`: 쿠폰을 쓰지 않은 주문.
 * - `restored`: 장바구니에 다시 선택했고, 판매 견적이 지금 장바구니에서 할인을 인정했다.
 * - `not_restored`: 다시 적용하지 못했지만 장바구니에서 해결할 수 있다(이미 다른 쿠폰
 *   선택·진행 중인 다른 주문의 첫구매 혜택·조회 실패 등) — 고객이 장바구니에서 골라야 한다.
 * - `conditions_unmet`: 쿠폰은 남아 있지만 지금 담긴 굿즈가 사용 조건(최소 주문 금액·
 *   대상 굿즈·최소 결제액)에 맞지 않아 할인되지 않는다. 이 액션이 만든 선택은 풀었다.
 * - `unavailable`: 만료·사용 완료·사용 중단·발급 대상 변경 등으로 다시 고를 수 없고,
 *   장바구니에도 선택돼 있지 않다.
 */
export type RestoreOrderCouponResult = 'none' | 'restored' | 'not_restored' | 'conditions_unmet' | 'unavailable';

export interface RestoreOrderSkippedLine {
  readonly name: string;
  readonly reason: RestoreOrderLineFailure;
}

export type RestoreCanceledOrderToCartResult =
  | {
      readonly ok: true;
      readonly restoredLines: number;
      readonly skipped: readonly RestoreOrderSkippedLine[];
      readonly coupon: RestoreOrderCouponResult;
      /** 복수·배송비 쿠폰은 주문서에서 다시 선택한다. 굿즈 쿠폰 1장은 장바구니 선택을 유지한다. */
      readonly couponReselectAt?: 'checkout';
      /** 원 주문에서 사용한 적립금. 주문서 입력은 비어 있으므로 0보다 크면 다시 입력해야 한다. */
      readonly storeCreditUsed: number;
    }
  | {
      readonly ok: false;
      /** `cart_retained`: 결제가 끝날 때까지 장바구니를 남긴 주문이다(ADR-0026). 장바구니에 이미 있으므로 다시 담지 않는다. */
      readonly error: 'auth_required' | 'account_suspended' | 'not_found' | 'not_canceled' | 'gift_order' | 'cart_retained' | 'failed';
    };

interface OrderRow {
  id: string;
  status: string;
  discount_total: number | null;
  shipping_coupon_discount_total?: number | null;
  store_credit_total: number | null;
  address: unknown;
}

interface RedemptionRow {
  user_coupon_id: string;
  benefit_kind: 'goods' | 'shipping';
}

interface CouponSelectionRow {
  user_coupon_id: string;
}

interface GoodsAvailabilityRow {
  id: string;
  stock: string | null;
  published_at: string | null;
  archived_at: string | null;
}

interface OrderItemRow {
  id: string;
  good_id: string;
  variant_id: string | null;
  qty: number;
  good_name_snapshot: string;
  variant_name_snapshot: string | null;
  custom_inputs_snapshot?: unknown;
}

interface CartRow {
  id: string;
  good_id: string;
  variant_id: string;
  qty: number;
  input_snapshot?: unknown;
}

interface RestoreLine extends CartItem {
  name: string;
}

function lineName(item: OrderItemRow, customInputs?: CartItem['customInputs']) {
  const name = item.variant_name_snapshot
    ? `${item.good_name_snapshot} (${item.variant_name_snapshot})`
    : item.good_name_snapshot;
  const inputSummary = goodsCustomInputSummary(customInputs).replaceAll('\n', ' / ');
  return inputSummary ? `${name} / ${inputSummary}` : name;
}

function lineFailure(message: string): RestoreOrderLineFailure {
  if (message === 'out of stock') return 'out_of_stock';
  if (message === 'catalog_item_unavailable') return 'unavailable';
  if (/goods_custom_inputs/.test(message)) return 'custom_inputs_changed';
  return 'failed';
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;
const MAX_CART_QUANTITY = 2_147_483_647;

/** Read every identity before comparing quantities or verifying a coupon. */
async function readCartItems(supabase: ServerClient, userId: string): Promise<CartItem[] | null> {
  const { data, error } = await readCompleteIdPages<CartRow>((afterId, pageSize) => {
    let query = supabase.from('cart_items')
      .select('id,good_id,variant_id,qty,input_snapshot', { count: 'exact' })
      .eq('user_id', userId).order('id', { ascending: true }).limit(pageSize);
    if (afterId) query = query.gt('id', afterId);
    return query;
  });
  if (error || !data || data.some(row => !Number.isSafeInteger(row.qty) || row.qty <= 0 || row.qty > MAX_CART_QUANTITY)) return null;
  const items = normalizeCartItems(data.map(row => {
    const customInputs = readGoodsCustomInputSnapshot(row.input_snapshot);
    return { goodId: row.good_id, variantId: row.variant_id, qty: row.qty, ...(customInputs ? { customInputs } : {}) };
  }));
  return items.length === data.length ? items : null;
}

/**
 * `catalog_item_unavailable`은 품절·비게시·판매 제한·결제수단 비활성·옵션 보관을 한데
 * 묶는다. 게시 중인 굿즈가 품절로 바뀐 경우만 골라 품절로 알리고, 나머지는 사유를
 * 단정하지 않는다. 조회가 실패하면 그대로 둔다.
 */
async function refineUnavailableLines(
  supabase: ServerClient,
  failures: readonly { goodId: string; line: RestoreOrderSkippedLine }[],
): Promise<RestoreOrderSkippedLine[]> {
  const goodIds = [...new Set(failures.filter((entry) => entry.line.reason === 'unavailable').map((entry) => entry.goodId))];
  if (goodIds.length === 0) return failures.map((entry) => entry.line);
  try {
    const { data, error } = await supabase
      .from('goods')
      .select('id,stock,published_at,archived_at')
      .in('id', goodIds);
    if (error) return failures.map((entry) => entry.line);
    const soldOut = new Set(
      ((data ?? []) as GoodsAvailabilityRow[])
        .filter((good) => good.stock === 'soldout' && good.published_at !== null && good.archived_at === null)
        .map((good) => good.id),
    );
    return failures.map(({ goodId, line }) => (
      line.reason === 'unavailable' && soldOut.has(goodId) ? { ...line, reason: 'sold_out' } : line
    ));
  } catch {
    return failures.map((entry) => entry.line);
  }
}

/** 지금 장바구니 굿즈로는 할인이 성립하지 않는 사유 — 굿즈를 더 담으면 풀린다. */
const COUPON_CONDITION_REASONS = new Set(['coupon_min_subtotal', 'coupon_no_eligible_goods', 'coupon_no_discount']);
/** 그 쿠폰을 다시 고를 수 없는 사유 — 장바구니 쿠폰 목록(active만)에서도 고를 수 없다. */
const COUPON_UNUSABLE_REASONS = new Set([
  'coupon_expired',
  'coupon_already_used',
  'coupon_not_found',
  'coupon_not_owned',
  'coupon_not_started',
  'coupon_archived',
  'coupon_exhausted',
  'coupon_first_purchase_only',
  'coupon_repeat_purchase_only',
]);

/**
 * 쿠폰 판정 사유를 고객이 할 수 있는 다음 행동으로 나눈다. 첫구매 혜택을 잡은 다른 주문
 * (`coupon_first_purchase_reserved|pending`)처럼 장바구니에서 풀 수 있는 사유와 알 수
 * 없는 오류는 `not_restored`로 둔다.
 */
function couponReasonResult(reason: string): 'conditions_unmet' | 'unavailable' | 'not_restored' {
  const normalized = reason.trim().toLowerCase();
  if (COUPON_CONDITION_REASONS.has(normalized)) return 'conditions_unmet';
  if (COUPON_UNUSABLE_REASONS.has(normalized)) return 'unavailable';
  return 'not_restored';
}

type SelectedCouponVerdict =
  | { readonly kind: 'usable' }
  | { readonly kind: 'reason'; readonly reason: string }
  | { readonly kind: 'unknown' };

/**
 * 지금 장바구니 전체로 판매 견적을 받아, 선택된 쿠폰이 할인으로 인정되는지 읽는다.
 * 현재 주문서 런타임의 견적을 사용한다. 거래 견적에는 직접입력값을 포함한 장바구니
 * 전체를 보내고, 기존 견적은 같은 옵션의 수량을 합산해 가격·쿠폰을 판정한다.
 * 배송지나 설정 변경으로 판정하지 못하면 `unknown`이다.
 */
async function verifySelectedCoupon(
  supabase: ServerClient,
  userId: string,
  userCouponId: string,
  address: unknown,
): Promise<SelectedCouponVerdict> {
  try {
    const items = await readCartItems(supabase, userId);
    if (!items || items.length === 0) return { kind: 'unknown' };
    const runtime = await loadGoodsTransactionRuntimeMode();
    if (runtime === 'unavailable') return { kind: 'unknown' };
    if (runtime === 'transaction') {
      const result = await quoteCartTransactionAction({
        expectedActorId: userId, items, address: normalizeCheckoutAddress(address) ?? { kind: 'none' },
        deliveryChoices: {}, userCouponId, storeCreditAmount: 0,
      });
      if (!result.ok || result.quote.state !== 'quoted') return { kind: 'unknown' };
      const { display } = result.quote;
      if (display.userCouponId !== userCouponId) return { kind: 'unknown' };
      return display.totals.couponDiscountTotal + (display.totals.shippingCouponDiscountTotal ?? 0) > 0
        ? { kind: 'usable' } : { kind: 'reason', reason: 'coupon_no_discount' };
    }
    const coupon = (await loadGoodsSalesQuote(aggregateCartVariantQuantities(items), null))?.coupon;
    if (!coupon || coupon.userCouponId !== userCouponId) return { kind: 'unknown' };
    return coupon.reason ? { kind: 'reason', reason: coupon.reason }
      : coupon.discount > 0 ? { kind: 'usable' } : { kind: 'reason', reason: 'coupon_no_discount' };
  } catch {
    return { kind: 'unknown' };
  }
}

/** 이 액션이 방금 만든 장바구니 쿠폰 선택을 푼다. 풀었으면 true. */
async function releaseCouponSelection(supabase: ServerClient): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('clear_cart_coupon');
    return !error;
  } catch {
    return false;
  }
}

/**
 * 원 주문의 굿즈 쿠폰 1장을 장바구니에 다시 선택한다. 다른 쿠폰이 이미 선택돼 있으면 덮지 않는다.
 * 복수·배송비 쿠폰은 자동 선택하지 않고 주문서에서 다시 고르도록 안내한다.
 * 쿠폰 자체의 조건(만료·사용됨·발급 대상)은 `apply_cart_coupon`이, 지금 장바구니에서
 * 할인이 성립하는지는 판매 견적이 다시 판정한다. 할인이 성립하지 않으면 이 액션이 만든
 * 선택을 풀어, 쿠폰 때문에 주문서 제출이 막힌 채로 고객을 보내지 않는다. 고객이 이미 골라
 * 둔 선택은 건드리지 않는다.
 */
async function restoreOrderCoupon(
  supabase: ServerClient,
  userId: string,
  order: OrderRow,
): Promise<RestoreOrderCouponResult | 'checkout_not_restored'> {
  const discounted = (order.discount_total ?? 0) + (order.shipping_coupon_discount_total ?? 0) > 0;
  const unavailableResult = (order.shipping_coupon_discount_total ?? 0) > 0
    ? 'checkout_not_restored' : discounted ? 'not_restored' : 'none';
  try {
    const [{ data: redemptions, error: redemptionError, count }, { data: selection, error: selectionError }] = await Promise.all([
      supabase
        .from('coupon_redemptions')
        .select('user_coupon_id,benefit_kind', { count: 'exact' })
        .eq('order_id', order.id)
        .eq('user_id', userId)
        .eq('status', 'released')
        .eq('release_reason', 'order_canceled')
        .order('applied_at', { ascending: false })
        .limit(2),
      supabase
        .from('cart_coupon_selections')
        .select('user_coupon_id')
        .eq('user_id', userId)
        .maybeSingle<CouponSelectionRow>(),
    ]);
    if (redemptionError) return unavailableResult;
    if (!Number.isSafeInteger(count) || count === null || count < 0) return unavailableResult;
    // A cart stores one selected coupon. Restoring only one of an original
    // combination must not report all benefits restored and auto-open checkout.
    // The exact count also detects a response truncated to one row.
    if (count > 1) return 'checkout_not_restored';
    if (!Array.isArray(redemptions) || redemptions.length !== count) return unavailableResult;
    const redemption = (redemptions as RedemptionRow[])[0];
    if (!redemption) return unavailableResult;
    if (redemption.benefit_kind === 'shipping') return 'checkout_not_restored';
    if (selectionError) return 'not_restored';

    let selectedByAction = false;
    if (selection) {
      if (selection.user_coupon_id !== redemption.user_coupon_id) return 'not_restored';
    } else {
      const { error } = await supabase.rpc('apply_cart_coupon', { p_user_coupon_id: redemption.user_coupon_id });
      if (error) return couponReasonResult(error.message);
      selectedByAction = true;
    }

    const verdict = await verifySelectedCoupon(supabase, userId, redemption.user_coupon_id, order.address);
    if (verdict.kind === 'usable') return 'restored';
    const result = verdict.kind === 'reason' ? couponReasonResult(verdict.reason) : 'not_restored';
    if (selectedByAction && await releaseCouponSelection(supabase)) return result;
    /* 선택이 남아 있으면 주문서 제출이 막힌다 — 장바구니에서 풀도록 안내하는 결과만 쓴다. */
    return result === 'unavailable' ? 'not_restored' : result;
  } catch {
    return 'not_restored';
  }
}

export async function restoreCanceledOrderToCartAction(
  orderIdValue: unknown,
): Promise<RestoreCanceledOrderToCartResult> {
  const orderId = normalizeOrderReference(orderIdValue);
  if (!orderId) return { ok: false, error: 'not_found' };

  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user || !isOnboarded(auth.profile, auth.user.email)) {
    return { ok: false, error: 'auth_required' };
  }
  if (isAccountSuspended(auth.profile)) return { ok: false, error: 'account_suspended' };

  try {
    // Gift order RLS deliberately hides raw order rows from the payer. Resolve
    // the privacy-safe projection before using the ordinary order query.
    const gift = await loadGiftCheckoutOrder(auth.user.id, orderId);
    if (gift.kind === 'gift') return { ok: false, error: 'gift_order' };
    if (gift.kind !== 'ordinary') return { ok: false, error: 'failed' };

    const supabase = await createClient();
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select('id,status,discount_total,shipping_coupon_discount_total,store_credit_total,address')
      .eq('id', orderId)
      .eq('user_id', auth.user.id)
      .maybeSingle<OrderRow>();
    if (orderError) return { ok: false, error: 'failed' };
    if (!orderData) return { ok: false, error: 'not_found' };
    if (orderData.status !== 'canceled') return { ok: false, error: 'not_canceled' };
    /* 장바구니를 남긴 카드 주문은 품목이 장바구니에 그대로 있다. 다시 담으면 고객이 그 뒤에
       뺀 굿즈까지 되살아나므로 담지 않는다(중복 재담기 금지). */
    const { data: retention, error: retentionError } = await createServiceClient().rpc('service_get_order_cart_retention', {
      p_user_id: auth.user.id,
      p_order_id: orderId,
    });
    if (retentionError) return { ok: false, error: 'failed' };
    if (cartRetentionKeepsCart(retention)) return { ok: false, error: 'cart_retained' };

    const [{ data: itemData, error: itemError }, cartItems] = await Promise.all([
      /* 마스킹 RPC로 읽는다 — 랜덤 판매 굿즈(D5②)의 배정 행은 직접 읽기에서 빠지고, RPC는 그 행의 variant_id를
         장바구니 키(기본 옵션)로 돌려준다. 배정 옵션을 다시 담으면 고객이 옵션을 고르는 우회로가 된다. */
      readMyOrderItems<OrderItemRow>(supabase, [orderId], 'id,good_id,variant_id,qty,good_name_snapshot,variant_name_snapshot,custom_inputs_snapshot'),
      readCartItems(supabase, auth.user.id),
    ]);
    if (itemError || !itemData || !cartItems) return { ok: false, error: 'failed' };

    const lines = new Map<string, RestoreLine>();
    const failures: { goodId: string; line: RestoreOrderSkippedLine }[] = [];
    for (const item of itemData) {
      // 옵션 도입 전 주문 품목은 옵션 식별자가 없어 같은 옵션을 다시 지목할 수 없다.
      if (!item.variant_id || !Number.isSafeInteger(item.qty) || item.qty <= 0 || item.qty > MAX_CART_QUANTITY) {
        failures.push({ goodId: item.good_id, line: { name: lineName(item), reason: 'unavailable' } });
        continue;
      }
      let customInputs: CartItem['customInputs'];
      try {
        customInputs = readGoodsCustomInputSnapshot(item.custom_inputs_snapshot) ?? undefined;
      } catch {
        failures.push({ goodId: item.good_id, line: { name: lineName(item), reason: 'custom_inputs_changed' } });
        continue;
      }
      const key = cartItemKey(item.good_id, item.variant_id, customInputs);
      const previous = lines.get(key);
      const qty = (previous?.qty ?? 0) + item.qty;
      if (!Number.isSafeInteger(qty) || qty > MAX_CART_QUANTITY) return { ok: false, error: 'failed' };
      lines.set(key, {
        goodId: item.good_id,
        variantId: item.variant_id,
        qty,
        name: previous?.name ?? lineName(item, customInputs),
        ...(customInputs ? { customInputs } : {}),
      });
    }

    const cartQuantities = new Map(
      cartItems.map(item => [cartItemKey(item.goodId, item.variantId, item.customInputs), item.qty]),
    );

    let restoredLines = 0;
    for (const line of lines.values()) {
      const current = cartQuantities.get(cartItemKey(line.goodId, line.variantId, line.customInputs)) ?? 0;
      // Revalidate even when the quantity is already sufficient: an old input
      // definition or a newly unavailable product must not be called restored.
      const { error } = await supabase.rpc('merge_cart_items', {
        p_items: [{
          good_id: line.goodId,
          variant_id: line.variantId,
          qty: Math.max(current, line.qty),
          input_revision: line.customInputs?.revision ?? 0,
          input_values: goodsCustomInputValues(line.customInputs),
        }],
      });
      if (error) {
        failures.push({ goodId: line.goodId, line: { name: line.name, reason: lineFailure(error.message) } });
      } else {
        restoredLines += 1;
      }
    }

    const skipped = await refineUnavailableLines(supabase, failures);
    /* 담긴 굿즈가 없으면 쿠폰을 빈 장바구니에 걸어 두지 않는다 — 보유 쿠폰은 이미
       active로 돌아와 있다. */
    const hadCoupon = (orderData.discount_total ?? 0) + (orderData.shipping_coupon_discount_total ?? 0) > 0;
    const coupon = restoredLines > 0
      ? await restoreOrderCoupon(supabase, auth.user.id, orderData)
      : hadCoupon ? 'not_restored' : 'none';

    return {
      ok: true,
      restoredLines,
      skipped,
      coupon: coupon === 'checkout_not_restored' ? 'not_restored' : coupon,
      ...(coupon === 'checkout_not_restored' ? { couponReselectAt: 'checkout' as const } : {}),
      storeCreditUsed: Math.max(0, orderData.store_credit_total ?? 0),
    };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
