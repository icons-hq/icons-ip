import type { OrderListItem } from './orders';
import type { GoodsReviewEvents, PublicReviewEvent } from './review-events';

/* 주문 내역 상단의 리뷰 보상 배너 (LFS 패리티 2차 L6 · MY-08 — 11 §5.3).
 *
 * 레퍼런스는 주문 목록 위에 "리뷰를 쓰면 보상" 안내를 늘 띄운다. ICONS 의 리뷰 보상은 굿즈 대상별 리뷰 이벤트라
 * (get_goods_review_events — 진행 중이고 발표 전인 이벤트만, 굿즈마다 보상이 큰 하나), 내 주문에 든 굿즈에
 * 진행 중 이벤트가 있을 때만 기존 ReviewEventBanner 를 보인다. 보상 명칭·금액은 이벤트가 말한다(적립금 등).
 * 결제 대기·취소 주문은 리뷰로 이어지지 않으므로 대상 굿즈를 모을 때 뺀다. */

/** 주문 화면 위에 세우는 배너 수 — 레퍼런스처럼 한 장(보상이 가장 큰 이벤트)만 둔다. 배너가 쌓이면 주문 목록이
    첫 화면 밖으로 밀린다. 다른 이벤트는 배너가 여는 리뷰 이벤트 안내에서 이어 본다. */
export const ORDER_REVIEW_EVENT_LIMIT = 1;

/** 리뷰 대상이 될 수 있는 주문(선물 주문·결제 대기·취소 제외)의 ID. 선물 주문 품목은 받는 사람 몫이다. */
export function reviewableOrderIds(orders: readonly OrderListItem[]): string[] {
  return orders
    .filter((order) => !order.giftId && order.status !== 'pending' && order.status !== 'canceled')
    .map((order) => order.id);
}

/** 굿즈별 이벤트를 이벤트 단위로 접고, 보상이 큰 순서로 상한만큼 고른다. */
export function pickOrderReviewEvents(events: Pick<GoodsReviewEvents, 'rows'>, limit = ORDER_REVIEW_EVENT_LIMIT): PublicReviewEvent[] {
  const byId = new Map<string, PublicReviewEvent>();
  for (const row of events.rows) if (!byId.has(row.event.id)) byId.set(row.event.id, row.event);
  return [...byId.values()]
    .sort((left, right) => right.creditAmount - left.creditAmount || left.startsOn.localeCompare(right.startsOn) || left.id.localeCompare(right.id))
    .slice(0, limit);
}
