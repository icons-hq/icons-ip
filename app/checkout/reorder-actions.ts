'use server';

import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { createClient } from '@/lib/supabase/server';

/*
 * 취소된 굿즈 주문의 품목(굿즈·옵션·수량)을 장바구니에 다시 담는다.
 *
 * 결제가 닫힌 주문을 "취소하고 다시 주문"하는 흐름의 두 번째 단계다. 취소는 기존 고객
 * 취소 경로(/api/orders/[orderId]/cancel)가 끝내고, 이 액션은 DB가 취소를 확정한
 * (`orders.status = 'canceled'`) 주문만 받는다 — 클라이언트가 "취소됐다"고 말하는 것을
 * 근거로 삼지 않는다.
 *
 * 담기는 장바구니 수량 RPC(`set_cart_item_quantity`)를 한 줄씩 그대로 쓴다. 게시·보관·
 * 판매 제한·옵션 재고 검증이 그 RPC 안에 있으므로, 품절·판매 중지는 기존 규칙대로 그
 * 줄만 실패하고 나머지는 담긴다. 1인 구매 한도·쿠폰 조건은 주문서 견적과 주문 RPC가
 * 다시 판정한다. 이미 장바구니에 같은 옵션이 있으면 수량을 더하지 않고 둘 중 큰 값으로
 * 맞춘다(장바구니 병합과 같은 규칙) — 같은 주문을 두 번 복원해도 수량이 불어나지 않는다.
 *
 * 혜택: 주문 생성이 장바구니 쿠폰 선택을 소비하므로(place_order), 취소 트리거가 보유
 * 쿠폰을 active로 되돌려도 새 주문서에는 쿠폰이 없다. 그 주문의 쿠폰 사용 원장
 * (`coupon_redemptions`, 취소로 released)에서 보유 쿠폰을 찾아 기존 RPC
 * `apply_cart_coupon`으로 다시 선택한다. 장바구니에 이미 다른 쿠폰이 선택돼 있으면
 * 고객의 새 선택을 덮지 않는다. 적립금은 주문서에서 매번 입력하는 값이라 다시 적용할
 * 상태가 없으므로, 원 주문의 사용액을 돌려줘 화면이 다시 입력하라고 안내하게 한다.
 */

/**
 * 담지 못한 줄의 사유. `sold_out`은 게시 중인 굿즈가 품절로 바뀐 경우,
 * `unavailable`은 그 밖에 지금 담을 수 없는 경우(비게시·보관·판매 제한·결제수단
 * 비활성·옵션 보관·옵션 식별자 없는 옛 주문)다.
 */
export type RestoreOrderLineFailure = 'out_of_stock' | 'sold_out' | 'unavailable' | 'failed';

/**
 * 원 주문 쿠폰의 재적용 결과. `none`은 쿠폰을 쓰지 않은 주문이고, `not_restored`는
 * 쿠폰을 썼지만 장바구니에 다시 선택하지 못했다(만료·다른 주문에 사용·이미 다른 쿠폰
 * 선택·조회 실패 등) — 고객이 장바구니에서 직접 골라야 한다.
 */
export type RestoreOrderCouponResult = 'none' | 'restored' | 'not_restored';

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
      /** 원 주문에서 사용한 적립금. 주문서 입력은 비어 있으므로 0보다 크면 다시 입력해야 한다. */
      readonly storeCreditUsed: number;
    }
  | {
      readonly ok: false;
      readonly error: 'auth_required' | 'account_suspended' | 'not_found' | 'not_canceled' | 'failed';
    };

interface OrderRow {
  id: string;
  status: string;
  discount_total: number | null;
  store_credit_total: number | null;
}

interface RedemptionRow {
  user_coupon_id: string;
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
  good_id: string;
  variant_id: string | null;
  qty: number;
  good_name_snapshot: string;
  variant_name_snapshot: string | null;
}

interface CartRow {
  variant_id: string;
  qty: number;
}

interface RestoreLine {
  goodId: string;
  variantId: string;
  qty: number;
  name: string;
}

function lineName(item: OrderItemRow) {
  return item.variant_name_snapshot
    ? `${item.good_name_snapshot} (${item.variant_name_snapshot})`
    : item.good_name_snapshot;
}

