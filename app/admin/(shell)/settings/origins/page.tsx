import { FulfillmentOriginsScreen, GoodsOriginSummaryScreen } from '@/components/admin/screens/FulfillmentOriginsScreen';
import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';
import { FULFILLMENT_ORIGINS_PATH } from '@/lib/admin/fulfillment-origins';
import { loadAdminFulfillmentOrigins, loadGoodsFulfillmentOptions } from '@/lib/admin/fulfillment-origins.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminShippingCarriers, loadAdminStoreSettingsHistory } from '@/lib/admin/store-settings.server';
import { ShippingChargeGroupsPanel } from '@/components/admin/screens/ShippingChargeGroupsPanel';
export default async function Page() {
  const auth = await requireAdminScreenAccess(FULFILLMENT_ORIGINS_PATH);
  const canManageRegional = canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true });
  if (!hasAdminCapability(auth, 'platform.manage')) {
    const [origins, carriers] = await Promise.all([loadGoodsFulfillmentOptions(), loadAdminShippingCarriers()]);
    return <><ShippingChargeGroupsPanel accountId={auth.user.id} origins={origins} carriers={carriers} canEdit canManageRegional={false} />
      <GoodsOriginSummaryScreen origins={origins} /></>;
  }
  const [origins, carriers, history] = await Promise.all([loadAdminFulfillmentOrigins(), loadAdminShippingCarriers(), loadAdminStoreSettingsHistory()]);
  const groupOrigins = origins.map(({ id, name, defaultCarrier, baseFee, freeThreshold, returnAddress, active }) => ({ id, name, defaultCarrier, baseFee, freeThreshold, returnAddress, active }));
  return <><ShippingChargeGroupsPanel accountId={auth.user.id} origins={groupOrigins} carriers={carriers} canEdit={hasAdminCapability(auth, 'catalog.manage')} canManageRegional={canManageRegional} />
    <FulfillmentOriginsScreen origins={origins} carriers={carriers} accountId={auth.user.id}
    history={history.filter(entry => entry.action === 'admin.fulfillment_origin.saved')}
    canEdit={canManageRegional} /></>;
}
