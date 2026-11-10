import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
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
