import { OperationsSettingsScreen } from '@/components/admin/screens/OperationsSettingsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { OPERATIONS_SETTINGS_PATH } from '@/lib/admin/operations-contacts';
import { loadAdminOperationsContacts } from '@/lib/admin/operations-contacts.server';
import { loadAdminShippingRegionExpiry } from '@/lib/admin/shipping-regions.server';

export default async function Page() {
  const auth = await requireAdminScreenAccess(OPERATIONS_SETTINGS_PATH);
  const [data, shippingRegionExpiry] = await Promise.all([loadAdminOperationsContacts(), loadAdminShippingRegionExpiry()]);
  return <OperationsSettingsScreen {...data} shippingRegionExpiry={shippingRegionExpiry} canEdit={auth.role === 'admin'}/>;
}
