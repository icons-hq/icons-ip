import { randomUUID } from 'node:crypto';
import { CardPoolScreen } from '@/components/admin/screens/CardPoolScreen';
import { getAdminCardsByPools, getAdminIpOptionsWith } from '@/lib/admin/catalog-list.server';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/*
 * 카드풀 화면 (규모 후속). 전에는 카드·IP **전량**을 읽어 화면에서 풀로 걸렀다 — 1,000행에서
 * 말없이 잘리는 자리다. 이제 로스터는 **화면에 오른 풀의 카드**만, IP 는 상위 N + 풀이 참조하는
 * 것만 읽는다. 카드풀 자체는 운영 표라 작다.
 */
export default async function AdminCatalogPoolsPage() {
  await requireAdminScreenAccess('/admin/catalog/pools');

  const records = await getAdminCatalogRecords({ include: ['cardPools'] });
  const [cards, ipOptions] = await Promise.all([
    getAdminCardsByPools(records.cardPools.map((pool) => pool.id)),
    getAdminIpOptionsWith(records.cardPools.map((pool) => pool.ipId)),
  ]);

  return (
    <CardPoolScreen
      cards={cards}
      draftActiveFrom={new Date().toISOString()}
      draftId={randomUUID()}
      ipOptions={ipOptions}
      oddsOperationId={randomUUID()}
      operationId={randomUUID()}
      records={records.cardPools}
    />
  );
}
