import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 선물 결제도 일반 주문서와 같은 결제 전 확인 동의(PAY-015)와 제한 고지 대조를 거친다 — 선물 런타임이 켜질 때 뚫리지 않게. */
const ACTOR = '93942000-0000-4000-8000-000000000001', GIFT = '93942000-0000-4000-8000-000000000010';
const QUOTE = '93942000-0000-4000-8000-000000000040', KEY = '93942000-0000-4000-8000-000000000050', ORDER = '93942000-0000-4000-8000-000000000060';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), loadGift: vi.fn(), verify: vi.fn(), record: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => ({ user: { id: ACTOR, email: 'a@example.test' }, profile: {} }) }));
vi.mock('@/lib/auth/onboarding', () => ({ isAccountSuspended: () => false, isOnboarded: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/gifts.server', () => ({ loadGift: mocks.loadGift, giftClaimSessionHash: vi.fn(), giftSecretHash: vi.fn(), maskRandomGiftOptions: vi.fn() }));
vi.mock('@/lib/payments/goods-checkout-availability', () => ({ goodsCheckoutPaymentsEnabled: () => true }));
vi.mock('@/lib/payments/bank-transfer.server', () => ({ bankTransferCheckoutEnabled: async () => true }));
vi.mock('@/lib/checkout-acknowledgement.server', () => ({ verifyClaimNotice: mocks.verify, recordOrderPurchaseAcknowledgement: mocks.record }));

import { placeGiftAction } from './actions';

const placed = () => mocks.rpc.mock.calls.filter(([name]) => name === 'place_my_gift');
beforeEach(() => {
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === 'replay_my_gift_order' ? null : ORDER, error: null }));
  mocks.loadGift.mockReset().mockResolvedValue({ id: GIFT, items: [{ goodId: 'g1' }, { goodId: 'g2' }] });
  mocks.verify.mockReset().mockResolvedValue('ok');
  mocks.record.mockReset().mockResolvedValue(true);
});

describe('placeGiftAction 결제 전 확인 동의', () => {
  it.each([[undefined, []], [false, []], ['true', []], [true, undefined], [true, 'nope'], [true, [1]]])('동의=%s 고지=%j 이면 주문을 만들지 않는다(카드·무통장)', async (ack, notice) => {
    for (const method of ['card', 'bank_transfer']) {
      const result = await placeGiftAction(GIFT, QUOTE, KEY, method, ACTOR, ack, notice);
      expect(result).toMatchObject({ error: expect.stringContaining('동의') });
    }
    expect(placed()).toHaveLength(0);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('동의가 있으면 선물 상품으로 제한 고지를 대조한 뒤 주문을 만들고 동의를 기록한다', async () => {
    await expect(placeGiftAction(GIFT, QUOTE, KEY, 'bank_transfer', ACTOR, true, ['g2'])).resolves.toEqual({ orderId: ORDER });
    expect(mocks.verify).toHaveBeenCalledWith(['g1', 'g2'], ['g2']);
    expect(placed()).toHaveLength(1);
    expect(mocks.record).toHaveBeenCalledWith(ACTOR, ORDER, ['g2']);
  });

  it('화면에 없던 제한 상품이 있으면 주문을 만들지 않는다', async () => {
    mocks.verify.mockResolvedValue('changed');
    await expect(placeGiftAction(GIFT, QUOTE, KEY, 'card', ACTOR, true, [])).resolves.toMatchObject({ error: expect.stringContaining('안내가 바뀌었어요') });
    expect(placed()).toHaveLength(0);
    mocks.verify.mockResolvedValue('unavailable');
    await expect(placeGiftAction(GIFT, QUOTE, KEY, 'card', ACTOR, true, 'unavailable')).resolves.toMatchObject({ error: expect.stringContaining('확인하지 못했어요') });
    expect(placed()).toHaveLength(0);
  });

  it('이미 만든 주문의 재확인(replay)은 동의 없이도 원 주문을 돌려준다', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'replay_my_gift_order' ? ORDER : null, error: null }));
    await expect(placeGiftAction(GIFT, QUOTE, KEY, 'card', ACTOR)).resolves.toEqual({ orderId: ORDER });
    expect(placed()).toHaveLength(0);
  });
});
