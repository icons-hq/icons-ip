import { ShippingCarriersScreen } from '@/components/admin/screens/StoreSettingsScreen';
import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { CARRIER_SETTINGS_PATH } from '@/lib/admin/store-settings';
import { loadAdminShippingCarriers, loadAdminStoreSettingsHistory } from '@/lib/admin/store-settings.server';
export default async function Page() {
  const auth = await requireAdminScreenAccess(CARRIER_SETTINGS_PATH);
  const [carriers, history] = await Promise.all([loadAdminShippingCarriers(), hasAdminCapability(auth, 'platform.manage') ? loadAdminStoreSettingsHistory() : Promise.resolve([])]);
  return <ShippingCarriersScreen carriers={carriers} history={history.filter(entry => entry.target.startsWith('shipping_carriers:'))}
    canEdit={canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true })} />;
}
