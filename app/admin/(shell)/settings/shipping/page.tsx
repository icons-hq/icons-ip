import { StockLocationConsole } from '@/components/admin/catalog/StockLocationConsole';
import { ShippingPolicyConsole } from '@/components/admin/settings/ShippingPolicyConsole';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminShippingPolicies } from '@/lib/admin/shipping-policies.server';
import { getAdminShippingCarrierOptions, getAdminStockLocations } from '@/lib/admin/variants.server';

/* 출고지(D-1) · 배송·교환반품 정책(현업 슬라이스 2). 배송비는 이제 코드 상수가 아니라
   여기서 정한다 — 화면 견적과 주문 청구가 같은 DB 함수를 본다. */
export default async function AdminShippingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/settings/shipping');
  const query = await searchParams;
  const selectedParam = typeof query.selected === 'string' ? query.selected.trim().toLowerCase() : '';
  const [locations, carriers, policies] = await Promise.all([
    getAdminStockLocations(),
    getAdminShippingCarrierOptions(),
    getAdminShippingPolicies(),
  ]);
  const selected = selectedParam === 'new'
    ? 'new' as const
    : locations.find((location) => location.id === selectedParam) ?? null;

  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      <StockLocationConsole carriers={carriers} locations={locations} selected={selected} />
      <ShippingPolicyConsole locations={locations} policies={policies} />
    </div>
  );
}
