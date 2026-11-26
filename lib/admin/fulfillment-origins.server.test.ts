import { beforeEach, expect, it, vi } from 'vitest';
import { loadAdminFulfillmentOrigin, loadAdminFulfillmentOrigins, loadGoodsFulfillmentOptions } from './fulfillment-origins.server';
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

const row = { id: 'origin', code: 'gimpo', name: '김포', default_carrier: 'hanjin', base_fee: '4200', free_threshold: null, return_address: '창고 주소', cutoff: '17:30:00',
  export_template: 'wms_csv', export_columns: [], is_active: true, updated_at: '2026-09-02T00:00:00Z' };
const fromRows = (result: unknown) => {
  const maybeSingle = vi.fn().mockResolvedValue(result), eq = vi.fn(() => ({ maybeSingle })), order = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ eq, order }));
  mocks.from.mockReturnValue({ select });
  return { select, eq, order };
};
it('출고지 하나를 읽어 화면 값으로 돌려준다(금액은 숫자, 마감 시각은 시·분)', async () => {
  const query = fromRows({ data: row, error: null });
  expect(await loadAdminFulfillmentOrigin('origin')).toEqual({ id: 'origin', code: 'gimpo', name: '김포', defaultCarrier: 'hanjin', baseFee: 4200, freeThreshold: null,
    returnAddress: '창고 주소', cutoff: '17:30', exportTemplate: 'wms_csv', exportColumns: [], active: true, updatedAt: '2026-09-02T00:00:00Z' });
  expect(mocks.from).toHaveBeenCalledWith('fulfillment_origins');
  expect(query.eq).toHaveBeenCalledWith('id', 'origin');
});
it('없는 출고지는 null이고, 읽지 못하면 던진다', async () => {
  fromRows({ data: null, error: null });
  expect(await loadAdminFulfillmentOrigin('missing')).toBeNull();
  fromRows({ data: null, error: { message: 'x' } });
  await expect(loadAdminFulfillmentOrigin('origin')).rejects.toThrow('출고지를 불러오지 못했습니다');
});
it('출고지 목록은 코드순으로 읽어 같은 모양으로 돌려준다', async () => {
  const query = fromRows({ data: [row], error: null });
  expect(await loadAdminFulfillmentOrigins()).toMatchObject([{ id: 'origin', baseFee: 4200, cutoff: '17:30' }]);
  expect(query.order).toHaveBeenCalledWith('code');
});
