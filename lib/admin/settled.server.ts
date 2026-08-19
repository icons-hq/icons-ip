import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_SETTLED_PAGE_SIZE,
  type AdminSettledConsoleData,
  type AdminSettledFilters,
  type AdminSettledOrderRow,
} from './settled';

interface SearchRow {
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
 * 거래확정 내역. 조회 전용이므로 품목·결제 상세는 싣지 않는다 — 여기서 필요한 것은
 * "확정된 주문이 언제 확정됐고 아직 하자 클레임을 받을 수 있는가"뿐이고, 나머지는
 * 주문 통합검색이 이미 보여준다.
 */
export async function getAdminSettledOrders(
  filters: AdminSettledFilters,
): Promise<AdminSettledConsoleData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_search_orders', {
    p_from: filters.from,
    p_limit: ADMIN_SETTLED_PAGE_SIZE,
    p_offset: (filters.page - 1) * ADMIN_SETTLED_PAGE_SIZE,
    p_query: filters.query || null,
    p_status: 'done',
    p_to: filters.to,
  });

  if (error) throw new Error(`Failed to load settled orders: ${error.message}`);

  const rows = (data ?? []) as SearchRow[];
  const settled: AdminSettledOrderRow[] = rows.map((row) => ({
    id: row.id,
    buyerName: buyerName(row.buyer_name, row.user_id),
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    doneAt: row.done_at,
    total: row.total,
  }));

  return {
    filters,
    pageSize: ADMIN_SETTLED_PAGE_SIZE,
    rows: settled,
    total: rows[0]?.total_count ?? 0,
  };
}
