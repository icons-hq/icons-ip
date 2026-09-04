import { StockLocationConsole } from '@/components/admin/catalog/StockLocationConsole';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminShippingCarrierOptions, getAdminStockLocations } from '@/lib/admin/variants.server';

/* 출고지 · 배송 정책 설정. 출고지는 D-1, 배송 정책 객체는 D-2 에서 합류한다. */
export default async function AdminShippingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/settings/shipping');
  const query = await searchParams;
  const selectedParam = typeof query.selected === 'string' ? query.selected.trim().toLowerCase() : '';
  const [locations, carriers] = await Promise.all([
    getAdminStockLocations(),
    getAdminShippingCarrierOptions(),
  ]);
  const selected = selectedParam === 'new'
    ? 'new' as const
    : locations.find((location) => location.id === selectedParam) ?? null;

  return <StockLocationConsole carriers={carriers} locations={locations} selected={selected} />;
}
