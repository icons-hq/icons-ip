import { FulfillmentOriginsScreen, GoodsOriginSummaryScreen } from '@/components/admin/screens/FulfillmentOriginsScreen';
import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';
import { FULFILLMENT_ORIGINS_PATH } from '@/lib/admin/fulfillment-origins';
import { loadAdminFulfillmentOrigins, loadGoodsFulfillmentOptions } from '@/lib/admin/fulfillment-origins.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadOriginSaveImpact } from '@/lib/admin/shipping-impact.server';
import { loadAdminShippingCarriers, loadAdminStoreSettingsHistory } from '@/lib/admin/store-settings.server';
import { ShippingChargeGroupsPanel } from '@/components/admin/screens/ShippingChargeGroupsPanel';
import { selectedFulfillmentOriginTab } from '@/lib/admin/fulfillment-origin-tabs';
type SearchParams = Record<string, string | string[] | undefined>;
export default async function Page({ searchParams }: { searchParams?: Promise<SearchParams> } = {}) {
  const auth = await requireAdminScreenAccess(FULFILLMENT_ORIGINS_PATH);
  const query: SearchParams = searchParams ? await searchParams : {};
  const canManageRegional = canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true });
  if (!hasAdminCapability(auth, 'platform.manage')) {
    const [origins, carriers] = await Promise.all([loadGoodsFulfillmentOptions(), loadAdminShippingCarriers()]);
    return <><GoodsOriginSummaryScreen origins={origins} />
      <ShippingChargeGroupsPanel accountId={auth.user.id} origins={origins} carriers={carriers} canEdit canManageRegional={false} /></>;
  }
  const [origins, carriers, history] = await Promise.all([loadAdminFulfillmentOrigins(), loadAdminShippingCarriers(), loadAdminStoreSettingsHistory()]);
  const groupOrigins = origins.map(({ id, name, defaultCarrier, baseFee, freeThreshold, returnAddress, active }) => ({ id, name, defaultCarrier, baseFee, freeThreshold, returnAddress, active }));
  const selected = selectedFulfillmentOriginTab(origins, query.origin, canManageRegional);
  /* 저장 전에 알릴 영향(영향받는 공개 상품 수·지역별 추가배송비 사용 여부)은 저장할 수 있는 사람이 보는 출고지 하나만 읽는다. 읽지 못해도 화면은 열린다. */
  const selectedOrigin = canManageRegional ? origins.find(origin => origin.code === selected) : undefined;
  const impact = selectedOrigin ? await loadOriginSaveImpact(selectedOrigin.id) : undefined;
  /* 출고지 설정이 먼저다 — 묶음그룹은 없을 수 있고, 있어도 출고지를 고른 뒤에 쓴다. */
  return <><FulfillmentOriginsScreen origins={origins} carriers={carriers} accountId={auth.user.id} selected={selected}
    history={history.filter(entry => entry.action === 'admin.fulfillment_origin.saved')}
    canEdit={canManageRegional} impact={impact} />
    <ShippingChargeGroupsPanel accountId={auth.user.id} origins={groupOrigins} carriers={carriers} canEdit={hasAdminCapability(auth, 'catalog.manage')} canManageRegional={canManageRegional} /></>;
}
