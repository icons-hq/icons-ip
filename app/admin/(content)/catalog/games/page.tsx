import { randomUUID } from 'node:crypto';
import { GameScreen } from '@/components/admin/screens/GameScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminCatalogGamesPage() {
  await requireAdminScreenAccess('/admin/catalog/games');

  const records = await getAdminCatalogRecords({ include: ['games', 'events', 'cardPools'] });

  return (
    <GameScreen
      endOperationId={randomUUID()}
      events={records.events}
      operationId={randomUUID()}
      pools={records.cardPools}
      records={records.games}
    />
  );
}
