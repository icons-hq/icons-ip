import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { PurchaseRestrictionData, PurchaseRestrictionFilters } from './purchase-restrictions';
export async function getPurchaseRestrictions(filters: PurchaseRestrictionFilters): Promise<PurchaseRestrictionData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_search_purchase_restrictions', {
    p_query: filters.query || null, p_state: filters.state, p_limit: filters.pageSize, p_offset: (filters.page - 1) * filters.pageSize,
  });
  if (error || !data || !Array.isArray(data.rows) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('Failed to load purchase restrictions');
  return { filters, rows: data.rows, total: data.total };
}
