import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  orders: vi.fn(),
  orderItems: vi.fn(),
  unpaid: vi.fn(),
  shipments: vi.fn(),
  claims: vi.fn(),
  rpc: vi.fn(),
  tables: {} as Record<string, unknown[]>,
  inCalls: [] as { table: string; column: string; ids: string[] }[],
  carriers: vi.fn(),
  loadShipments: vi.fn(),
}));

vi.mock('@/lib/order-delivery.server', () => ({ loadAdminOrderDeliveries: async (ids: string[]) => new Map(ids.map(id => [id, { orderId: id, address: (mocks.tables.orders as Record<string, unknown>[] | undefined)?.find(row => row.id === id)?.address ?? null, isGift: false }])) }));
vi.mock('./orders.server', () => ({ getAdminOrderRecords: mocks.orders }));
vi.mock('./order-items.server', () => ({ getAdminOrderItemData: mocks.orderItems }));
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
          const rows = (mocks.tables[table] ?? []).filter((row) => ids.includes((row as Record<string, string>)[column]));
          const result = Promise.resolve({ data: rows, error: null });
          // PostgREST처럼 range가 없으면 max_rows(1,000)에서 조용히 자른다.
          const capped = Promise.resolve({ data: rows.slice(0, 1000), error: null });
          const range = (from: number, to: number) => Promise.resolve({ data: rows.slice(from, Math.min(to, from + 999) + 1), error: null });
          return Object.assign(result, { order: () => Object.assign(capped, { range }) });
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
import { smartStoreDeliveryLine } from './smartstore-delivery-list.fixture';

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
  it('클레임 결제일 조건을 서버 로더·파일 안내·감사 필터에 보존한다', async () => {
    mocks.claims.mockResolvedValue({ rows: [], total: 0, claimType: 'return', counts: {}, filters: {}, pageSize: 100 });
    const sheet = await loadAdminListExportSheet('claims-returns', { dateField: 'paid', from: '2026-10-02', to: '2026-10-02', sort: 'oldest' }, new Date());
    expect(mocks.claims).toHaveBeenCalledWith('return', expect.objectContaining({ dateField: 'paid', from: '2026-10-02', to: '2026-10-02', sort: 'oldest' }), { pageSize: 100, includeCounts: false });
    expect(sheet.conditions).toContainEqual(['결제일', '2026-10-02 ~ 2026-10-02']);
    expect(sheet.filters).toMatchObject({ dateField: 'paid', from: '2026-10-02', to: '2026-10-02' });
  });
  it('지연 안내 결과가 페이지 밖에서 바뀌어 건수가 같아도 엑셀을 만들지 않는다', async () => {
    mocks.shipments.mockResolvedValueOnce({ rows: [], total: 0, origins: [], carriers: [], delayNoticeFingerprint: 'a'.repeat(64) })
      .mockResolvedValueOnce({ rows: [], total: 0, origins: [], carriers: [], delayNoticeFingerprint: 'b'.repeat(64) });
    await expect(loadAdminListExportSheet('dispatch', { tab: 'delayed', delayNotice: 'partial_failed' }, new Date())).rejects.toBeInstanceOf(AdminListExportChangedError);
    expect(mocks.shipments).toHaveBeenNthCalledWith(1, expect.objectContaining({ delayNotice: 'partial_failed', page: 1 }), 'dispatch', { pageSize: 1000 });
    expect(mocks.shipments).toHaveBeenNthCalledWith(2, expect.objectContaining({ delayNotice: 'partial_failed', page: 1 }), 'dispatch', { pageSize: 1 });
  });
  it('안내 상태가 유지된 전체 목록 파일과 감사 필터가 화면 조건과 일치한다', async () => {
    mocks.shipments.mockResolvedValue({ rows: [], total: 0, origins: [], carriers: [], delayNoticeFingerprint: 'a'.repeat(64) });
    const sheet = await loadAdminListExportSheet('dispatch', { tab: 'delayed', delayNotice: 'not_sent', page: '9' }, new Date());
    expect(sheet.filters).toMatchObject({ tab: 'delayed', delayNotice: 'not_sent' });
    expect(sheet.conditions).toContainEqual(['발송지연 안내여부', '미발송']);
    expect(sheet.columns.map(column => column.header)).toContain('상품주문번호');
    expect(sheet.columns).toHaveLength(53);
    expect(sheet.recordCount).toBe(0);
  });
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
    expect(options).toEqual({ pageSize: 50, includeCounts: false });
    expect(sheet.rows[0][sheet.columns.findIndex((column) => column.header === '결제수단')]).toBe('카드');
  });

  it('미입금 확인은 입금 큐를 읽지 않는다', async () => {
    mocks.unpaid.mockResolvedValue({ rows: [], total: 0, filters: {}, pageSize: 200, deposits: [] });
    await loadAdminListExportSheet('unpaid', { q: '9A3F' }, new Date());
    expect(mocks.unpaid).toHaveBeenCalledWith({ query: '9A3F', page: 1, selectedOrderId: null }, { pageSize: 200, includeDeposits: false });
  });

  it('배송 화면은 탭 파서를 화면 모드로 쓰고 주문의 배송지를 함께 읽는다', async () => {
    const line = smartStoreDeliveryLine({ orderId: ORDER_ID });
    mocks.rpc.mockResolvedValue({ data: [line], error: null });
    mocks.shipments.mockResolvedValue({
      rows: [{ id: line.shipmentId, orderId: ORDER_ID, originId: 'o', originName: '김포', status: 'ready', createdAt: '2026-10-07T00:00:00Z', confirmedAt: null,
        buyerName: 'b', recipientName: 'r', total: 1, paymentMethod: 'card', shippingFee: 0, carrier: null, trackingNumber: null, shippedAt: null,
        deliveredAt: null, exportedAt: null, updatedAt: line.shipmentUpdatedAt, delayReason: null, expectedShipDate: null, items: [{ id: line.itemId, name: line.goodName, variantName: line.variantName, qty: line.qty }] }],
      delayNoticeFingerprint: 'a'.repeat(64), total: 1, origins: [{ id: 'o', name: '김포' }], carriers: [], counts: {}, surface: 'shipping', filters: {}, pageSize: 1000,
    });
    mocks.tables.orders = [{ id: ORDER_ID, address: { recipientName: '수령', phone: '01000000000', postalCode: '01234', address1: '서울' }, payment_method: 'card' }];
    const sheet = await loadAdminListExportSheet('shipping', { tab: 'delivered', page: '2' }, new Date());
    expect(mocks.shipments).toHaveBeenCalledWith(expect.objectContaining({ tab: 'delivered', page: 1 }), 'shipping', { pageSize: 1000 });
    expect(sheet.rows[0][sheet.columns.findIndex((column) => column.header === '수취인연락처1')]).toBe('01000000000');
    expect(sheet.rows[0][0]).toBe(line.productOrderNumber);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_delivery_list_export_lines', { p_ids: [line.shipmentId] });
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

  it.each([['recipient', '수취인명'], ['item', '상품주문번호'], ['product', '상품번호']] as const)(
    '%s 조건의 모든 요청을 읽고 일치하지 않은 같은 주문 품목도 보존한다', async (field, label) => {
      const rows = Array.from({ length: 101 }, (_, index) => ({ id: `claim-${index}`, reference: index + 1,
        orderId: index === 0 ? ORDER_ID : `order-${index}`, claimType: 'return', stage: 'requested',
        reasonType: 'change_of_mind', buyerName: 'b', buyerEmail: null, orderStatus: 'delivered', orderTotal: 2000,
        requestedAt: '2026-10-07T00:00:00Z', collectedAt: null, completedAt: null, refundMethod: null, handlerName: null }));
      mocks.claims.mockImplementation(async (_type, filters) => ({ rows: rows.slice((filters.page - 1) * 100, filters.page * 100),
        total: rows.length, claimType: 'return', counts: {}, filters, pageSize: 100 }));
      mocks.tables.orders = rows.map(row => ({ id: row.orderId, address: null, payment_method: 'card' }));
      mocks.tables.order_items = [
        { id: 'matched-item', order_id: ORDER_ID, good_name_snapshot: '검색 품목', variant_name_snapshot: null, qty: 1 },
        { id: 'other-item', order_id: ORDER_ID, good_name_snapshot: '같은 주문의 다른 품목', variant_name_snapshot: null, qty: 1 },
      ];
      const sheet = await loadAdminListExportSheet('claims-returns', { field, query: 'matched-item', stage: 'all', page: '99', dateField: 'paid' }, new Date());
      expect(mocks.claims).toHaveBeenNthCalledWith(1, 'return', expect.objectContaining({ field, query: 'matched-item', page: 1, dateField: 'paid' }), { pageSize: 100, includeCounts: false });
      expect(mocks.claims).toHaveBeenNthCalledWith(2, 'return', expect.objectContaining({ field, query: 'matched-item', page: 2, dateField: 'paid' }), { pageSize: 100, includeCounts: false });
      expect(sheet.recordCount).toBe(101);
      expect(sheet.rows).toHaveLength(102);
      const nameIndex = sheet.columns.findIndex(column => column.header === '상품명');
      expect(sheet.rows.slice(0, 2).map(row => row[nameIndex])).toEqual(['검색 품목', '같은 주문의 다른 품목']);
      expect(sheet.filters).toMatchObject({ field, query: 'matched-item', dateField: 'paid' });
      expect(sheet.conditions).toContainEqual(['검색 대상', label]);
      mocks.rpc.mockResolvedValue({ data: 'claim-search-export-audit', error: null });
      await recordAdminListExport(sheet);
      expect(mocks.rpc).toHaveBeenCalledWith('admin_record_list_export', expect.objectContaining({
        p_filters: expect.objectContaining({ field, query: 'matched-item' }), p_row_count: 102, p_record_count: 101,
      }));
    },
  );

  it('주문 50건의 상품 줄이 1,000줄을 넘어도 잘리지 않고 모두 담는다', async () => {
    mocks.claims.mockResolvedValue({
      rows: [{ id: 'c1', reference: 1, orderId: ORDER_ID, claimType: 'return', stage: 'requested', reasonType: 'change_of_mind', buyerName: 'b',
        buyerEmail: null, orderStatus: 'delivered', orderTotal: 1, requestedAt: '2026-10-07T00:00:00Z', collectedAt: null, completedAt: null,
        refundMethod: null, handlerName: null }],
      total: 1, claimType: 'return', counts: {}, filters: {}, pageSize: 100,
    });
    mocks.tables.order_items = Array.from({ length: 1500 }, (_, index) => ({
      id: `i${String(index).padStart(4, '0')}`, order_id: ORDER_ID, good_name_snapshot: `상품 ${index}`, variant_name_snapshot: null, qty: 1,
    }));
    mocks.tables.orders = [{ id: ORDER_ID, address: null, payment_method: 'card' }];
    const sheet = await loadAdminListExportSheet('claims-returns', { stage: 'all' }, new Date());
    expect(sheet.rows).toHaveLength(1500);
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


describe('상품주문별 내보내기', () => {
  const item = { id: 'item-0', orderId: ORDER_ID, userId: 'user', buyerName: '구매자', recipientName: null, status: 'paid', createdAt: '2026-09-01T00:00:00Z', goodId: 'g', goodName: '주문 당시 상품', variantName: null, variantCode: null, customInputs: null, qty: 1, unitPrice: 1000, itemAmount: 1000, shipmentId: null, shipmentStatus: null, originName: null, trackingNumber: null, carrierLabel: null, claim: null };
  it('1,005개 품목을 500개씩 끝까지 읽고 주문 로더로 확장하지 않는다', async () => {
    mocks.orderItems.mockImplementation(async ({ page }: { page: number }) => ({ rows: Array.from({ length: page === 3 ? 5 : 500 }, (_, n) => ({ ...item, id: `item-${(page - 1) * 500 + n}` })), total: 1005, fingerprint: 'a'.repeat(32) }));
    const sheet = await loadAdminListExportSheet('orders', { view: 'items', field: 'product', query: '합성', page: '7' }, new Date());
    expect(sheet.recordCount).toBe(1005); expect(sheet.rows[1004][0]).toBe('item-1004');
    expect(mocks.orderItems.mock.calls.map(([filter, limit]) => [filter.page, limit])).toEqual([[1, 500], [2, 500], [3, 500]]);
    expect(mocks.orders).not.toHaveBeenCalled(); expect(mocks.inCalls).toEqual([]);
  });
  it('건수와 품목 ID가 같아도 조회 중 배송·이름·금액이 바뀌면 내보내기를 중단한다', async () => {
    mocks.orderItems.mockImplementation(async ({ page }: { page: number }) => ({ rows: Array.from({ length: page === 1 ? 500 : 1 }, (_, n) => ({ ...item, id: `item-${(page - 1) * 500 + n}` })), total: 501, fingerprint: (page === 1 ? 'a' : 'b').repeat(32) }));
    await expect(loadAdminListExportSheet('orders', { view: 'items' }, new Date())).rejects.toBeInstanceOf(AdminListExportChangedError);
  });
});
