import { StoreSettingsScreen } from '@/components/admin/screens/StoreSettingsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { STORE_SETTINGS_PATH } from '@/lib/admin/store-settings';
import { loadAdminStoreSettings } from '@/lib/admin/store-settings.server';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const auth=await requireAdminScreenAccess(STORE_SETTINGS_PATH);
  const [query,data]=await Promise.all([searchParams,loadAdminStoreSettings()]);
  return <StoreSettingsScreen {...data} canEdit={auth.role==='admin'} section={query.section==='bank_transfer'?'bank_transfer':'business'}/>;
}
