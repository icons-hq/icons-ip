import { LoyaltyPolicyScreen } from '@/components/admin/screens/LoyaltyPolicyScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminLoyaltyPolicy } from '@/lib/admin/loyalty-policy.server';
import { LOYALTY_POLICY_PATH } from '@/lib/loyalty-policy';
import { loadCustomerRewardPolicy } from '@/lib/admin/customer-rewards.server';

export default async function CustomerGradesPage() {
  await requireAdminScreenAccess(LOYALTY_POLICY_PATH, { adminOnly: true });
  const [data, rewards] = await Promise.all([loadAdminLoyaltyPolicy(), loadCustomerRewardPolicy()]);
  return <LoyaltyPolicyScreen data={data} rewards={rewards} />;
}
