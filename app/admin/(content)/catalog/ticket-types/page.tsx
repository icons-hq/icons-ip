import { randomUUID } from 'node:crypto';
import { TicketTypeScreen } from '@/components/admin/screens/TicketTypeScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminCatalogTicketTypesPage() {
  await requireAdminScreenAccess('/admin/catalog/ticket-types');

  const records = await getAdminCatalogRecords({ include: ['ticketTypes', 'events'] });

  return (
    <TicketTypeScreen
      draftId={randomUUID()}
      events={records.events}
      operationId={randomUUID()}
      records={records.ticketTypes}
    />
  );
}
