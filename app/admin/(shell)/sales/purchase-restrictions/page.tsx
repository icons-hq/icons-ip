import { PurchaseRestrictionsScreen } from '@/components/admin/screens/PurchaseRestrictionsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizePurchaseRestrictionFilters } from '@/lib/admin/purchase-restrictions';
import { isUuid } from '@/lib/uuid';
import { loadPurchaseRestrictionBatch } from '@/lib/admin/purchase-restriction-batches.server';
import { getPurchaseRestrictions } from '@/lib/admin/purchase-restrictions.server';
import { loadRestrictionRelease } from '@/lib/admin/purchase-restriction-release.server';

export default async function PurchaseRestrictionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess('/admin/sales/purchase-restrictions');
  const params = await searchParams;
  const [data, initialBatch, initialRelease] = await Promise.all([getPurchaseRestrictions(normalizePurchaseRestrictionFilters(params)),
    isUuid(params.batch) ? loadPurchaseRestrictionBatch(params.batch) : Promise.resolve(null),
    isUuid(params.releaseBatch) ? loadRestrictionRelease(params.releaseBatch.toLowerCase()) : Promise.resolve(null)]);
  return <PurchaseRestrictionsScreen data={data} initialBatch={initialBatch} batchMissing={typeof params.batch === 'string' && (!isUuid(params.batch) || !initialBatch)}
    initialRelease={initialRelease} releaseMissing={typeof params.releaseBatch === 'string' && (!isUuid(params.releaseBatch) || !initialRelease)} />;
}
