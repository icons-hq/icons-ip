import { CardScreen } from '@/components/admin/screens/CardScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/*
 * `?cardId=`는 카드풀 화면의 "카드 편집" 링크가 넘겨주는 딥링크다.
 * 라우트가 갈라지기 전에는 부모 상태를 바꿔 섹션을 전환했다.
 */
export default async function AdminCatalogCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdminScreenAccess('/admin/catalog/cards');

  const query = await searchParams;
  const records = await getAdminCatalogRecords({ include: ['cards', 'ips', 'cardPools'] });
  const cardId = typeof query.cardId === 'string' ? query.cardId : null;

  return (
    <CardScreen
      initialSelectedId={cardId}
      ips={records.ips}
      pools={records.cardPools}
      records={records.cards}
    />
  );
}
