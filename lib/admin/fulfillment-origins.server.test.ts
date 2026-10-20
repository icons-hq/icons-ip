import { beforeEach, expect, it, vi } from 'vitest';
import { loadGoodsFulfillmentOptions } from './fulfillment-origins.server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks }));
beforeEach(() => vi.clearAllMocks());
it('loads product shipping choices without warehouse export configuration', async () => {
  mocks.rpc.mockResolvedValue({ data: [{ id: 'origin', name: '합성 출고지', defaultCarrier: 'demo', baseFee: 3000,
    freeThreshold: 50000, returnAddress: '합성 반품 주소', active: true, exportColumns: ['private'], cutoff: '18:00' }], error: null });
  const result = await loadGoodsFulfillmentOptions();
  expect(mocks.rpc).toHaveBeenCalledWith('admin_goods_origin_options');
  expect(mocks.from).not.toHaveBeenCalled();
  expect(result).toEqual([{ id: 'origin', name: '합성 출고지', defaultCarrier: 'demo', baseFee: 3000, freeThreshold: 50000, returnAddress: '합성 반품 주소', active: true }]);
});
