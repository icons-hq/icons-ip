import { randomUUID } from 'node:crypto';
import { RewardPolicyScreen } from '@/components/admin/screens/RewardPolicyScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminCatalogPoliciesPage() {
  await requireAdminScreenAccess('/admin/catalog/policies');

  const records = await getAdminCatalogRecords({
    include: ['rewardPolicies', 'goods', 'cardPools', 'ips'],
  });

  return (
    <RewardPolicyScreen
      draftActiveFrom={new Date().toISOString()}
      draftId={randomUUID()}
      goods={records.goods}
      ips={records.ips}
      operationId={randomUUID()}
      pools={records.cardPools}
      records={records.rewardPolicies}
    />
  );
}
