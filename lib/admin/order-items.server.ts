import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseAdminOrderItemData, type AdminOrderItemFilters } from './order-items';
import { loadOrderItemAllocations, loadOrderItemAllocationsForScreen } from './item-allocation.server';

/** `strictAllocations`: 엑셀은 배분 조회가 실패하면 멈추고, 화면은 배분 칸만 비운다. */
export async function getAdminOrderItemData(filters: AdminOrderItemFilters, limit = filters.pageSize ?? 20, options: { strictAllocations?: boolean } = {}) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_search_order_items_console', {
    p_status: filters.status === 'all' ? null : filters.status, p_from: filters.from, p_to: filters.to, p_query: filters.query || null,
    p_limit: limit, p_offset: (filters.page - 1) * limit, p_field: filters.field, p_date_field: filters.dateField ?? 'ordered',
    p_sort: filters.sort ?? 'newest', p_payment_method: filters.paymentMethod ?? null,
  });
  const result = parseAdminOrderItemData(data, filters);
  if (error || !result) throw new Error('Failed to load order item console');
  const orderIds = result.rows.map(row => row.orderId);
  const allocations = options.strictAllocations ? await loadOrderItemAllocations(orderIds, client) : await loadOrderItemAllocationsForScreen(orderIds);
  return { ...result, rows: result.rows.map(row => ({ ...row, allocation: allocations.get(row.id)?.allocation ?? null })) };
}
