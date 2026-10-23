import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderListItem } from './orders';
import { loadOrderReviewEvents } from './order-review-events.server';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  configured: true,
  items: { data: [] as unknown[] | null, error: null as { message: string } | null, count: 0 as number | null },
  filters: [] as unknown[][],
  loadGoodsReviewEvents: vi.fn(),
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/review-events.server', () => ({ loadGoodsReviewEvents: mocks.loadGoodsReviewEvents }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const query = {
        select: () => query,
        in: (column: string, values: unknown) => { mocks.filters.push([table, column, values]); return query; },
        order: () => query,
        limit: () => query,
        gt: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.items).then(resolve),
      };
      return query;
    },
  }),
}));

function order(id: string, status: OrderListItem['status']): OrderListItem {
  return { id, status, total: 1000, createdAt: '2026-10-01T00:00:00.000Z', itemLabel: id, itemCount: 1, paymentMethod: 'card' };
}

const EVENT = { id: 'event-1', creditAmount: 3000, startsOn: '2026-10-20' };

describe('loadOrderReviewEvents', () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.filters = [];
    mocks.items = { data: [{ id: 'i1', good_id: 'g1' }, { id: 'i2', good_id: 'g1' }, { id: 'i3', good_id: 'g2' }], error: null, count: 3 };
    mocks.loadGoodsReviewEvents.mockReset().mockResolvedValue({ rows: [{ goodId: 'g1', event: EVENT }], nextChangeAt: null });
  });

  it("asks events for the distinct goods of the member's reviewable orders", async () => {
    expect(await loadOrderReviewEvents([order('o1', 'delivered'), order('o2', 'canceled')])).toEqual([EVENT]);
    expect(mocks.filters).toEqual([['order_items', 'order_id', ['o1']]]);
    expect(mocks.loadGoodsReviewEvents).toHaveBeenCalledWith(['g1', 'g2']);
  });

  /* 배너는 장식이다 — 읽기 실패·잘린 목록은 배너 없음으로 접고, 대상 주문이 없으면 묻지 않는다. */
  it('folds failures to no banner and skips work without reviewable orders', async () => {
    mocks.items = { data: null, error: { message: 'down' }, count: null };
    expect(await loadOrderReviewEvents([order('o1', 'paid')])).toEqual([]);

    mocks.items = { data: [{ id: 'i1', good_id: 'g1' }], error: null, count: 5 };
    expect(await loadOrderReviewEvents([order('o1', 'paid')])).toEqual([]);

    expect(await loadOrderReviewEvents([order('o3', 'pending'), order('o4', 'canceled')])).toEqual([]);
    expect(mocks.loadGoodsReviewEvents).not.toHaveBeenCalled();
  });
});
