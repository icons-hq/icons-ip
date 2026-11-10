import { beforeEach, expect, it, vi } from 'vitest';
import { loadRefundTransfers } from './refund-transfers.server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
beforeEach(() => mocks.rpc.mockReset());
it('reads only the bounded authenticated refund queue RPC', async () => {
  mocks.rpc.mockResolvedValue({ data: { rows: [], total: 51, limit: 50, offset: 50 }, error: null });
  expect((await loadRefundTransfers(2)).page).toBe(2);
  expect(mocks.rpc).toHaveBeenCalledWith('admin_list_bank_transfer_refunds_numbered', { p_limit: 50, p_offset: 50 });
});
it('does not turn failure or malformed data into an empty successful queue', async () => {
  for (const result of [{ data: null, error: { message: 'private_account_secret' } }, { data: { rows: [], total: 0, limit: 50, offset: 999 }, error: null }]) {
    mocks.rpc.mockResolvedValue(result);
    await expect(loadRefundTransfers(1)).rejects.toThrow('환불 송금 대기 목록을 불러오지 못했습니다.');
  }
});
