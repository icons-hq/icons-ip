import { ShippingCarriersScreen } from '@/components/admin/screens/StoreSettingsScreen';
import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';
import { loadCarrierUsesView } from '@/lib/admin/carrier-origin-uses.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { CARRIER_SETTINGS_PATH } from '@/lib/admin/store-settings';
import { loadAdminShippingCarriers, loadAdminStoreSettingsHistory } from '@/lib/admin/store-settings.server';
export default async function Page() {
  const auth = await requireAdminScreenAccess(CARRIER_SETTINGS_PATH);
  const canEdit = canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true });
  /* 택배사를 기본으로 쓰는 출고지는 끌 수 있는지 정하려고 읽는다 — 저장할 수 있는 사람에게만 읽고, 못 읽으면 null로 넘겨 화면이 끄지 못하게 한다. */
  const [carriers, history, uses] = await Promise.all([
    loadAdminShippingCarriers(),
    hasAdminCapability(auth, 'platform.manage') ? loadAdminStoreSettingsHistory() : Promise.resolve([]),
    canEdit ? loadCarrierUsesView() : Promise.resolve(undefined),
  ]);
  return <ShippingCarriersScreen carriers={carriers} history={history.filter(entry => entry.target.startsWith('shipping_carriers:'))} canEdit={canEdit} uses={uses} />;
}
