import 'server-only';

import { loadGoodsReviewEvents } from '@/lib/review-events.server';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { pickOrderReviewEvents, reviewableOrderIds } from './order-review-events';
import type { OrderListItem } from './orders';
import type { PublicReviewEvent } from './review-events';

/* 주문 내역의 리뷰 보상 배너 로더 (LFS 패리티 2차 L6 · MY-08).
 *
 * 화면에 실린 내 주문(RLS — order_items 는 본인 주문 행만 보인다)의 굿즈 ID 를 모아 기존 공개 RPC
 * get_goods_review_events 로 진행 중 이벤트를 묻는다(loadGoodsReviewEvents — 500개씩 나눠 묻는다).
 * 배너는 장식이다 — 어떤 실패도 던지지 않고 배너 없음으로 접는다. 주문 목록이 500 이 되면 안 된다. */
export async function loadOrderReviewEvents(orders: readonly OrderListItem[]): Promise<PublicReviewEvent[]> {
  const orderIds = reviewableOrderIds(orders);
  if (!orderIds.length || !getSupabaseConfig().isConfigured) return [];
  try {
    const supabase = await createClient();
    const items = await readCompleteIdPages<{ id: string; good_id: string }>((afterId, pageSize) => {
      let query = supabase
        .from('order_items')
        .select('id,good_id', { count: 'exact' })
        .in('order_id', orderIds)
        .order('id', { ascending: true })
        .limit(pageSize);
      if (afterId) query = query.gt('id', afterId);
      return query;
    });
    if (items.error || !items.data?.length) return [];
    const events = await loadGoodsReviewEvents([...new Set(items.data.map((item) => item.good_id))]);
    return pickOrderReviewEvents(events);
  } catch {
    return [];
  }
}
