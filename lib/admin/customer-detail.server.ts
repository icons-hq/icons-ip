import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminCustomerDetail, CustomerDetailFilters } from './customer-detail';

export async function getAdminCustomerDetail(userId: string, filters: CustomerDetailFilters): Promise<AdminCustomerDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_customer_detail', {
    target_user_id: userId, target_tab: filters.tab, target_page: filters.page,
  });
  if (error) throw new Error('고객 상세를 불러오지 못했습니다.');
  return data as AdminCustomerDetail | null;
}
