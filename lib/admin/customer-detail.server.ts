import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminCustomerDetail, CustomerDetailFilters } from './customer-detail';
import { getMemberModerationContext } from './member-moderation.server';
import { getMemberWithdrawalStatus } from './member-withdrawal.server';
import { getMemberVerificationLimits } from './member-verification-limits.server';

export async function getAdminCustomerDetail(userId: string, filters: CustomerDetailFilters): Promise<AdminCustomerDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_customer_detail', {
    target_user_id: userId, target_tab: filters.tab, target_page: filters.page,
  });
  if (error) throw new Error('고객 상세를 불러오지 못했습니다.');
  if (!data) return null;
  const detail = data as AdminCustomerDetail;
  const [moderation, withdrawal, verificationLimits] = await Promise.all([
    getMemberModerationContext(userId), getMemberWithdrawalStatus(userId),
    filters.tab === 'overview' ? getMemberVerificationLimits(userId) : null,
  ]);
  return { ...detail, customer: { ...detail.customer, moderation, withdrawal, verificationLimits } };
}

/** Only the permitted order or claim history; never load the global customer dossier. */
export async function getAdminCustomerHistory(userId: string, filters: CustomerDetailFilters) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_operator_customer_history', { target_user_id: userId, target_tab: filters.tab, target_page: filters.page });
  if (error) throw new Error('고객 이력을 불러오지 못했습니다.');
  if (!data) return null;
  return { items: data.items, tab: data.tab, page: data.page, pageSize: data.pageSize, total: data.total } as Pick<AdminCustomerDetail, 'items' | 'tab' | 'page' | 'pageSize' | 'total'>;
}
