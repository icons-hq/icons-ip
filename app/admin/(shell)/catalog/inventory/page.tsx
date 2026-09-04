import { InventoryConsole } from '@/components/admin/catalog/InventoryConsole';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminInventoryFilters } from '@/lib/admin/variants';
import { getAdminInventory, getAdminStockLocations } from '@/lib/admin/variants.server';

/* 재고 관리 — 품목 × 출고지 목록. 조건은 URL, 자르기는 RPC. */
export default async function AdminCatalogInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/catalog/inventory');
  const filters = normalizeAdminInventoryFilters(await searchParams);
  const [list, locations] = await Promise.all([
    getAdminInventory(filters),
    getAdminStockLocations({ activeOnly: true }),
  ]);

  return <InventoryConsole filters={filters} list={list} locations={locations} />;
}
