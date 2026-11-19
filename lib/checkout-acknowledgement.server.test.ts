import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn(), service: vi.fn(), cart: vi.fn(), error: vi.spyOn(console, 'error') }));
vi.mock('server-only', () => ({}));
/* 제한 굿즈 읽기 체인을 흉내 낸다: from(table).select().in(ids).or(filter) 와 from('cart_items').select().eq(). */
function client(query: () => unknown, calls: unknown[][]) {
  return {
    rpc: mocks.rpc,
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = (columns: string) => { calls.push(['select', table, columns]); return chain; };
      chain.in = (column: string, ids: string[]) => { calls.push(['in', column, ids]); return chain; };
      chain.or = (filter: string) => { calls.push(['or', filter]); return query(); };
      chain.eq = (column: string, value: string) => { calls.push(['eq', column, value]); return mocks.cart(); };
      return chain;
    },
  };
}
const sessionCalls: unknown[][] = [], serviceCalls: unknown[][] = [];
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => client(mocks.service, serviceCalls) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client(mocks.session, sessionCalls) }));

import { loadCheckoutClaimRestrictions, loadUserCartGoodIds, recordOrderPurchaseAcknowledgement, verifyClaimNotice } from './checkout-acknowledgement.server';
import { CHECKOUT_ACKNOWLEDGEMENT_VERSION } from './checkout-acknowledgement';

const USER = '00000000-0000-4000-8000-000000000001';
const ORDER = '5cbcbbed-202d-4676-821a-7706398e57c0';

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.session.mockReset();
  mocks.service.mockReset();
  mocks.cart.mockReset();
  sessionCalls.length = 0;
  serviceCalls.length = 0;
  mocks.error.mockReset().mockImplementation(() => undefined);
});

