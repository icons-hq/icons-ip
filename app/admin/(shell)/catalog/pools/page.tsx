import { randomUUID } from 'node:crypto';
import { CardPoolScreen } from '@/components/admin/screens/CardPoolScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminCatalogPoolsPage() {
  await requireAdminScreenAccess('/admin/catalog/pools');

  const records = await getAdminCatalogRecords({ include: ['cardPools', 'cards', 'ips'] });

  return (
    <CardPoolScreen
      cards={records.cards}
      draftActiveFrom={new Date().toISOString()}
      draftId={randomUUID()}
      ips={records.ips}
      oddsOperationId={randomUUID()}
      operationId={randomUUID()}
      records={records.cardPools}
    />
  );
}
