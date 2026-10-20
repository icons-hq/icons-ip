import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseCustomerRewardPolicy } from './customer-rewards';
export async function loadCustomerRewardPolicy() {
  const { data, error } = await (await createClient()).rpc('admin_get_customer_reward_policy');
  const policy = error ? null : parseCustomerRewardPolicy(data);
  if (!policy) throw new Error('등급·리뷰 보상 정책을 불러오지 못했습니다.');
  return policy;
}
