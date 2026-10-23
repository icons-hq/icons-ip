import { describe, expect, it } from 'vitest';
import type { OrderListItem } from './orders';
import type { PublicReviewEvent } from './review-events';
import { pickOrderReviewEvents, reviewableOrderIds } from './order-review-events';

function order(id: string, status: OrderListItem['status'], giftId?: string): OrderListItem {
  return { id, status, total: 1000, createdAt: '2026-10-01T00:00:00.000Z', itemLabel: id, itemCount: 1, paymentMethod: 'card', ...(giftId ? { giftId } : {}) };
}

function event(id: string, creditAmount: number, startsOn = '2026-10-20'): PublicReviewEvent {
  return { id, title: id, description: id, startsOn, endsOn: '2026-10-31', announcesOn: '2026-11-05', plannedWinners: 1, creditAmount, creditValidityDays: 30, bannerStyle: 'basic', state: 'active', announcedAt: null, nextChangeAt: null } as PublicReviewEvent;
}

describe('order review events', () => {
  it('collects goods only from orders that can lead to a review', () => {
    expect(reviewableOrderIds([
      order('paid', 'paid'), order('pending', 'pending'), order('canceled', 'canceled'), order('done', 'done'), order('gift', 'delivered', 'gift-1'),
    ])).toEqual(['paid', 'done']);
  });

  it('folds per-goods rows into distinct events, larger reward first, up to the limit', () => {
    const picked = pickOrderReviewEvents({ rows: [
      { goodId: 'g1', event: event('small', 1000) },
      { goodId: 'g2', event: event('big', 5000) },
      { goodId: 'g3', event: event('big', 5000) },
      { goodId: 'g4', event: event('mid-late', 3000, '2026-10-22') },
      { goodId: 'g5', event: event('mid-early', 3000, '2026-10-18') },
    ] });

    expect(picked.map((item) => item.id)).toEqual(['big', 'mid-early']);
    expect(pickOrderReviewEvents({ rows: [] })).toEqual([]);
  });
});
