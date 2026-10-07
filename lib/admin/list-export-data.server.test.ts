import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  orders: vi.fn(),
  unpaid: vi.fn(),
  shipments: vi.fn(),
  claims: vi.fn(),
  rpc: vi.fn(),
  tables: {} as Record<string, unknown[]>,
  inCalls: [] as { table: string; column: string; ids: string[] }[],
  carriers: vi.fn(),
  loadShipments: vi.fn(),
}));

vi.mock('./orders.server', () => ({ getAdminOrderRecords: mocks.orders }));
vi.mock('./unpaid.server', () => ({ getAdminUnpaidOrders: mocks.unpaid }));
vi.mock('./shipment-dispatch.server', () => ({ getShipmentConsoleData: mocks.shipments }));
vi.mock('./claims.server', () => ({ getAdminClaimConsoleData: mocks.claims }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: mocks.carriers }));
vi.mock('@/lib/orders/shipments.server', () => ({ loadOrderShipments: mocks.loadShipments }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from: (table: string) => ({
      select: () => ({
        in: (column: string, ids: string[]) => {
          mocks.inCalls.push({ table, column, ids });
          const result = Promise.resolve({
            data: (mocks.tables[table] ?? []).filter((row) => ids.includes((row as Record<string, string>)[column])),
            error: null,
          });
          return Object.assign(result, { order: () => result });
        },
      }),
    }),
  }),
}));

import {
  AdminListExportAuditError,
  AdminListExportChangedError,
  collectAdminListExportPages,
  loadAdminListExportSheet,
  recordAdminListExport,
} from './list-export-data.server';
import { AdminListExportLimitError, type AdminListExportSheet } from './list-export';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables = {};
  mocks.inCalls = [];
  mocks.carriers.mockResolvedValue([]);
  mocks.loadShipments.mockResolvedValue([]);
});

