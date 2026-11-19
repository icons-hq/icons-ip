import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), query: vi.fn(), error: vi.spyOn(console, 'error') }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: mocks.rpc,
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'not', 'is']) chain[name] = () => chain;
      chain.or = () => mocks.query();
      return chain;
    },
  }),
}));

import { loadCheckoutClaimRestrictions, recordOrderPurchaseAcknowledgement } from './checkout-acknowledgement.server';
import { CHECKOUT_ACKNOWLEDGEMENT_VERSION } from './checkout-acknowledgement';

const USER = '00000000-0000-4000-8000-000000000001';
const ORDER = '5cbcbbed-202d-4676-821a-7706398e57c0';

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.query.mockReset();
  mocks.error.mockReset().mockImplementation(() => undefined);
});

describe('recordOrderPurchaseAcknowledgement', () => {
  it('한 번에 기록되면 같은 인자로 한 번만 부른다', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(recordOrderPurchaseAcknowledgement(USER, ORDER)).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('record_order_purchase_acknowledgement', { p_user_id: USER, p_order_id: ORDER, p_notice_version: CHECKOUT_ACKNOWLEDGEMENT_VERSION });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('한 번 실패하면 다시 시도해 성공하면 로그를 남기지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } }).mockResolvedValueOnce({ data: false, error: null });
    await expect(recordOrderPurchaseAcknowledgement(USER, ORDER)).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('두 번 다 실패하면 던지지 않고 오류 로그만 남긴다(주문은 이미 만들어졌다)', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(recordOrderPurchaseAcknowledgement(USER, ORDER)).resolves.toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledWith('[checkout/acknowledgement] record failed', { orderId: ORDER });
  });
});

describe('loadCheckoutClaimRestrictions', () => {
  it('제한 굿즈를 id로 묶어 돌려준다', async () => {
    mocks.query.mockResolvedValue({ data: [{ id: 'g1', claim_return_allowed: false, claim_exchange_allowed: null, claim_restriction_reason: '각인' }], error: null });
    await expect(loadCheckoutClaimRestrictions()).resolves.toEqual({ g1: { goodId: 'g1', returnAllowed: false, exchangeAllowed: null, reason: '각인' } });
  });

  it('읽지 못하면 빈 값이다 — 고지를 못 보일 뿐 주문을 막지 않는다', async () => {
    mocks.query.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } });
    await expect(loadCheckoutClaimRestrictions()).resolves.toEqual({});
    mocks.query.mockRejectedValueOnce(new Error('network'));
    await expect(loadCheckoutClaimRestrictions()).resolves.toEqual({});
    expect(mocks.error).toHaveBeenCalledTimes(2);
  });
});
