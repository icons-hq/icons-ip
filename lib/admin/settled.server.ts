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
 * 거래확정 목록. 행은 주문 단위로 유지한다. 품목·결제 원장 엑셀은 생성 시점의
 * 비공개 영수증을 별도로 캡처하므로, 목록 페이지마다 상세 원장을 읽지 않는다.
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
