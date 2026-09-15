import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminWorkQueue } from './work-queue.server';
import { ADMIN_WORK_QUEUES } from './work-queue';
import { normalizeAdminOrderFilters } from './orders';
import { normalizeAdminInquiryFilters } from './inquiries';
import { normalizeShipmentFilters } from './shipment-dispatch';
import { normalizeGoodsListFilters } from './goods-list';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
beforeEach(() => vi.clearAllMocks());
function serve(values: Record<string, unknown>) {
  mocks.rpc.mockImplementation(async (name: string) => {
    const value = values[name];
    if (value instanceof Error) throw value;
    return { data: value, error: null };
  });
}
const base = {
  admin_search_orders: [{ id: 'order', total_count: '2' }],
  admin_search_shipments: { total: 3, rows: [{ id: 'shipment' }], counts: { ready: 3, delayed: 1 } },
  admin_inquiry_status_counts: [{ status: 'open', total: '4' }, { status: 'answered', total: 8 }, { status: 'closed', total: 0 }],
  admin_search_goods_workspace: { rows: [], total: 23, reasonCounts: { draft: 22, kc_required: 22, kc_legacy_unrecorded: 1 } },
};
describe('operational work counts and destination scopes', () => {
  it('keeps order and split-shipment units separate and uses total counts instead of downloaded page length', async () => {
    serve(base);
    const data = await loadAdminWorkQueue();
    expect(data.counts).toEqual({ orders: { state: 'ready', count: 2 }, ready: { state: 'ready', count: 3 }, delayed: { state: 'ready', count: 1 },
      inquiries: { state: 'ready', count: 4 }, goods: { state: 'ready', count: 23 } });
    expect(data.goodsReasons.reduce((sum, reason) => sum + reason.count, 0)).toBe(45);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_workspace', expect.objectContaining({ p_limit: 0, p_readiness: 'review_required', p_status: 'active' }));
  });
  it('builds destination links with the exact filters used by each list RPC', async () => {
    serve(base); const data = await loadAdminWorkQueue();
    const params = (id: string) => Object.fromEntries(new URL(ADMIN_WORK_QUEUES.find(queue => queue.id === id)!.href, 'https://icons.test').searchParams);
    expect(normalizeAdminOrderFilters(params('orders'))).toMatchObject({ status: 'paid', from: null, to: null, page: 1 });
    expect(normalizeShipmentFilters(params('ready'), 'dispatch')).toMatchObject({ tab: 'ready', from: null, to: null, page: 1 });
    expect(normalizeShipmentFilters(params('delayed'), 'dispatch')).toMatchObject({ tab: 'delayed', from: null, to: null, page: 1 });
    expect(normalizeAdminInquiryFilters(params('inquiries'))).toMatchObject({ status: 'open', category: 'all', page: 1 });
    expect(normalizeGoodsListFilters(params('goods'))).toMatchObject({ status: 'active', readiness: 'review_required', page: 1 });
    expect(data.goodsReasons[0].href).toContain('readiness=draft');
  });
  it('distinguishes verified zero from per-domain failures and malformed aggregates', async () => {
    serve({ ...base, admin_search_orders: [], admin_search_shipments: new Error('network'), admin_inquiry_status_counts: [], admin_search_goods_workspace: { total: 0, reasonCounts: null } });
    expect((await loadAdminWorkQueue()).counts).toEqual({ orders: { state: 'ready', count: 0 }, ready: { state: 'error', count: null },
      delayed: { state: 'error', count: null }, inquiries: { state: 'error', count: null }, goods: { state: 'error', count: null } });
    serve({ ...base, admin_inquiry_status_counts: [{ status: 'open', total: 0 }], admin_search_goods_workspace: { total: 0, reasonCounts: {} } });
    expect((await loadAdminWorkQueue()).counts.goods).toEqual({ state: 'ready', count: 0 });
  });
});
