import { IpScreen } from '@/components/admin/screens/IpScreen';
import Link from 'next/link';
import { IpIndexScreen } from '@/components/admin/screens/IpIndexScreen';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { loadAdminIpIndex } from '@/lib/admin/ip-workspace.server';
import { IP_INDEX_PATH, normalizeIpIndexFilters } from '@/lib/admin/ip-workspace';

export default async function AdminCatalogIpsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAdminScreenAccess(IP_INDEX_PATH);
  const params = await searchParams;
  if (params.create === '1') {
    const catalog = await getCatalogSnapshot({ previewDefaultSource: 'supabase' });
    return <section className="wc-admin-kit">
      <AdminPageHeader title="IP 등록" actions={<Link href={IP_INDEX_PATH}>IP 목록</Link>} />
      <IpScreen accountId={auth.user.id} records={[]} verticals={catalog.verticals} hideRecordList />
    </section>;
  }
  return <IpIndexScreen data={await loadAdminIpIndex(normalizeIpIndexFilters(params))} />;
}
