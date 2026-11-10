import { EventScreen } from '@/components/admin/screens/EventScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminCatalogEventsPage() {
  await requireAdminScreenAccess('/admin/catalog/events');

  const records = await getAdminCatalogRecords({ include: ['events', 'ips'] });

  return <EventScreen ips={records.ips} records={records.events} />;
}
