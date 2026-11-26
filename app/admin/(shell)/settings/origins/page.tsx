import { unstable_rethrow } from 'next/navigation';
import { FulfillmentOriginsScreen, GoodsOriginSummaryScreen } from '@/components/admin/screens/FulfillmentOriginsScreen';
import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';
import { FULFILLMENT_ORIGINS_PATH } from '@/lib/admin/fulfillment-origins';
import { loadAdminFulfillmentOrigins, loadGoodsFulfillmentOptions } from '@/lib/admin/fulfillment-origins.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadOriginSaveImpact } from '@/lib/admin/shipping-impact.server';
import { shippingRegionOriginOverview, type ShippingRegionBlockedOrigin } from '@/lib/admin/shipping-regions';
import { loadAdminShippingRegionPolicies } from '@/lib/admin/shipping-regions.server';
import { loadAdminShippingCarriers, loadAdminStoreSettingsHistory } from '@/lib/admin/store-settings.server';
import { ShippingChargeGroupsPanel } from '@/components/admin/screens/ShippingChargeGroupsPanel';
import { selectedFulfillmentOriginTab } from '@/lib/admin/fulfillment-origin-tabs';
type SearchParams = Record<string, string | string[] | undefined>;

/** 지역별 추가배송비 설정. 새 주문이 막힌 출고지를 알리는 데만 쓰므로 읽지 못하면(권한 없음 포함) 비워 둔다 — 이 화면은 그대로 열린다. */
async function readRegionPolicies() {
  try { return await loadAdminShippingRegionPolicies(); } catch (error) { unstable_rethrow(error); return undefined; }
}
/** 지역별 추가배송비 때문에 새 주문이 막힌 출고지(사용 중인 출고지만). 판정은 지역별 추가배송비 화면과 같은 함수다. */
function regionBlocksOf(regions: Awaited<ReturnType<typeof readRegionPolicies>>, origins: { id: string; name: string; defaultCarrier: string | null; active: boolean }[], carriers: { code: string; active: boolean }[]): ShippingRegionBlockedOrigin[] | undefined {
  return regions ? shippingRegionOriginOverview({ origins, carriers, policies: regions.policies, adoptions: regions.adoptions, now: Date.now() }).blocked : undefined;
}
export default async function Page({ searchParams }: { searchParams?: Promise<SearchParams> } = {}) {
  const auth = await requireAdminScreenAccess(FULFILLMENT_ORIGINS_PATH);
  const query: SearchParams = searchParams ? await searchParams : {};
  const canManageRegional = canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true });
  if (!hasAdminCapability(auth, 'platform.manage')) {
    const [origins, carriers, regions] = await Promise.all([loadGoodsFulfillmentOptions(), loadAdminShippingCarriers(), readRegionPolicies()]);
    return <><GoodsOriginSummaryScreen origins={origins} regionBlocks={regionBlocksOf(regions, origins, carriers)} />
      <ShippingChargeGroupsPanel accountId={auth.user.id} origins={origins} carriers={carriers} canEdit canManageRegional={false} /></>;
  }
  const [origins, carriers, history, regions] = await Promise.all([loadAdminFulfillmentOrigins(), loadAdminShippingCarriers(), loadAdminStoreSettingsHistory(), readRegionPolicies()]);
  const groupOrigins = origins.map(({ id, name, defaultCarrier, baseFee, freeThreshold, returnAddress, active }) => ({ id, name, defaultCarrier, baseFee, freeThreshold, returnAddress, active }));
  const selected = selectedFulfillmentOriginTab(origins, query.origin, canManageRegional);
  /* 저장 전에 알릴 영향(영향받는 공개 상품 수·지역별 추가배송비 사용 여부)은 저장할 수 있는 사람이 보는 출고지 하나만 읽는다. 읽지 못해도 화면은 열린다. */
  const selectedOrigin = canManageRegional ? origins.find(origin => origin.code === selected) : undefined;
  const impact = selectedOrigin ? await loadOriginSaveImpact(selectedOrigin.id) : undefined;
  /* 출고지 설정이 먼저다 — 묶음그룹은 없을 수 있고, 있어도 출고지를 고른 뒤에 쓴다. */
  return <><FulfillmentOriginsScreen origins={origins} carriers={carriers} accountId={auth.user.id} selected={selected}
    history={history.filter(entry => entry.action === 'admin.fulfillment_origin.saved')}
    canEdit={canManageRegional} impact={impact} regionBlocks={regionBlocksOf(regions, origins, carriers)} />
    <ShippingChargeGroupsPanel accountId={auth.user.id} origins={groupOrigins} carriers={carriers} canEdit={hasAdminCapability(auth, 'catalog.manage')} canManageRegional={canManageRegional} defaultOriginId={origins.find(origin => origin.code === selected)?.id} /></>;
}
