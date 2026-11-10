import 'server-only';

import { loadGoodsReviewEvents } from '@/lib/review-events.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { readMyOrderItems } from '@/lib/orders/customer-items.server';
import { pickOrderReviewEvents, reviewableOrderIds } from './order-review-events';
import type { OrderListItem } from './orders';
import type { PublicReviewEvent } from './review-events';

/* 주문 내역의 리뷰 보상 배너 로더 (LFS 패리티 2차 L6 · MY-08).
 *
 * 화면에 실린 내 주문(마스킹 RPC my_order_items — 본인 주문 행만 돌려준다)의 굿즈 ID 를 모아 기존 공개 RPC
 * get_goods_review_events 로 진행 중 이벤트를 묻는다(loadGoodsReviewEvents — 500개씩 나눠 묻는다).
 * 배너는 장식이다 — 어떤 실패도 던지지 않고 배너 없음으로 접는다. 주문 목록이 500 이 되면 안 된다. */
export async function loadOrderReviewEvents(orders: readonly OrderListItem[]): Promise<PublicReviewEvent[]> {
  const orderIds = reviewableOrderIds(orders);
  if (!orderIds.length || !getSupabaseConfig().isConfigured) return [];
  try {
    const supabase = await createClient();
    /* 마스킹 RPC로 읽는다 — 랜덤 판매 굿즈(D5②)의 배정 행은 order_items 직접 읽기에서 빠진다. */
    const items = await readMyOrderItems<{ id: string; good_id: string }>(supabase, orderIds, 'id,good_id');
    if (items.error || !items.data?.length) return [];
    const events = await loadGoodsReviewEvents([...new Set(items.data.map((item) => item.good_id))]);
    return pickOrderReviewEvents(events);
  } catch {
    return [];
  }
}
