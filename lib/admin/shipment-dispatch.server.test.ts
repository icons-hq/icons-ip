import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getShipmentConsoleData } from './shipment-dispatch.server';
import { normalizeShipmentFilters, shipmentConsoleHref } from './shipment-dispatch';
import { shipmentDeliveryFixture } from '@/lib/shipment-delivery.fixture';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), origins: vi.fn(), carriers: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ order: mocks.origins }) }) }) }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: mocks.carriers }));
const notice = { status: 'not_sent', noticeId: null, requestedAt: null, inAppStatus: null, emailStatus: null, emailProviderState: null };
const fingerprint = 'a'.repeat(64);
const counts = { new: 0, ready: 2, delayed: 1, transit: 0, delivered: 0 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: { delayNoticeFingerprint: fingerprint, rows: [], total: 201, counts }, error: null });
  mocks.origins.mockResolvedValue({ data: [{ id: 'origin', name: '김포' }], error: null }); mocks.carriers.mockResolvedValue([]);
});
describe('shipment console query boundary', () => {
  it.each(['parcel', 'quick', 'pickup', 'direct', 'freight', 'none', 'digital'] as const)('preserves the supported fulfillment method through filtering, paging and query: %s', async method => {
    const filters = normalizeShipmentFilters({ method }, 'dispatch');
    expect(filters.method).toBe(method);
    expect(shipmentConsoleHref('dispatch', filters, { page: 2 })).toContain(`method=${method}`);
    await getShipmentConsoleData(filters, 'dispatch');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_shipments_notice_console', expect.objectContaining({ p_method: method }));
    expect(normalizeShipmentFilters({ method: 'unknown' }, 'shipping').method).toBeUndefined();
  });
  it('keeps the shipping surface on its existing RPC without the dispatch-only filter', async () => {
    mocks.rpc.mockResolvedValue({ data: { rows: [], total: 0, counts }, error: null });
    await getShipmentConsoleData(normalizeShipmentFilters({ delayNotice: 'sent' }, 'shipping'), 'shipping');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_shipments_console', expect.not.objectContaining({ p_delay_notice_status: expect.anything() }));
  });
  it('passes the delay notice filter before pagination and rejects a missing receipt', async () => {
    const filters = normalizeShipmentFilters({ tab: 'delayed', delayNotice: 'partial_failed', page: '2', pageSize: '50' }, 'dispatch');
    await getShipmentConsoleData(filters, 'dispatch');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_shipments_notice_console', expect.objectContaining({ p_delay_notice_status: 'partial_failed', p_offset: 50, p_limit: 50 }));
    mocks.rpc.mockResolvedValueOnce({ data: { delayNoticeFingerprint: fingerprint, rows: [{ id: 'shipment', delivery: shipmentDeliveryFixture() }] }, error: null }).mockResolvedValueOnce({data:{shipment:null},error:null}).mockResolvedValueOnce({data:{shipment:{count:0,completed:0,ready:true,dueAt:null}},error:null});
    await expect(getShipmentConsoleData(filters, 'dispatch')).rejects.toThrow('지연 안내 상태를 확인하지 못했습니다');
    mocks.rpc.mockResolvedValue({ data: { rows: [], total: 0, counts }, error: null });
    await expect(getShipmentConsoleData(filters, 'dispatch')).rejects.toThrow('지연 안내 상태를 확인하지 못했습니다');
  });
  it('passes normalized filters and the requested 100-row page to the staff RPC', async () => {
    const filters = normalizeShipmentFilters({ tab: 'ready', originId: '00000000-0000-4000-8000-000000000001', query: '  배송 확인  ', from: '2026-09-01', to: '2026-09-08', page: '3' }, 'dispatch');
    const data = await getShipmentConsoleData(filters, 'dispatch');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_shipments_notice_console', { p_tab: 'ready', p_origin_id: filters.originId, p_query: '배송 확인', p_from: '2026-09-01', p_to: '2026-09-08', p_limit: 100, p_offset: 200, p_date_field: 'ordered', p_field: 'all', p_method: null, p_payment_method: null, p_sort: 'oldest', p_delay_notice_status: null });
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
    mocks.rpc.mockResolvedValueOnce({ data: { delayNoticeFingerprint: fingerprint, rows: [{ id: 'shipment', delayNotice: notice, preorderReady: false, delivery }], total: 1, counts }, error: null }).mockResolvedValueOnce({data:{shipment:null},error:null}).mockResolvedValueOnce({data:{shipment:{count:0,completed:0,ready:true,dueAt:null}},error:null});
    expect((await getShipmentConsoleData(normalizeShipmentFilters({}, 'dispatch'), 'dispatch')).rows[0]).toMatchObject({ delivery, preorderReady: false });
    mocks.rpc.mockResolvedValueOnce({ data: { delayNoticeFingerprint: fingerprint, rows: [{ id: 'shipment', delivery: { method: 'pickup', policy: null } }], total: 1, counts }, error: null }).mockResolvedValueOnce({data:{shipment:null},error:null}).mockResolvedValueOnce({data:{shipment:{count:0,completed:0,ready:true,dueAt:null}},error:null});
    await expect(getShipmentConsoleData(normalizeShipmentFilters({}, 'dispatch'), 'dispatch')).rejects.toThrow('배송 방식을 확인하지 못했습니다');
  });
});
