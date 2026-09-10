import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getShipmentConsoleData } from './shipment-dispatch.server';
import { normalizeShipmentFilters, shipmentConsoleHref } from './shipment-dispatch';
import { shipmentDeliveryFixture } from '@/lib/shipment-delivery.fixture';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), origins: vi.fn(), carriers: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ order: mocks.origins }) }) }) }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: mocks.carriers }));
const counts = { new: 0, ready: 2, delayed: 1, transit: 0, delivered: 0 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: { rows: [], total: 201, counts }, error: null });
  mocks.origins.mockResolvedValue({ data: [{ id: 'origin', name: '김포' }], error: null }); mocks.carriers.mockResolvedValue([]);
});
describe('shipment console query boundary', () => {
  it('passes normalized filters and the requested 100-row page to the staff RPC', async () => {
    const filters = normalizeShipmentFilters({ tab: 'ready', originId: '00000000-0000-4000-8000-000000000001', query: '  배송 확인  ', from: '2026-09-01', to: '2026-09-08', page: '3' }, 'dispatch');
    const data = await getShipmentConsoleData(filters, 'dispatch');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_shipments', { p_tab: 'ready', p_origin_id: filters.originId, p_query: '배송 확인', p_from: '2026-09-01', p_to: '2026-09-08', p_limit: 100, p_offset: 200 });
    expect(data).toMatchObject({ filters, pageSize: 100, total: 201, counts, origins: [{ id: 'origin', name: '김포' }] });
    expect(shipmentConsoleHref('dispatch', filters, { tab: 'delayed', page: 1 })).toContain('page=1');
    expect(shipmentConsoleHref('dispatch', filters, { page: 2 })).toContain('query=%EB%B0%B0%EC%86%A1+%ED%99%95%EC%9D%B8');
  });
  it.each(['search', 'origins'])('fails visibly when %s data cannot load', async (source) => {
    (source === 'search' ? mocks.rpc : mocks.origins).mockResolvedValue({ data: null, error: { message: 'private db error' } });
    await expect(getShipmentConsoleData(normalizeShipmentFilters({}, 'shipping'), 'shipping')).rejects.toThrow('배송 건 목록을 불러오지 못했습니다.');
  });
  it('keeps invalid surface tabs, dates, IDs and repeated query values out of the RPC', () => {
    expect(normalizeShipmentFilters({ tab: 'ready', originId: 'invalid', query: ['one', 'two'], from: '2026-02-31', to: '2026-01-01', page: '-1' }, 'shipping'))
      .toEqual({ tab: 'transit', originId: null, query: '', from: null, to: '2026-01-01', page: 1 });
  });
  it('resets page values whose SQL integer offset cannot be represented', () => {
    expect(normalizeShipmentFilters({ page: '21474838' }, 'dispatch').page).toBe(1);
  });
  it('preserves method and preorder data while refusing a missing or malformed method response', async () => {
    const delivery = shipmentDeliveryFixture();
    mocks.rpc.mockResolvedValue({ data: { rows: [{ id: 'shipment', preorderReady: false, delivery }], total: 1, counts }, error: null });
    expect((await getShipmentConsoleData(normalizeShipmentFilters({}, 'dispatch'), 'dispatch')).rows[0]).toMatchObject({ delivery, preorderReady: false });
    mocks.rpc.mockResolvedValue({ data: { rows: [{ id: 'shipment', delivery: { method: 'pickup', policy: null } }], total: 1, counts }, error: null });
    await expect(getShipmentConsoleData(normalizeShipmentFilters({}, 'dispatch'), 'dispatch')).rejects.toThrow('배송 방식을 확인하지 못했습니다');
  });
});
