import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goodsSalesPrecheckoutQuote } from '@/test/fixtures/goods-sales-precheckout';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
import { loadGoodsSalesPrecheckoutQuote } from './goods-sales.server';

const items = goodsSalesPrecheckoutQuote.lines.map(({ goodId, variantId, qty }) => ({ goodId, variantId, qty }));
beforeEach(() => vi.resetAllMocks());

describe('precheckout sales loader', () => {
  it('uses only the product condition RPC and validates its deferred shipping response', async () => {
    mocks.rpc.mockResolvedValue({ data: goodsSalesPrecheckoutQuote, error: null });
    expect(await loadGoodsSalesPrecheckoutQuote(items)).toEqual(goodsSalesPrecheckoutQuote);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('quote_goods_sales_precheckout', { items });
  });
  it('does not fall back to legacy shipping when runtime, RPC or contract validation fails', async () => {
    for (const response of [
      { data: null, error: { message: 'checkout_contract_upgrade_required' } },
      { data: null, error: { code: 'PGRST202' } },
      { data: { ...goodsSalesPrecheckoutQuote, shipping: { totalFee: 0, groups: [] } }, error: null },
    ]) {
      mocks.rpc.mockResolvedValueOnce(response);
      expect(await loadGoodsSalesPrecheckoutQuote(items)).toBeNull();
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.rpc.mock.calls.every(([name]) => name === 'quote_goods_sales_precheckout')).toBe(true);
  });
});
