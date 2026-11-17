import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGiftOrderDetail, loadGiftOrderList } from './gifts-order-detail.server';
import type { GiftCheckoutOrderResult } from './gifts-order.server';
import { transactionDisplay, transactionLineId } from '@/test/fixtures/cart-transaction';

const mocks = vi.hoisted(() => ({ loadGifts: vi.fn(), rpc: vi.fn(), from: vi.fn(), lines: vi.fn() }));
vi.mock('./gifts.server', () => ({ loadGifts: mocks.loadGifts }));
vi.mock('./supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
/* 품목 줄 보강(MD-0036)은 굿즈·IP·영수증을 읽는다 — 여기서는 입력과 결과 연결만 본다. */
vi.mock('./orders/order-lines.server', () => ({ loadOrderLineViews: mocks.lines }));

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
  mocks.lines.mockReset().mockImplementation(async () => new Map());
  mocks.from.mockReset();
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

/* MD-0036: 선물 주문 목록도 품목 줄을 그린다. 선물 RPC는 품목 id·가격을 주지 않아 굿즈·옵션 키로 줄을 만들고 영수증으로 가격을 맞춘다. */
describe('loadGiftOrderList lines', () => {
  const VARIANT = '44444444-4444-4444-8444-444444444444';
  const withItems = (id: string, orderId: string) => ({
    ...gift(id, orderId, 'paid'),
    items: [
      { goodId: 'good-1', variantId: VARIANT, name: '선물 굿즈', variantName: '파랑', qty: 2, imagePath: 'goods/gift.webp', customInputs: null },
      { goodId: 'good-2', variantId: VARIANT, name: '다른 굿즈', variantName: '기본 옵션', qty: 1, imagePath: null, customInputs: null },
    ],
  });

  it('withLines면 선물 품목으로 줄 입력을 만들어(이미지 경로 우선, 가격은 영수증에서) 주문에 붙인다', async () => {
    mocks.loadGifts.mockResolvedValue({ items: [withItems('gift-a', ORDER_A), withItems('gift-b', ORDER_B)], hasMore: false });
    const lineA = [{ key: `good-1:${VARIANT}`, goodId: 'good-1', name: '선물 굿즈' }];
    mocks.lines.mockResolvedValue(new Map([[ORDER_A, lineA]]));

    const orders = await loadGiftOrderList(false, { withLines: true });

    expect(mocks.lines).toHaveBeenCalledTimes(1);
    expect(mocks.lines.mock.calls[0][1]).toEqual([
      { orderId: ORDER_A, tryReceipt: true, items: [
        { key: `good-1:${VARIANT}`, goodId: 'good-1', variantId: VARIANT, name: '선물 굿즈', optionName: '파랑', qty: 2, unitPrice: null, imagePath: 'goods/gift.webp' },
        { key: `good-2:${VARIANT}`, goodId: 'good-2', variantId: VARIANT, name: '다른 굿즈', optionName: '기본 옵션', qty: 1, unitPrice: null, imagePath: null },
      ] },
      expect.objectContaining({ orderId: ORDER_B, tryReceipt: true }),
    ]);
    expect(orders.find((order) => order.id === ORDER_A)?.lines).toBe(lineA);
    /* 줄이 없는 주문은 lines 키 없이 요약으로 남는다. */
    expect(orders.find((order) => order.id === ORDER_B)).not.toHaveProperty('lines');
  });

  it('withLines가 아니면 품목 줄을 읽지 않는다', async () => {
    mocks.loadGifts.mockResolvedValue({ items: [withItems('gift-a', ORDER_A)], hasMore: false });
    const orders = await loadGiftOrderList(false);
    expect(mocks.lines).not.toHaveBeenCalled();
    expect(orders[0]).not.toHaveProperty('lines');
  });
});

describe('loadGiftOrderDetail lines·provider', () => {
  const chain = (result: unknown) => {
    const proxy: unknown = new Proxy(() => undefined, {
      get: (_target, property) => property === 'then'
        ? (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
        : () => proxy,
    });
    return proxy;
  };

  it('이미 읽은 거래 영수증으로 줄을 만들고 결제 provider를 싣는다(영수증을 다시 읽지 않는다)', async () => {
    mocks.from.mockImplementation((table: string) => chain(table === 'payment_summaries'
      ? { data: [{ id: 'payment-1', amount: 16000, status: 'paid', created_at: '2026-10-27T00:01:00.000Z', provider: 'toss' }], error: null }
      : table === 'refunds' ? { data: null, error: null } : { data: [], error: null }));
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'order_claim_eligibility' ? { cancel: true, return: false, exchange: false } : null, error: null }));
    const lines = [{ key: transactionLineId }];
    mocks.lines.mockResolvedValue(new Map([[ORDER_A, lines]]));
    const result = { kind: 'gift', order: { id: ORDER_A, status: 'paid', deliveredAt: null, transaction: transactionDisplay, giftId: 'gift-a',
      items: [{ id: transactionLineId, goodId: 'transaction-good', variantId: transactionDisplay.lines[0].variantId, variantName: '파랑', name: '선물 굿즈', qty: 2, unitPrice: 10000 }] } } as unknown as Extract<GiftCheckoutOrderResult, { kind: 'gift' }>;

    const detail = await loadGiftOrderDetail('user-1', result);

    expect(mocks.lines).toHaveBeenCalledWith(expect.anything(), [{ orderId: ORDER_A, tryReceipt: false, receipt: transactionDisplay,
      items: [{ key: transactionLineId, lineId: transactionLineId, goodId: 'transaction-good', variantId: transactionDisplay.lines[0].variantId, name: '선물 굿즈', optionName: '파랑', qty: 2, unitPrice: 10000 }] }]);
    expect(detail.lines).toBe(lines);
    expect(detail.payment).toEqual({ amount: 16000, status: 'paid', createdAt: '2026-10-27T00:01:00.000Z', provider: 'toss' });
  });
});
