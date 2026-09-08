import { StoreSettingsScreen } from '@/components/admin/screens/StoreSettingsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { CARRIER_SETTINGS_PATH } from '@/lib/admin/store-settings';
import { loadAdminStoreSettings } from '@/lib/admin/store-settings.server';
export default async function Page() {
  const auth=await requireAdminScreenAccess(CARRIER_SETTINGS_PATH);
  const data=await loadAdminStoreSettings();
  return <StoreSettingsScreen {...data} canEdit={auth.role==='admin'} section="business" carrierMode/>;
}
