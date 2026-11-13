import { IpScreen } from '@/components/admin/screens/IpScreen';
import Link from 'next/link';
import { IpIndexScreen } from '@/components/admin/screens/IpIndexScreen';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
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
    return <section className="flex min-w-0 flex-col gap-6">
      <AdminPageHeader title="IP 등록" description="IP 이름·공개 URL·IP 분류를 채운 뒤 초안으로 저장하거나 바로 공개합니다. 내부 ID는 처음 저장할 때 자동으로 발급됩니다." actions={<Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={IP_INDEX_PATH}>IP 목록</Link>} />
      <IpScreen accountId={auth.user.id} records={[]} verticals={catalog.verticals} hideRecordList />
    </section>;
  }
  /* 미사용 초안을 지운 뒤 돌아온 목록(ip-delete-actions)은 지운 내부 ID를 한 번 알린다. */
  const deleted = typeof params.deleted === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(params.deleted) ? params.deleted : null;
  return <IpIndexScreen data={await loadAdminIpIndex(normalizeIpIndexFilters(params))} deletedId={deleted} />;
}
