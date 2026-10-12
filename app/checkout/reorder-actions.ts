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
 */

export type RestoreOrderLineFailure = 'out_of_stock' | 'unavailable' | 'failed';

export interface RestoreOrderSkippedLine {
  readonly name: string;
  readonly reason: RestoreOrderLineFailure;
}

export type RestoreCanceledOrderToCartResult =
  | { readonly ok: true; readonly restoredLines: number; readonly skipped: readonly RestoreOrderSkippedLine[] }
  | {
      readonly ok: false;
      readonly error: 'auth_required' | 'account_suspended' | 'not_found' | 'not_canceled' | 'failed';
    };

interface OrderRow {
  id: string;
  status: string;
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
      .select('id,status')
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
    const skipped: RestoreOrderSkippedLine[] = [];
    for (const item of (itemData ?? []) as OrderItemRow[]) {
      // 옵션 도입 전 주문 품목은 옵션 식별자가 없어 같은 옵션을 다시 지목할 수 없다.
      if (!item.variant_id || !Number.isSafeInteger(item.qty) || item.qty <= 0) {
        skipped.push({ name: lineName(item), reason: 'unavailable' });
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
        skipped.push({ name: line.name, reason: lineFailure(error.message) });
      } else {
        restoredLines += 1;
      }
    }

    return { ok: true, restoredLines, skipped };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
