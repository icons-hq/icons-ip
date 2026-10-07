import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { loadOrderShipments } from '@/lib/orders/shipments.server';
import type { ShipmentRecord } from '@/lib/orders/shipments';
import type { OrderClaimType } from '@/lib/orders/claims';
import { normalizeAdminOrderFilters } from './orders';
import { getAdminOrderRecords } from './orders.server';
import { normalizeAdminUnpaidFilters } from './unpaid';
import { getAdminUnpaidOrders } from './unpaid.server';
import { normalizeShipmentFilters, type ShipmentConsoleData } from './shipment-dispatch';
import { getShipmentConsoleData } from './shipment-dispatch.server';
import { normalizeAdminClaimFilters } from './claims';
import { getAdminClaimConsoleData } from './claims.server';
import {
  ADMIN_LIST_EXPORT_ROW_LIMIT,
  assertAdminListExportWithinLimit,
  type AdminListExportScreenId,
  type AdminListExportSheet,
} from './list-export';
import {
  claimsListExportSheet,
  listExportContact,
  ordersListExportSheet,
  shipmentsListExportSheet,
  unpaidListExportSheet,
  type ListExportClaimItem,
  type ListExportClaimOrder,
  type ListExportContact,
} from './list-export-sheets';

/*
 * 목록 엑셀 다운로드 로더.
 *
 * 화면과 같은 파서·로더를 그대로 쓰고 페이지 크기만 각 RPC 상한까지 키워 전체 결과를
 * 모은다 — 화면에서 본 조건과 파일의 조건이 다른 의미가 되지 않게 하기 위해서다.
 * 모든 조회는 호출자 세션(staff RLS·staff RPC)으로 한다. service role은 쓰지 않는다.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/* 주문 로더는 한 페이지의 품목·결제·배송을 `.in()`으로 함께 읽는다. PostgREST 응답 상한
   (max_rows 1,000)을 넘지 않도록 주문 50건씩 읽는다. */
const ORDER_PAGE_SIZE = 50;
const UNPAID_PAGE_SIZE = 200;
const SHIPMENT_PAGE_SIZE = 1000;
const CLAIM_PAGE_SIZE = 100;
const ID_CHUNK = 100;
const ITEM_ORDER_CHUNK = 50;
const PAGE_CONCURRENCY = 4;

export class AdminListExportLoadError extends Error {
  constructor() {
    super('목록을 불러오지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.');
    this.name = 'AdminListExportLoadError';
  }
}

