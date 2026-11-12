import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
const extras = vi.hoisted(() => ({ from: vi.fn(), result: { data: [] as unknown[] | null, error: null as unknown } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from: extras.from }) }));
vi.mock('./item-allocation.server', () => ({ loadOrderItemAllocations: async () => new Map(), loadOrderItemAllocationsForScreen: async () => null }));
import { getAdminOrderItemData } from './order-items.server';
import { normalizeAdminOrderItemFilters } from './order-items';
const empty = { rows: [], total: 0, qty: 0, orderCount: 0, fingerprint: 'a'.repeat(32), counts: { pending: 0, paid: 0, confirmed: 0, shipping: 0, delivered: 0, done: 0, canceled: 0 } };
beforeEach(() => { rpc.mockReset(); });
it('품목 검색·KST 기간·결제수단·정렬을 DB에 넘기고 export는 500건 페이지를 쓴다', async () => {
  rpc.mockResolvedValue({ data: empty, error: null });
  await getAdminOrderItemData(normalizeAdminOrderItemFilters({ field: 'item', query: 'abc', page: '3', from: '2026-09-01', to: '2026-09-02', dateField: 'confirmed', paymentMethod: 'card', sort: 'amount_high' }), 500);
  expect(rpc).toHaveBeenCalledWith('admin_search_order_items_console', { p_status: null, p_from: '2026-09-01', p_to: '2026-09-02', p_query: 'abc', p_field: 'item', p_offset: 1000, p_limit: 500, p_date_field: 'confirmed', p_payment_method: 'card', p_sort: 'amount_high' });
});
it('권한 오류나 손상된 응답을 빈 목록으로 숨기지 않는다', async () => {
  rpc.mockResolvedValue({ data: empty, error: { code: '42501' } });
  await expect(getAdminOrderItemData(normalizeAdminOrderItemFilters({}))).rejects.toThrow('Failed to load');
  rpc.mockResolvedValue({ data: { ...empty, counts: {} }, error: null });
  await expect(getAdminOrderItemData(normalizeAdminOrderItemFilters({}))).rejects.toThrow('Failed to load');
});
it('화면은 배송 건의 추가 운송장을 품목 줄에 싣고, 엑셀·읽기 실패는 종전 그대로 둔다(QNA-019)', async () => {
  const shipmentId = '6b3ad83a-aaaf-455f-907e-7c7d0143da59';
  const item = { id: '1fe5f1e8-19a4-4f34-8cc6-4742e7d9fad3', orderId: '76b3ad83-aaaf-455f-907e-7c7d0143da59', userId: '378dae74-b218-4c2f-80ff-27af804b736b',
    buyerName: '합성 구매자', recipientName: '합성 수취인', status: 'shipping', createdAt: '2026-11-01T00:00:00Z', goodId: 'good', goodName: '합성 상품',
    variantName: null, variantCode: null, customInputs: null, qty: 1, unitPrice: 1000, itemAmount: 1000, shipmentId, shipmentStatus: 'shipping',
    originName: '남양주', trackingNumber: 'XT10000001', carrierLabel: '우체국택배', claim: null };
  rpc.mockResolvedValue({ data: { ...empty, rows: [item], total: 1, orderCount: 1, qty: 1 }, error: null });
  const order = vi.fn(), chain = { select: vi.fn(() => chain), in: vi.fn(() => chain), order };
  order.mockReturnValueOnce(chain).mockImplementationOnce(async () => ({ data: [{ shipment_id: shipmentId, tracking_number: 'XT10000002' }], error: null }));
  extras.from.mockReturnValue(chain);
  const screen = await getAdminOrderItemData(normalizeAdminOrderItemFilters({ view: 'items' }));
  expect(extras.from).toHaveBeenCalledWith('order_shipment_extra_trackings');
  expect(chain.in).toHaveBeenCalledWith('shipment_id', [shipmentId]);
  expect(screen.rows[0].extraTrackingNumbers).toEqual(['XT10000002']);
  extras.from.mockClear();
  expect((await getAdminOrderItemData(normalizeAdminOrderItemFilters({ view: 'items' }), 500, { strictAllocations: true })).rows[0]).not.toHaveProperty('extraTrackingNumbers');
  expect(extras.from).not.toHaveBeenCalled();
  order.mockReturnValueOnce(chain).mockImplementationOnce(async () => ({ data: null, error: { message: 'private' } }));
  expect((await getAdminOrderItemData(normalizeAdminOrderItemFilters({ view: 'items' }))).rows[0]).not.toHaveProperty('extraTrackingNumbers');
});
