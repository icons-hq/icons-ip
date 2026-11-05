import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminWorkQueue } from './work-queue.server';
import { ADMIN_WORK_QUEUES, visibleAdminWorkQueues } from './work-queue';
import { normalizeAdminUnpaidFilters } from './unpaid';
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
      inquiries: { state: 'ready', count: 4 }, goods: { state: 'ready', count: 23 },
      unpaid: { state: 'hidden', count: null }, refundTransfers: { state: 'hidden', count: null } });
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
      delayed: { state: 'error', count: null }, inquiries: { state: 'error', count: null }, goods: { state: 'error', count: null },
      unpaid: { state: 'hidden', count: null }, refundTransfers: { state: 'hidden', count: null } });
    serve({ ...base, admin_inquiry_status_counts: [{ status: 'open', total: 0 }], admin_search_goods_workspace: { total: 0, reasonCounts: {} } });
    expect((await loadAdminWorkQueue()).counts.goods).toEqual({ state: 'ready', count: 0 });
  });
});

/* 2026-11-05 IA 재정의 D4: 돈 관련 대기열은 목적지 화면을 열 수 있는 계정에만 집계한다. */
describe('scoped money queues (bank-transfer deposits and refund transfers)', () => {
  const refundRow = { claimId: '11111111-1111-4111-8111-111111111111', orderId: '22222222-2222-4222-8222-222222222222', reference: 1, claimType: 'cancel',
    amount: 12000, confirmedAt: '2026-11-05T01:00:00Z', filedAt: null, updatedAt: '2026-11-05T01:00:00Z', revision: 1, gift: false, payerName: null, requesterName: null };
  const scoped = {
    ...base,
    admin_unpaid_bank_transfer_orders_console: [{ order_id: 'order', total_count: '3' }],
    admin_list_bank_transfer_refunds_numbered: { rows: [refundRow], total: 2, limit: 50, offset: 0 },
  };
  it('does not call scoped RPCs without access and hides those queues', async () => {
    serve(scoped);
    const data = await loadAdminWorkQueue();
    const called = mocks.rpc.mock.calls.map(([name]) => name);
    expect(called).not.toContain('admin_unpaid_bank_transfer_orders_console');
    expect(called).not.toContain('admin_list_bank_transfer_refunds_numbered');
    expect(visibleAdminWorkQueues(data).map(queue => queue.id)).toEqual(['orders', 'ready', 'delayed', 'inquiries', 'goods']);
  });
  it('reads total counts with the same calls as the destination lists', async () => {
    serve(scoped);
    const data = await loadAdminWorkQueue({ unpaid: true, refundTransfers: true });
    expect(data.counts.unpaid).toEqual({ state: 'ready', count: 3 });
    expect(data.counts.refundTransfers).toEqual({ state: 'ready', count: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_unpaid_bank_transfer_orders_console', { p_query: null, p_limit: 1, p_offset: 0, p_state: null, p_sort: 'oldest' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_bank_transfer_refunds_numbered', { p_limit: 50, p_offset: 0 });
    expect(visibleAdminWorkQueues(data).map(queue => queue.id)).toContain('refundTransfers');
    const unpaidHref = ADMIN_WORK_QUEUES.find(queue => queue.id === 'unpaid')!.href;
    expect(normalizeAdminUnpaidFilters(Object.fromEntries(new URL(unpaidHref, 'https://icons.test').searchParams))).toMatchObject({ page: 1 });
    expect(ADMIN_WORK_QUEUES.find(queue => queue.id === 'refundTransfers')!.href).toBe('/admin/sales/claims/refund-transfers');
  });
  it('treats an empty list as a verified zero and malformed or failed reads as errors', async () => {
    serve({ ...scoped, admin_unpaid_bank_transfer_orders_console: [], admin_list_bank_transfer_refunds_numbered: { rows: [], total: 0, limit: 50, offset: 0 } });
    let data = await loadAdminWorkQueue({ unpaid: true, refundTransfers: true });
    expect(data.counts.unpaid).toEqual({ state: 'ready', count: 0 });
    expect(data.counts.refundTransfers).toEqual({ state: 'ready', count: 0 });
    serve({ ...scoped, admin_unpaid_bank_transfer_orders_console: new Error('network'), admin_list_bank_transfer_refunds_numbered: { rows: [], total: 0, limit: 1, offset: 0 } });
    data = await loadAdminWorkQueue({ unpaid: true, refundTransfers: true });
    expect(data.counts.unpaid).toEqual({ state: 'error', count: null });
    expect(data.counts.refundTransfers).toEqual({ state: 'error', count: null });
    expect(visibleAdminWorkQueues(data).map(queue => queue.id)).toEqual(expect.arrayContaining(['unpaid', 'refundTransfers']));
  });
});
