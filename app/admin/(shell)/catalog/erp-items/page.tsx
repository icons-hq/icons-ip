import { ErpItemsScreen } from '@/components/admin/screens/ErpItemsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ERP_ITEMS_PATH, normalizeErpItemFilters } from '@/lib/admin/erp-items';
import { loadErpItemsWorkspace } from '@/lib/admin/erp-items.server';

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess(ERP_ITEMS_PATH);
  const data = await loadErpItemsWorkspace(normalizeErpItemFilters(await searchParams));
  return <ErpItemsScreen data={data} />;
}
