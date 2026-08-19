import { randomUUID } from 'node:crypto';
import { GoodScreen } from '@/components/admin/screens/GoodScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getCatalogSnapshot } from '@/lib/catalog';

export default async function AdminCatalogGoodsPage() {
  await requireAdminScreenAccess('/admin/catalog/goods');

  const [records, catalog] = await Promise.all([
    getAdminCatalogRecords({ include: ['goods', 'ips'] }),
    getCatalogSnapshot({ previewDefaultSource: 'supabase' }),
  ]);

  return (
    <GoodScreen
      adjustmentId={randomUUID()}
      catalogIps={catalog.ips}
      ips={records.ips}
      records={records.goods}
    />
  );
}
