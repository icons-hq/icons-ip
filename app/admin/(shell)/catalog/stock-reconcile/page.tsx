import { StockReconcileScreen } from '@/components/admin/screens/StockReconcileScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { loadGoodsFulfillmentOptions } from '@/lib/admin/fulfillment-origins.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { STOCK_RECONCILE_PATH } from '@/lib/admin/stock-reconcile';
import { loadStockReconcileWorkspace } from '@/lib/admin/stock-reconcile.server';
import { loadStockSafetyDigest } from '@/lib/admin/stock-safety-digest.server';

/* 재고를 바꾸는 화면이라 재고 조정과 같은 권한(catalog.manage)으로 연다. 요약 메일 설정은 platform.manage만 본다. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess(STOCK_RECONCILE_PATH, { capability: 'catalog.manage' });
  const query = await searchParams;
  const snapshotId = typeof query.snapshot === 'string' ? query.snapshot : null;
  const canManageDigest = hasAdminCapability(auth, 'platform.manage');
  const [workspace, origins, digest] = await Promise.all([
    loadStockReconcileWorkspace(snapshotId),
    loadGoodsFulfillmentOptions(),
    canManageDigest ? loadStockSafetyDigest() : Promise.resolve(null),
  ]);
  return <StockReconcileScreen
    origins={origins.map(({ id, name, active }) => ({ id, name, active }))}
    history={workspace.history}
    snapshot={workspace.snapshot}
    digest={digest}
    canManageDigest={canManageDigest}
    now={new Date().toISOString()}
  />;
}
