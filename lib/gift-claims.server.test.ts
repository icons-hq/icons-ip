import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const rpc = vi.fn();
vi.mock('./supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('./orders/shipment.server', () => ({ getShippingCarrierRegistry: async () => [] }));
import { loadGiftClaimContext } from './gift-claims.server';

const giftId = '10000000-0000-4000-8000-000000000004';
const actorId = '10000000-0000-4000-8000-000000000001';
const context = { giftId, isSender: false, isRecipient: true, canRequest: false, claim: null };

describe('선물 교환·반품 문맥 읽기', () => {
  beforeEach(() => { rpc.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  it('읽기가 한 번 실패해도(일시 경합) 한 번 더 읽어 화면을 살린다', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'gift_auth_changed' } }).mockResolvedValueOnce({ data: context, error: null });
    await expect(loadGiftClaimContext(giftId, actorId)).resolves.toMatchObject({ giftId });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('두 번 다 실패하면 원인 코드를 남기고 실패한다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'gift_auth_changed' } });
    await expect(loadGiftClaimContext(giftId, actorId)).rejects.toThrow('gift_claim_context_unavailable');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('42501'));
  });
  it('계약과 다른 응답은 일시 경합이 아니므로 다시 읽지 않는다', async () => {
    rpc.mockResolvedValue({ data: { giftId: 'x' }, error: null });
    await expect(loadGiftClaimContext(giftId, actorId)).rejects.toThrow('gift_claim_context_unavailable');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
