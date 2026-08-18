import { randomUUID } from 'node:crypto';
import { DrawTicketGrantScreen } from '@/components/admin/screens/DrawTicketGrantScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { getAdminDrawTicketGrants } from '@/lib/admin/draw-ticket-grants.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminCatalogGrantsPage() {
  await requireAdminScreenAccess('/admin/catalog/grants');

  const [records, grants] = await Promise.all([
    getAdminCatalogRecords({ include: ['cardPools'] }),
    getAdminDrawTicketGrants(),
  ]);

  return (
    <DrawTicketGrantScreen
      draftOperationId={randomUUID()}
      grants={grants}
      pools={records.cardPools}
    />
  );
}
