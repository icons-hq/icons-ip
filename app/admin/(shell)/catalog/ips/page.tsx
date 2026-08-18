import { IpScreen } from '@/components/admin/screens/IpScreen';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getCatalogSnapshot } from '@/lib/catalog';

export default async function AdminCatalogIpsPage() {
  await requireAdminScreenAccess('/admin/catalog/ips');

  const [records, catalog] = await Promise.all([
    getAdminCatalogRecords({ include: ['ips'] }),
    getCatalogSnapshot({ previewDefaultSource: 'supabase' }),
  ]);

  return <IpScreen records={records.ips} verticals={catalog.verticals} />;
}
