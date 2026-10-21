import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_SETTLED_PAGE_SIZE,
  type AdminSettledConsoleData,
  type AdminSettledFilters,
  type AdminSettledOrderRow,
} from './settled';

interface SearchRow {
  order_number?: string;
  id: string;
  user_id: string;
  buyer_name: string | null;
  total: number;
  created_at: string;
  delivered_at: string | null;
  done_at: string | null;
  total_count: number;
}

function buyerName(value: string | null, userId: string) {
  return value?.trim() || `fan_${userId.slice(0, 6)}`;
}

/**
 * 거래확정 목록. 행은 주문 단위로 유지한다. 품목·결제 원장 엑셀은 생성 시점의
 * 비공개 영수증을 별도로 캡처하므로, 목록 페이지마다 상세 원장을 읽지 않는다.
 */
export async function getAdminSettledOrders(
  filters: AdminSettledFilters,
): Promise<AdminSettledConsoleData> {
  const supabase = await createClient();
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? ADMIN_SETTLED_PAGE_SIZE) || ADMIN_SETTLED_PAGE_SIZE, 1), 100);
  const { data, error } = await supabase.rpc('admin_search_orders_console', {
    p_from: filters.from,
    p_limit: pageSize,
    p_offset: (filters.page - 1) * pageSize,
    p_query: filters.query || null,
    p_field: filters.field ?? 'all',
    p_status: 'done',
    p_to: filters.to,
    p_date_field: filters.dateField ?? 'ordered',
    p_sort: filters.sort ?? 'newest',
  });

  if (error) throw new Error(`Failed to load settled orders: ${error.message}`);

  const rows = (data ?? []) as SearchRow[];
  const settled: AdminSettledOrderRow[] = rows.map((row) => ({
    id: row.id,
    ...(row.order_number ? { orderNumber: row.order_number } : {}),
    buyerName: buyerName(row.buyer_name, row.user_id),
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    doneAt: row.done_at,
    total: row.total,
  }));

  return {
    filters,
    pageSize,
    rows: settled,
    total: rows[0]?.total_count ?? 0,
  };
}
