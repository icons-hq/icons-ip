import { FulfillmentOriginsScreen } from '@/components/admin/screens/FulfillmentOriginsScreen';
import { FULFILLMENT_ORIGINS_PATH } from '@/lib/admin/fulfillment-origins';
import { loadAdminFulfillmentOrigins } from '@/lib/admin/fulfillment-origins.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminStoreSettings } from '@/lib/admin/store-settings.server';
export default async function Page() {
  const auth = await requireAdminScreenAccess(FULFILLMENT_ORIGINS_PATH);
  const [origins, settings] = await Promise.all([loadAdminFulfillmentOrigins(), loadAdminStoreSettings()]);
  return <FulfillmentOriginsScreen origins={origins} carriers={settings.carriers}
    history={settings.history.filter((entry) => entry.action === 'admin.fulfillment_origin.saved')} canEdit={auth.role === 'admin'} />;
}
