import 'server-only';

import { orderShipment } from '@/lib/orders/shipment';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_SHIPPING_PAGE_SIZE,
  ADMIN_SHIPPING_TABS,
  adminShippingTab,
  type AdminShippingConsoleData,
  type AdminShippingFilters,
  type AdminShippingOrderRow,
  type AdminShippingTabId,
} from './shipping';

interface SearchRow {
  id: string;
  user_id: string;
  buyer_name: string | null;
  total: number;
  created_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
  shipping_carrier: string | null;
  tracking_number: string | null;
  total_count: number;
}

function buyerName(value: string | null, userId: string) {
  return value?.trim() || `fan_${userId.slice(0, 6)}`;
}

/**
 * 배송현황 목록.
 *
 * 발주·발송 콘솔과 같이 기존 `admin_search_orders`를 쓴다 — 탭이 곧 상태 필터라
 * 전용 RPC가 필요 없고, staff 권한 검사와 검색 규칙이 한 곳에 남는다.
 *
 * 품목·결제 상세는 싣지 않는다. 여기서 필요한 것은 "언제 나갔고, 어디쯤이고,
 * 도착했는가"뿐이고 나머지는 주문 통합검색이 이미 보여준다.
 */
export async function getAdminShippingOrders(
  filters: AdminShippingFilters,
): Promise<AdminShippingConsoleData> {
  const supabase = await createClient();
  const activeStatus = adminShippingTab(filters.tab).status;

  const searchArgs = {
    p_from: filters.from,
    p_query: filters.query || null,
    p_to: filters.to,
  };

  /* 조회 링크는 레지스트리 템플릿에서 만든다. 화면이 URL을 조립하지 않는다(#251). */
  const carriers = await getShippingCarrierRegistry();

  const [listResult, ...countResults] = await Promise.all([
    supabase.rpc('admin_search_orders', {
      ...searchArgs,
      p_limit: ADMIN_SHIPPING_PAGE_SIZE,
      p_offset: (filters.page - 1) * ADMIN_SHIPPING_PAGE_SIZE,
      p_status: activeStatus,
    }),
    /* 건수만 필요한 탭은 1행만 받는다. total_count는 창 함수라 limit과 무관하다. */
    ...ADMIN_SHIPPING_TABS.map((tab) => supabase.rpc('admin_search_orders', {
      ...searchArgs,
      p_limit: 1,
      p_offset: 0,
      p_status: tab.status,
    })),
  ]);

  if (listResult.error) {
    throw new Error(`Failed to load shipping orders: ${listResult.error.message}`);
  }

  const counts = {} as Record<AdminShippingTabId, number>;
  ADMIN_SHIPPING_TABS.forEach((tab, index) => {
    const result = countResults[index];
    if (result.error) {
      throw new Error(`Failed to count shipping orders: ${result.error.message}`);
    }
    const countRows = (result.data ?? []) as SearchRow[];
    counts[tab.id] = countRows[0]?.total_count ?? 0;
  });

  const rows = (listResult.data ?? []) as SearchRow[];
  const shippingRows: AdminShippingOrderRow[] = rows.map((row) => ({
    id: row.id,
    buyerName: buyerName(row.buyer_name, row.user_id),
    createdAt: row.created_at,
    shippedAt: row.shipped_at,
    deliveredAt: row.delivered_at,
    total: row.total,
    shipment: orderShipment(carriers, row.shipping_carrier, row.tracking_number),
  }));

  return {
    counts,
    filters,
    pageSize: ADMIN_SHIPPING_PAGE_SIZE,
    rows: shippingRows,
    total: rows[0]?.total_count ?? 0,
  };
}
