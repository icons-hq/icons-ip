import { randomUUID } from 'node:crypto';
import { RewardPolicyScreen } from '@/components/admin/screens/RewardPolicyScreen';
import { getAdminGoodsByIds, getAdminIpOptionsWith } from '@/lib/admin/catalog-list.server';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/*
 * 발급 정책 (규모 후속). 전에는 굿즈·IP 전량을 읽어 「이 IP 의 굿즈」 select 를 화면에서 걸렀다 —
 * 1,000행에서 말없이 잘리는 자리다. 이제 굿즈는 **검색 선택기**(IP 로 범위를 좁힌다)로 고르고,
 * 화면이 이름을 적어야 하는 굿즈·IP 는 정책이 **참조하는 것**만 읽는다.
 */
export default async function AdminCatalogPoliciesPage() {
  await requireAdminScreenAccess('/admin/catalog/policies');

  const records = await getAdminCatalogRecords({ include: ['rewardPolicies', 'cardPools'] });
  const [goods, ipOptions] = await Promise.all([
    getAdminGoodsByIds(records.rewardPolicies.map((policy) => policy.targetGoodId ?? '')),
    getAdminIpOptionsWith([
      ...records.rewardPolicies.map((policy) => policy.targetIpId),
      ...records.cardPools.map((pool) => pool.ipId),
    ]),
  ]);

  return (
    <RewardPolicyScreen
      draftActiveFrom={new Date().toISOString()}
      draftId={randomUUID()}
      goods={goods}
      ipOptions={ipOptions}
      operationId={randomUUID()}
      pools={records.cardPools}
      records={records.rewardPolicies}
    />
  );
}
