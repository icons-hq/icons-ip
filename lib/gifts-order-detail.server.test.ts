import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGiftOrderList } from './gifts-order-detail.server';

const mocks = vi.hoisted(() => ({ loadGifts: vi.fn(), rpc: vi.fn() }));
vi.mock('./gifts.server', () => ({ loadGifts: mocks.loadGifts }));
vi.mock('./supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

const ORDER_A = '11111111-1111-4111-8111-111111111111';
const ORDER_B = '22222222-2222-4222-8222-222222222222';

function gift(id: string, orderId: string, status: string) {
  return {
    id, createdAt: '2026-10-27T00:00:00.000Z', items: [{ name: '선물 굿즈', qty: 1 }],
    order: { id: orderId, status, total: 12000, createdAt: '2026-10-27T00:00:00.000Z', paymentMethod: 'card' },
  };
}

const CLAIM = {
  id: '33333333-3333-4333-8333-333333333333', status: 'processing', claimType: 'cancel', stage: 'processing', reference: 7,
  requestedAt: '2026-10-27T01:00:00.000Z', decidedAt: null, decisionNote: null, reshipCarrier: null, reshipTrackingNumber: null, reshipDeliveredAt: null,
};

beforeEach(() => {
  mocks.loadGifts.mockReset().mockResolvedValue({ items: [gift('gift-a', ORDER_A, 'paid'), gift('gift-b', ORDER_B, 'paid')], hasMore: false });
  mocks.rpc.mockReset().mockImplementation(async (_name: string, args: { p_order_id: string }) => ({ data: args.p_order_id === ORDER_A ? CLAIM : null, error: null }));
});

/* 10/14 회의 S20 — 선물 주문도 목록 배지를 상세와 같은 규칙(같은 투영 RPC)으로 보인다. */
describe('loadGiftOrderList claim badge', () => {
  it('reads each gift order latest claim through the sender-only projection', async () => {
    const orders = await loadGiftOrderList(false);

    expect(mocks.rpc.mock.calls).toEqual([
      ['get_my_gift_latest_claim', { p_order_id: ORDER_A }],
      ['get_my_gift_latest_claim', { p_order_id: ORDER_B }],
    ]);
    expect(orders.map((order) => [order.id, order.claim])).toEqual([
      [ORDER_A, { claimType: 'cancel', stage: 'processing' }],
      [ORDER_B, null],
    ]);
  });

  it('fails instead of silently dropping a claim it could not read', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });

    await expect(loadGiftOrderList(false)).rejects.toThrow('gift_claim_history_failed');
  });

  it('does not call the claim projection when there is no gift order', async () => {
    mocks.loadGifts.mockResolvedValue({ items: [], hasMore: false });

    await expect(loadGiftOrderList(false)).resolves.toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
