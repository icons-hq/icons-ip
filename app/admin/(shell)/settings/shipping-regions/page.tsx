import { ShippingRegionsScreen } from '@/components/admin/screens/ShippingRegionsScreen';
import { loadAdminFulfillmentOrigins } from '@/lib/admin/fulfillment-origins.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { SHIPPING_REGIONS_PATH } from '@/lib/admin/shipping-regions';
import { loadAdminShippingRegionPolicies } from '@/lib/admin/shipping-regions.server';
import { loadAdminStoreSettings } from '@/lib/admin/store-settings.server';

export default async function Page() {
  const auth = await requireAdminScreenAccess(SHIPPING_REGIONS_PATH);
  const [regions, origins, settings] = await Promise.all([
    loadAdminShippingRegionPolicies(), loadAdminFulfillmentOrigins(), loadAdminStoreSettings(),
  ]);
  return <ShippingRegionsScreen policies={regions.policies} adoptions={regions.adoptions} origins={origins}
    carriers={settings.carriers} canEdit={auth.role === 'admin'} />;
}
