import { ErpItemsScreen } from '@/components/admin/screens/ErpItemsScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ERP_ITEMS_PATH, normalizeErpItemFilters } from '@/lib/admin/erp-items';
import { loadErpItemsWorkspace } from '@/lib/admin/erp-items.server';

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 화면은 상품 관리 권한(catalog.manage)으로 열고, 품목 삭제는 플랫폼 관리 권한이 있을 때만 그린다(1027T-016). */
  const auth = await requireAdminScreenAccess(ERP_ITEMS_PATH);
  const data = await loadErpItemsWorkspace(normalizeErpItemFilters(await searchParams));
  return <ErpItemsScreen data={data} canDelete={hasAdminCapability(auth, 'platform.manage')} />;
}