describe('recordOrderPurchaseAcknowledgement', () => {
  it('한 번에 기록되면 같은 인자로 한 번만 부른다', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(recordOrderPurchaseAcknowledgement(USER, ORDER)).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('record_order_purchase_acknowledgement', { p_user_id: USER, p_order_id: ORDER, p_notice_version: CHECKOUT_ACKNOWLEDGEMENT_VERSION, p_screen_notice: null });
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

describe('recordOrderPurchaseAcknowledgement 화면 고지', () => {
  it('화면이 보인 제한 굿즈 목록이나 읽기 실패 표식을 함께 남긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await recordOrderPurchaseAcknowledgement(USER, ORDER, ['g1']);
    expect(mocks.rpc).toHaveBeenLastCalledWith('record_order_purchase_acknowledgement', expect.objectContaining({ p_screen_notice: { goodIds: ['g1'] } }));
    await recordOrderPurchaseAcknowledgement(USER, ORDER, 'unavailable');
    expect(mocks.rpc).toHaveBeenLastCalledWith('record_order_purchase_acknowledgement', expect.objectContaining({ p_screen_notice: { unavailable: true } }));
  });
});

describe('loadCheckoutClaimRestrictions', () => {
  it('이 주문서 품목 id로만 한정해 사용자 세션으로 읽는다(service client를 쓰지 않는다)', async () => {
    mocks.session.mockResolvedValue({ data: [{ id: 'g1', claim_return_allowed: false, claim_exchange_allowed: null, claim_restriction_reason: '각인' }], error: null });
    await expect(loadCheckoutClaimRestrictions(['g1', 'g1', 'g2'])).resolves.toEqual({ g1: { goodId: 'g1', returnAllowed: false, exchangeAllowed: null, reason: '각인' } });
    expect(sessionCalls).toContainEqual(['in', 'id', ['g1', 'g2']]);
    expect(serviceCalls).toEqual([]);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it('품목이 없으면 읽지 않고 빈 값이다', async () => {
    await expect(loadCheckoutClaimRestrictions([])).resolves.toEqual({});
    expect(sessionCalls).toEqual([]);
  });

  it('공개 RLS가 가린 굿즈는 응답에 없으므로 prop에도 없다(품목 밖·비공개 굿즈 비노출)', async () => {
    /* 세션 client는 goods_public_read로 19금·미공개 굿즈 행을 돌려주지 않는다 — 돌려준 행만 prop이 된다. */
    mocks.session.mockResolvedValue({ data: [], error: null });
    await expect(loadCheckoutClaimRestrictions(['rh-adult-engraved-item', 'rh-unreleased-collab-item'])).resolves.toEqual({});
  });

  it('응답에 품목 밖 행이 섞여 와도 prop에 싣지 않는다', async () => {
    mocks.session.mockResolvedValue({ data: [
      { id: 'g1', claim_return_allowed: false, claim_restriction_reason: 'r' },
      { id: 'rh-adult-engraved-item', claim_return_allowed: false, claim_restriction_reason: '19금 사유' },
    ], error: null });
    await expect(loadCheckoutClaimRestrictions(['g1'])).resolves.toEqual({ g1: expect.objectContaining({ goodId: 'g1' }) });
  });

  it('읽지 못하면 null(확인 불가)이다 — 빈 값으로 오인하지 않는다', async () => {
    mocks.session.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } });
    await expect(loadCheckoutClaimRestrictions(['g1'])).resolves.toBeNull();
    mocks.session.mockRejectedValueOnce(new Error('network'));
    await expect(loadCheckoutClaimRestrictions(['g1'])).resolves.toBeNull();
    expect(mocks.error).toHaveBeenCalledTimes(2);
  });
});

describe('loadUserCartGoodIds', () => {
  it('서버 장바구니의 굿즈 id를 중복 없이 돌려주고, 못 읽으면 null이다', async () => {
    mocks.cart.mockResolvedValueOnce({ data: [{ good_id: 'a' }, { good_id: 'a' }, { good_id: 'b' }], error: null });
    await expect(loadUserCartGoodIds(USER)).resolves.toEqual(['a', 'b']);
    mocks.cart.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(loadUserCartGoodIds(USER)).resolves.toBeNull();
  });
});

describe('verifyClaimNotice', () => {
  const restricted = { data: [{ id: 'g1', claim_return_allowed: false, claim_restriction_reason: 'r' }, { id: 'g2', claim_exchange_allowed: false, claim_restriction_reason: 'r' }], error: null };

  it('주문 굿즈의 제한이 모두 화면에 보였으면 통과하고, 서버 재조회는 service client로 주문 굿즈에 한정한다', async () => {
    mocks.service.mockResolvedValue(restricted);
    await expect(verifyClaimNotice(['g1', 'g2', 'g3'], ['g1', 'g2'])).resolves.toBe('ok');
    expect(serviceCalls).toContainEqual(['in', 'id', ['g1', 'g2', 'g3']]);
    await expect(verifyClaimNotice(['g1', 'g2'], ['g1', 'g2', 'gx'])).resolves.toBe('ok');
  });

  it('화면에 없던 제한 굿즈가 있으면 changed다(고지 읽기 실패 표식이면 모든 제한이 해당)', async () => {
    mocks.service.mockResolvedValue(restricted);
    await expect(verifyClaimNotice(['g1', 'g2'], ['g1'])).resolves.toBe('changed');
    await expect(verifyClaimNotice(['g1', 'g2'], [])).resolves.toBe('changed');
    await expect(verifyClaimNotice(['g1', 'g2'], 'unavailable')).resolves.toBe('changed');
  });

  it('제한이 없으면 고지 읽기 실패 표식이어도 통과한다', async () => {
    mocks.service.mockResolvedValue({ data: [], error: null });
    await expect(verifyClaimNotice(['g1'], 'unavailable')).resolves.toBe('ok');
    await expect(verifyClaimNotice([], 'unavailable')).resolves.toBe('ok');
  });

  it('서버가 못 읽으면 unavailable이다(확인하지 못한 채 통과시키지 않는다)', async () => {
    mocks.service.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(verifyClaimNotice(['g1'], [])).resolves.toBe('unavailable');
    mocks.service.mockRejectedValueOnce(new Error('network'));
    await expect(verifyClaimNotice(['g1'], [])).resolves.toBe('unavailable');
  });
});
