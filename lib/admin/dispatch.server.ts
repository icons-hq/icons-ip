import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_DISPATCH_PAGE_SIZE,
  ADMIN_DISPATCH_TABS,
  adminDispatchItemSummary,
  adminDispatchTab,
  type AdminDispatchConsoleData,
  type AdminDispatchFilters,
  type AdminDispatchOrderRow,
  type AdminDispatchTabId,
} from './dispatch';

interface SearchRow {
  id: string;
  buyer_name: string | null;
  user_id: string;
  status: string;
  total: number;
  created_at: string;
  total_count: number;
}

interface ItemRow {
  id: string;
  order_id: string;
  qty: number;
  unit_price: number;
  good_name_snapshot: string;
  good_type_snapshot: string;
}

interface PaymentRow {
  ref_id: string;
  provider: string | null;
  status: string;
  created_at: string;
}

function buyerName(value: string | null, userId: string) {
  return value?.trim() || `fan_${userId.slice(0, 6)}`;
}

/**
 * 발주·발송 콘솔의 목록.
 *
 * 목록 자체는 기존 `admin_search_orders`를 그대로 쓴다 — 탭이 곧 상태 필터라
 * 전용 RPC를 새로 만들 이유가 없고, staff 권한 검사와 검색 규칙도 한 곳에 남는다.
 *
 * 탭 건수는 활성 탭이 아닌 칸도 함께 센다. 0건 칩을 감추지 않는 것과 같은 이유로,
 * "다른 탭에 몇 건이 쌓여 있는지"는 운영자가 화면을 옮기기 전에 알아야 한다.
 */
export async function getAdminDispatchOrders(
  filters: AdminDispatchFilters,
): Promise<AdminDispatchConsoleData> {
  const supabase = await createClient();
  const activeStatus = adminDispatchTab(filters.tab).status;

  const searchArgs = {
    p_from: filters.from,
    p_query: filters.query || null,
    p_to: filters.to,
  };

  const [listResult, ...countResults] = await Promise.all([
    supabase.rpc('admin_search_orders', {
      ...searchArgs,
      p_limit: ADMIN_DISPATCH_PAGE_SIZE,
      p_offset: (filters.page - 1) * ADMIN_DISPATCH_PAGE_SIZE,
      p_status: activeStatus,
    }),
    /* 건수만 필요한 탭은 1행만 받는다. total_count는 창 함수라 limit과 무관하다. */
    ...ADMIN_DISPATCH_TABS.map((tab) => supabase.rpc('admin_search_orders', {
      ...searchArgs,
      p_limit: 1,
      p_offset: 0,
      p_status: tab.status,
    })),
  ]);

  if (listResult.error) {
    throw new Error(`Failed to load dispatch orders: ${listResult.error.message}`);
  }

  const counts = {} as Record<AdminDispatchTabId, number>;
  ADMIN_DISPATCH_TABS.forEach((tab, index) => {
    const result = countResults[index];
    if (result.error) {
      throw new Error(`Failed to count dispatch orders: ${result.error.message}`);
    }
    const rows = (result.data ?? []) as SearchRow[];
    counts[tab.id] = rows[0]?.total_count ?? 0;
  });

  const rows = (listResult.data ?? []) as SearchRow[];
  if (!rows.length) {
    return { counts, filters, pageSize: ADMIN_DISPATCH_PAGE_SIZE, rows: [], total: 0 };
  }

  const orderIds = rows.map((row) => row.id);
  const [itemsResult, paymentsResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('id,order_id,qty,unit_price,good_name_snapshot,good_type_snapshot')
      .in('order_id', orderIds)
      .order('id', { ascending: true }),
    supabase
      .from('payment_summaries')
      .select('ref_id,provider,status,created_at')
      .eq('purpose', 'order')
      .in('ref_id', orderIds)
      .order('created_at', { ascending: true }),
  ]);

  if (itemsResult.error) {
    throw new Error(`Failed to load dispatch order items: ${itemsResult.error.message}`);
  }
  if (paymentsResult.error) {
    throw new Error(`Failed to load dispatch order payments: ${paymentsResult.error.message}`);
  }

  const itemsByOrder = new Map<string, ItemRow[]>();
  for (const item of (itemsResult.data ?? []) as ItemRow[]) {
    const entries = itemsByOrder.get(item.order_id) ?? [];
    entries.push(item);
    itemsByOrder.set(item.order_id, entries);
  }

  /* 결제가 여러 번 시도된 주문에서는 확정된 건이 진실이다. 없으면 마지막 시도를
     보여주되, 실패한 시도를 "결제수단"으로 단정하지 않는다. */
  const paymentByOrder = new Map<string, PaymentRow>();
  for (const payment of (paymentsResult.data ?? []) as PaymentRow[]) {
    const current = paymentByOrder.get(payment.ref_id);
    if (!current || (payment.status === 'paid' && current.status !== 'paid')) {
      paymentByOrder.set(payment.ref_id, payment);
    }
  }

  const dispatchRows: AdminDispatchOrderRow[] = rows.map((row) => ({
    id: row.id,
    buyerName: buyerName(row.buyer_name, row.user_id),
    createdAt: row.created_at,
    total: row.total,
    paymentProvider: paymentByOrder.get(row.id)?.provider ?? null,
    items: adminDispatchItemSummary(
      (itemsByOrder.get(row.id) ?? []).map((item) => ({
        id: item.id,
        name: item.good_name_snapshot,
        type: item.good_type_snapshot,
        qty: item.qty,
        unitPrice: item.unit_price,
      })),
    ),
  }));

  return {
    counts,
    filters,
    pageSize: ADMIN_DISPATCH_PAGE_SIZE,
    rows: dispatchRows,
    total: rows[0].total_count,
  };
}
