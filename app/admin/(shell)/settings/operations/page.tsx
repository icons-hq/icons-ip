import { OperationsSettingsScreen } from '@/components/admin/screens/OperationsSettingsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { OPERATIONS_SETTINGS_PATH } from '@/lib/admin/operations-contacts';
import { loadAdminOperationsContacts } from '@/lib/admin/operations-contacts.server';

export default async function Page() {
  const auth = await requireAdminScreenAccess(OPERATIONS_SETTINGS_PATH);
  const data = await loadAdminOperationsContacts();
  return <OperationsSettingsScreen {...data} canEdit={auth.role === 'admin'}/>;
}
