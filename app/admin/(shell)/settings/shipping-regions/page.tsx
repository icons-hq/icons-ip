import { canAccessAdminScreen } from '@/lib/admin/access';
import { ShippingRegionsScreen } from '@/components/admin/screens/ShippingRegionsScreen';
import { loadGoodsFulfillmentOptions } from '@/lib/admin/fulfillment-origins.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { SHIPPING_REGIONS_PATH } from '@/lib/admin/shipping-regions';
import { loadAdminShippingRegionPolicies } from '@/lib/admin/shipping-regions.server';
import { loadAdminShippingCarriers } from '@/lib/admin/store-settings.server';

export default async function Page() {
  const auth = await requireAdminScreenAccess(SHIPPING_REGIONS_PATH);
  const [regions, origins, carriers] = await Promise.all([
    loadAdminShippingRegionPolicies(), loadGoodsFulfillmentOptions(), loadAdminShippingCarriers(),
  ]);
  return <ShippingRegionsScreen policies={regions.policies} adoptions={regions.adoptions} origins={origins}
    carriers={carriers} canEdit={canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true })} />;
}