export class AdminListExportAuditError extends Error {
  constructor() {
    super('다운로드 기록을 남기지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.');
    this.name = 'AdminListExportAuditError';
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function mapLimited<T, R>(values: readonly T[], limit: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const batch of chunks(values, limit)) results.push(...await Promise.all(batch.map(task)));
  return results;
}

/**
 * 페이지 로더를 상한까지 반복해 전체 결과를 모은다.
 *
 * 첫 페이지의 전체 건수가 상한을 넘으면 더 읽지 않고 멈춘다. 읽는 사이 새 건이 생겨
 * 페이지 경계가 밀리면 같은 건이 두 번 올 수 있어 키로 중복을 지우고, 건수가 늘었으면
 * 남은 페이지를 더 읽는다.
 */
export async function collectAdminListExportPages<T>(
  pageSize: number,
  loadPage: (page: number) => Promise<{ items: T[]; total: number }>,
  key: (item: T) => string,
): Promise<T[]> {
  const first = await loadPage(1);
  assertAdminListExportWithinLimit(first.total);
  let total = first.total;
  const pages = [first.items];
  let next = 2;
  const plannedLast = Math.ceil(total / pageSize);
  if (plannedLast >= next) {
    const planned = Array.from({ length: plannedLast - 1 }, (_, index) => index + 2);
    const loaded = await mapLimited(planned, PAGE_CONCURRENCY, loadPage);
    for (const page of loaded) {
      pages.push(page.items);
      total = Math.max(total, page.total);
    }
    next = plannedLast + 1;
  }

  const seen = new Set<string>();
  const unique: T[] = [];
  const add = (items: T[]) => {
    for (const item of items) {
      const id = key(item);
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(item);
    }
  };
  pages.forEach(add);

  const lastPage = Math.ceil(ADMIN_LIST_EXPORT_ROW_LIMIT / pageSize) + 1;
  while (unique.length < total && next <= lastPage) {
    assertAdminListExportWithinLimit(total);
    const page = await loadPage(next++);
    if (!page.items.length) break;
    total = Math.max(total, page.total);
    add(page.items);
  }
  assertAdminListExportWithinLimit(unique.length);
  return unique;
}

async function orderContacts(orderIds: readonly string[]) {
  const supabase = await createClient();
  const contacts = new Map<string, { contact: ListExportContact | null; paymentMethod: string | null }>();
  await mapLimited(chunks([...new Set(orderIds)], ID_CHUNK), PAGE_CONCURRENCY, async (ids) => {
    const { data, error } = await supabase.from('orders').select('id,address,payment_method').in('id', ids);
    if (error) throw new AdminListExportLoadError();
    for (const row of (data ?? []) as { id: string; address: unknown; payment_method: string | null }[]) {
      contacts.set(row.id, { contact: listExportContact(row.address), paymentMethod: row.payment_method });
    }
  });
  return contacts;
}

async function ordersSheet(params: SearchParams) {
  const filters = { ...normalizeAdminOrderFilters(params), orderId: null };
  const records = await collectAdminListExportPages(
    ORDER_PAGE_SIZE,
    async (page) => {
      const data = await getAdminOrderRecords({ ...filters, page }, false, { pageSize: ORDER_PAGE_SIZE });
      return { items: data.items, total: data.total };
    },
    (record) => record.id,
  );
  const extras = await orderContacts(records.map((record) => record.id));
  const paymentMethods = new Map([...extras].map(([id, value]) => [id, value.paymentMethod]));
  return ordersListExportSheet({ records, paymentMethods, filters });
}

async function unpaidSheet(params: SearchParams) {
  const filters = { ...normalizeAdminUnpaidFilters(params), selectedOrderId: null };
  const rows = await collectAdminListExportPages(
    UNPAID_PAGE_SIZE,
    async (page) => {
      const data = await getAdminUnpaidOrders({ ...filters, page }, { pageSize: UNPAID_PAGE_SIZE, includeDeposits: false });
      return { items: data.rows, total: data.total };
    },
    (row) => row.id,
  );
  return unpaidListExportSheet({ rows, filters });
}

async function shipmentsSheet(surface: 'dispatch' | 'shipping', params: SearchParams) {
  const filters = normalizeShipmentFilters(params, surface);
  const meta: { value: Pick<ShipmentConsoleData, 'origins' | 'carriers'> | null } = { value: null };
  const rows = await collectAdminListExportPages(
    SHIPMENT_PAGE_SIZE,
    async (page) => {
      const data = await getShipmentConsoleData({ ...filters, page }, surface, { pageSize: SHIPMENT_PAGE_SIZE });
      meta.value ??= { origins: data.origins, carriers: data.carriers };
      return { items: data.rows, total: data.total };
    },
    (row) => row.id,
  );
  const extras = await orderContacts(rows.map((row) => row.orderId));
  const contacts = new Map([...extras].map(([id, value]) => [id, value.contact]));
  const { origins, carriers } = meta.value ?? { origins: [], carriers: [] };
  return shipmentsListExportSheet({ surface, rows, filters, contacts, origins, carriers });
}

async function claimOrders(claimType: OrderClaimType, orderIds: readonly string[]) {
  const supabase = await createClient();
  const ids = [...new Set(orderIds)];
  const orders = new Map<string, ListExportClaimOrder>(ids.map((id) => [id, { items: [], contact: null, shipments: [] }]));

  await mapLimited(chunks(ids, ITEM_ORDER_CHUNK), PAGE_CONCURRENCY, async (chunk) => {
    const { data, error } = await supabase
      .from('order_items')
      .select('id,order_id,good_name_snapshot,variant_name_snapshot,qty')
      .in('order_id', chunk)
      .order('id', { ascending: true });
    if (error) throw new AdminListExportLoadError();
    for (const row of (data ?? []) as { id: string; order_id: string; good_name_snapshot: string; variant_name_snapshot: string | null; qty: number }[]) {
      const item: ListExportClaimItem = { id: row.id, name: row.good_name_snapshot, variantName: row.variant_name_snapshot ?? null, qty: row.qty };
      orders.get(row.order_id)?.items.push(item);
    }
  });

  if (claimType !== 'cancel') {
    const contacts = await orderContacts(ids);
    for (const [id, value] of contacts) {
      const order = orders.get(id);
      if (order) order.contact = value.contact;
    }
    const carriers = await getShippingCarrierRegistry();
    const shipments: ShipmentRecord[] = (await mapLimited(chunks(ids, ID_CHUNK), PAGE_CONCURRENCY,
      (chunk) => loadOrderShipments(supabase, chunk, carriers))).flat();
    for (const shipment of shipments) orders.get(shipment.orderId)?.shipments.push(shipment);
  }
  return orders;
}

async function claimsSheet(claimType: OrderClaimType, params: SearchParams, now: Date) {
  const filters = normalizeAdminClaimFilters(params);
  const rows = await collectAdminListExportPages(
    CLAIM_PAGE_SIZE,
    async (page) => {
      const data = await getAdminClaimConsoleData(claimType, { ...filters, page }, { pageSize: CLAIM_PAGE_SIZE, includeCounts: false });
      return { items: data.rows, total: data.total };
    },
    (row) => row.id,
  );
  const orders = await claimOrders(claimType, rows.map((row) => row.orderId));
  return claimsListExportSheet({ claimType, rows, filters, orders, now });
}

const CLAIM_TYPES: Record<string, OrderClaimType> = {
  'claims-cancels': 'cancel',
  'claims-returns': 'return',
  'claims-exchanges': 'exchange',
};

/** 화면 id와 화면 검색 파라미터로 목록 시트를 만든다. 상한을 넘으면 AdminListExportLimitError. */
export async function loadAdminListExportSheet(
  screen: AdminListExportScreenId,
  params: SearchParams,
  now: Date,
): Promise<AdminListExportSheet> {
  let sheet: AdminListExportSheet;
  if (screen === 'orders') sheet = await ordersSheet(params);
  else if (screen === 'unpaid') sheet = await unpaidSheet(params);
  else if (screen === 'dispatch' || screen === 'shipping') sheet = await shipmentsSheet(screen, params);
  else sheet = await claimsSheet(CLAIM_TYPES[screen], params, now);
  assertAdminListExportWithinLimit(sheet.rows.length);
  return sheet;
}

/** 누가·언제·어느 화면·어떤 조건·몇 건을 내려받았는지 남긴다. 실패하면 파일을 내보내지 않는다. */
export async function recordAdminListExport(sheet: AdminListExportSheet): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_record_list_export', {
    p_screen: sheet.screen,
    p_filters: sheet.filters,
    p_row_count: sheet.rows.length,
    p_record_count: sheet.recordCount,
  });
  if (error || typeof data !== 'string') throw new AdminListExportAuditError();
  return data;
}