describe('전체 페이지 모으기', () => {
  it('첫 페이지 건수가 상한을 넘으면 더 읽지 않는다', async () => {
    const loadPage = vi.fn().mockResolvedValue({ items: [{ id: 'a' }], total: 10_001 });
    await expect(collectAdminListExportPages(100, loadPage, (item: { id: string }) => item.id)).rejects.toBeInstanceOf(AdminListExportLimitError);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it('모든 페이지를 읽어 순서대로 모은다', async () => {
    const set = ['1', '2', '3', '4', '5'];
    const loadPage = vi.fn(async (page: number) => ({ items: set.slice((page - 1) * 2, page * 2).map((id) => ({ id })), total: set.length }));
    const items = await collectAdminListExportPages(2, loadPage, (item) => item.id);
    expect(items.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(loadPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it('읽는 사이 앞 페이지 건이 조건에서 빠지면 아직 맞는 건을 빠뜨리지 않고 오류로 멈춘다', async () => {
    let set = ['1', '2', '3', '4', '5'];
    const loadPage = vi.fn(async (page: number) => {
      const result = { items: set.slice((page - 1) * 2, page * 2).map((id) => ({ id })), total: set.length };
      if (page === 1) set = set.filter((id) => id !== '1');
      return result;
    });
    await expect(collectAdminListExportPages(2, loadPage, (item) => item.id)).rejects.toBeInstanceOf(AdminListExportChangedError);
  });

  it('건이 빠지고 새로 생겨 전체 건수가 같아도 경계가 밀려 겹치면 오류로 멈춘다', async () => {
    let set = ['1', '2', '3', '4', '5'];
    const loadPage = vi.fn(async (page: number) => {
      const result = { items: set.slice((page - 1) * 2, page * 2).map((id) => ({ id })), total: set.length };
      if (page === 1) set = ['0', '1', '2', '3', '5'];
      return result;
    });
    await expect(collectAdminListExportPages(2, loadPage, (item) => item.id)).rejects.toBeInstanceOf(AdminListExportChangedError);
  });

  it('페이지마다 전체 건수가 다르면 오류로 멈춘다', async () => {
    const pages: Record<number, { items: { id: string }[]; total: number }> = {
      1: { items: [{ id: '1' }, { id: '2' }], total: 4 },
      2: { items: [{ id: '3' }, { id: '4' }], total: 5 },
    };
    const loadPage = vi.fn(async (page: number) => pages[page]);
    await expect(collectAdminListExportPages(2, loadPage, (item) => item.id)).rejects.toBeInstanceOf(AdminListExportChangedError);
  });

  it('상품 줄로 펼친 행이 상한을 넘는 순간 남은 페이지를 읽지 않고 행 기준 오류로 멈춘다', async () => {
    const loadPage = vi.fn(async (page: number) => ({
      items: Array.from({ length: 1000 }, (_, index) => ({ id: `${page}-${index}`, lines: 3 })),
      total: 6000,
    }));
    const failure = collectAdminListExportPages(1000, loadPage, (item) => item.id, (item) => item.lines);
    await expect(failure).rejects.toBeInstanceOf(AdminListExportLimitError);
    await expect(failure).rejects.toMatchObject({ unit: 'rows' });
    expect(loadPage.mock.calls.length).toBeLessThan(6);
  });

  it('빈 결과는 첫 페이지만 읽는다', async () => {
    const loadPage = vi.fn().mockResolvedValue({ items: [], total: 0 });
    await expect(collectAdminListExportPages(50, loadPage, (item: { id: string }) => item.id)).resolves.toEqual([]);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });
});

describe('화면별 로더 재사용', () => {
  it('주문 통합검색은 화면 파서·로더를 그대로 쓰고 페이지 크기만 키운다', async () => {
    mocks.orders.mockImplementation(async (filters: { page: number }) => ({
      items: filters.page === 1 ? [{
        id: ORDER_ID, userId: 'u', buyerName: 'fan', buyerEmail: null, status: 'paid', total: 1000, address: null,
        createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', items: [], payments: [], refunds: [],
        cancellationRequest: null, manualRecoveryAttempt: null, shipments: [],
      }] : [],
      total: 1, pageSize: 50, filters, carriers: [],
    }));
    mocks.tables.orders = [{ id: ORDER_ID, address: null, payment_method: 'card' }];
    const sheet = await loadAdminListExportSheet('orders', { status: 'paid', query: '  홍  ', field: 'recipient', page: '7', order: ORDER_ID }, new Date());
    expect(mocks.orders).toHaveBeenCalledTimes(1);
    const [filters, includeRecovery, options] = mocks.orders.mock.calls[0];
    expect(filters).toMatchObject({ status: 'paid', query: '홍', field: 'recipient', page: 1, orderId: null });
    expect(includeRecovery).toBe(false);
    expect(options).toEqual({ pageSize: 50 });
    expect(sheet.rows[0][sheet.columns.findIndex((column) => column.header === '결제수단')]).toBe('카드');
  });

  it('미입금 확인은 입금 큐를 읽지 않는다', async () => {
    mocks.unpaid.mockResolvedValue({ rows: [], total: 0, filters: {}, pageSize: 200, deposits: [] });
    await loadAdminListExportSheet('unpaid', { q: '9A3F' }, new Date());
    expect(mocks.unpaid).toHaveBeenCalledWith({ query: '9A3F', page: 1, selectedOrderId: null }, { pageSize: 200, includeDeposits: false });
  });

  it('배송 화면은 탭 파서를 화면 모드로 쓰고 주문의 배송지를 함께 읽는다', async () => {
    mocks.shipments.mockResolvedValue({
      rows: [{ id: 's1', orderId: ORDER_ID, originId: 'o', originName: '김포', status: 'ready', createdAt: '2026-10-07T00:00:00Z', confirmedAt: null,
        buyerName: 'b', recipientName: 'r', total: 1, paymentMethod: 'card', shippingFee: 0, carrier: null, trackingNumber: null, shippedAt: null,
        deliveredAt: null, exportedAt: null, updatedAt: '', delayReason: null, expectedShipDate: null, items: [] }],
      total: 1, origins: [{ id: 'o', name: '김포' }], carriers: [], counts: {}, surface: 'shipping', filters: {}, pageSize: 1000,
    });
    mocks.tables.orders = [{ id: ORDER_ID, address: { recipientName: '수령', phone: '01000000000', postalCode: '01234', address1: '서울' }, payment_method: 'card' }];
    const sheet = await loadAdminListExportSheet('shipping', { tab: 'delivered', page: '2' }, new Date());
    expect(mocks.shipments).toHaveBeenCalledWith(expect.objectContaining({ tab: 'delivered', page: 1 }), 'shipping', { pageSize: 1000 });
    expect(sheet.rows[0][sheet.columns.findIndex((column) => column.header === '연락처')]).toBe('01000000000');
    expect(mocks.inCalls).toContainEqual({ table: 'orders', column: 'id', ids: [ORDER_ID] });
  });

  it('반품 화면은 집계 없이 요청을 모으고 품목·배송지·운송장을 붙인다', async () => {
    mocks.claims.mockResolvedValue({
      rows: [{ id: 'c1', reference: 1, orderId: ORDER_ID, claimType: 'return', stage: 'requested', reasonType: 'change_of_mind', buyerName: 'b',
        buyerEmail: null, orderStatus: 'delivered', orderTotal: 1, requestedAt: '2026-10-07T00:00:00Z', collectedAt: null, completedAt: null,
        refundMethod: null, handlerName: null }],
      total: 1, claimType: 'return', counts: {}, filters: {}, pageSize: 100,
    });
    mocks.tables.order_items = [{ id: 'i1', order_id: ORDER_ID, good_name_snapshot: '키링', variant_name_snapshot: null, qty: 3 }];
    mocks.tables.orders = [{ id: ORDER_ID, address: { recipientName: '수령', phone: '01000000000' }, payment_method: 'card' }];
    const sheet = await loadAdminListExportSheet('claims-returns', { stage: 'all' }, new Date());
    expect(mocks.claims).toHaveBeenCalledWith('return', expect.objectContaining({ stage: 'all', page: 1 }), { pageSize: 100, includeCounts: false });
    expect(mocks.loadShipments).toHaveBeenCalledWith(expect.anything(), [ORDER_ID], []);
    const at = (header: string) => sheet.rows[0][sheet.columns.findIndex((column) => column.header === header)];
    expect(at('상품명')).toBe('키링');
    expect(at('수량')).toBe(3);
    expect(at('수취인')).toBe('수령');
  });

  it('취소 화면은 배송지·운송장을 읽지 않는다', async () => {
    mocks.claims.mockResolvedValue({ rows: [], total: 0, claimType: 'cancel', counts: {}, filters: {}, pageSize: 100 });
    await loadAdminListExportSheet('claims-cancels', {}, new Date());
    expect(mocks.loadShipments).not.toHaveBeenCalled();
    expect(mocks.inCalls.some((call) => call.table === 'orders')).toBe(false);
  });
});

describe('다운로드 감사 기록', () => {
  const sheet = { screen: 'orders', rows: [[1], [2]], recordCount: 1, filters: { status: 'paid' } } as unknown as AdminListExportSheet;

  it('화면·조건·행 수·건수를 기록 RPC로 남긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'audit-id', error: null });
    await expect(recordAdminListExport(sheet)).resolves.toBe('audit-id');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_list_export', {
      p_screen: 'orders', p_filters: { status: 'paid' }, p_row_count: 2, p_record_count: 1,
    });
  });

  it('기록에 실패하면 오류를 던진다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'staff_required' } });
    await expect(recordAdminListExport(sheet)).rejects.toBeInstanceOf(AdminListExportAuditError);
  });
});
