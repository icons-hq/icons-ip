import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { loadMyOrderClaimReasonHistory } from './claim-reason-change.server';
import { reasonReceipt as receipt } from './claim-reason-change.fixture';
beforeEach(() => vi.clearAllMocks());
it('고객 본인용 RPC만 읽으며 내부 근거가 응답에 있어도 직렬화하지 않는다', async () => {
  mocks.rpc.mockResolvedValue({ data: [receipt], error: null });
  const result = await loadMyOrderClaimReasonHistory(receipt.orderId);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_my_order_claim_reason_changes', { p_order_id: receipt.orderId });
  expect(result?.[0]).toMatchObject({ fromReason: receipt.fromReason, toReason: receipt.toReason });
  expect(JSON.stringify(result)).not.toContain(receipt.agreement); expect(result?.[0]).not.toHaveProperty('actorId');
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'order_not_found' } }); expect(await loadMyOrderClaimReasonHistory(receipt.orderId)).toBeNull();
});
