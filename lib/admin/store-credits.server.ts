import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseStoreCreditHistory, parseStoreCreditPolicyRecord, type StoreCreditHistory, type StoreCreditPolicyRecord } from '@/lib/store-credits';

export async function loadAdminStoreCreditPolicy(): Promise<StoreCreditPolicyRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_store_credit_policy');
  const policy = error ? null : parseStoreCreditPolicyRecord(data);
  if (!policy) throw new Error('적립금 정책을 불러오지 못했습니다.');
  return policy;
}
export async function loadAdminStoreCreditHistory(userId: string, page = 1): Promise<StoreCreditHistory> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_store_credit_history', { p_user_id: userId, p_page: page });
  const history = error ? null : parseStoreCreditHistory(data);
  if (!history || history.userId !== userId) throw new Error('고객 적립금 내역을 불러오지 못했습니다.');
  return history;
}