function lineFailure(message: string): RestoreOrderLineFailure {
  if (message === 'out of stock') return 'out_of_stock';
  if (message === 'catalog_item_unavailable') return 'unavailable';
  return 'failed';
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

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

/**
 * 원 주문의 쿠폰을 장바구니에 다시 선택한다. 다른 쿠폰이 이미 선택돼 있으면 덮지 않는다.
 * 쿠폰 조건(만료·사용됨·대상 굿즈)은 `apply_cart_coupon`이 다시 판정한다.
 */
async function restoreOrderCoupon(
  supabase: ServerClient,
  userId: string,
  order: OrderRow,
): Promise<RestoreOrderCouponResult> {
  const discounted = (order.discount_total ?? 0) > 0;
  try {
    const [{ data: redemption, error: redemptionError }, { data: selection, error: selectionError }] = await Promise.all([
      supabase
        .from('coupon_redemptions')
        .select('user_coupon_id')
        .eq('order_id', order.id)
        .eq('user_id', userId)
        .eq('status', 'released')
        .eq('release_reason', 'order_canceled')
        .order('applied_at', { ascending: false })
        .limit(1)
        .maybeSingle<RedemptionRow>(),
      supabase
        .from('cart_coupon_selections')
        .select('user_coupon_id')
        .eq('user_id', userId)
        .maybeSingle<CouponSelectionRow>(),
    ]);
    if (redemptionError) return discounted ? 'not_restored' : 'none';
    if (!redemption) return discounted ? 'not_restored' : 'none';
    if (selectionError) return 'not_restored';
    if (selection) return selection.user_coupon_id === redemption.user_coupon_id ? 'restored' : 'not_restored';
    const { error } = await supabase.rpc('apply_cart_coupon', { p_user_coupon_id: redemption.user_coupon_id });
    return error ? 'not_restored' : 'restored';
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
    const supabase = await createClient();
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select('id,status,discount_total,store_credit_total')
      .eq('id', orderId)
      .eq('user_id', auth.user.id)
      .maybeSingle<OrderRow>();
    if (orderError) return { ok: false, error: 'failed' };
    if (!orderData) return { ok: false, error: 'not_found' };
    if (orderData.status !== 'canceled') return { ok: false, error: 'not_canceled' };

    const [{ data: itemData, error: itemError }, { data: cartData, error: cartError }] = await Promise.all([
      supabase
        .from('order_items')
        .select('good_id,variant_id,qty,good_name_snapshot,variant_name_snapshot')
        .eq('order_id', orderId)
        .order('id'),
      supabase
        .from('cart_items')
        .select('variant_id,qty')
        .eq('user_id', auth.user.id),
    ]);
    if (itemError || cartError) return { ok: false, error: 'failed' };

    const lines = new Map<string, RestoreLine>();
    const failures: { goodId: string; line: RestoreOrderSkippedLine }[] = [];
    for (const item of (itemData ?? []) as OrderItemRow[]) {
      // 옵션 도입 전 주문 품목은 옵션 식별자가 없어 같은 옵션을 다시 지목할 수 없다.
      if (!item.variant_id || !Number.isSafeInteger(item.qty) || item.qty <= 0) {
        failures.push({ goodId: item.good_id, line: { name: lineName(item), reason: 'unavailable' } });
        continue;
      }
      const previous = lines.get(item.variant_id);
      lines.set(item.variant_id, {
        goodId: item.good_id,
        variantId: item.variant_id,
        qty: (previous?.qty ?? 0) + item.qty,
        name: previous?.name ?? lineName(item),
      });
    }

    const cartQuantities = new Map(
      ((cartData ?? []) as CartRow[]).map((row) => [row.variant_id, row.qty]),
    );

    let restoredLines = 0;
    for (const line of lines.values()) {
      const current = cartQuantities.get(line.variantId) ?? 0;
      if (current >= line.qty) {
        restoredLines += 1;
        continue;
      }
      const { error } = await supabase.rpc('set_cart_item_quantity', {
        p_good_id: line.goodId,
        p_variant_id: line.variantId,
        p_qty: line.qty,
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
    const hadCoupon = (orderData.discount_total ?? 0) > 0;
    const coupon: RestoreOrderCouponResult = restoredLines > 0
      ? await restoreOrderCoupon(supabase, auth.user.id, orderData)
      : hadCoupon ? 'not_restored' : 'none';

    return {
      ok: true,
      restoredLines,
      skipped,
      coupon,
      storeCreditUsed: Math.max(0, orderData.store_credit_total ?? 0),
    };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
