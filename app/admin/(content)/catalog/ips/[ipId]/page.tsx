import { notFound } from 'next/navigation';
import { IpScreen } from '@/components/admin/screens/IpScreen';
import { IpWorkspaceScreen } from '@/components/admin/screens/IpWorkspaceScreen';
import { canAccessAdminScreen } from '@/lib/admin/access';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ipWorkspaceHref, normalizeIpWorkspaceTab } from '@/lib/admin/ip-workspace';
import { loadAdminIpWorkspace } from '@/lib/admin/ip-workspace.server';

export default async function Page({ params, searchParams }: {
  params: Promise<{ ipId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ipId } = await params;
  const auth = await requireAdminScreenAccess(ipWorkspaceHref(ipId));
  const query = await searchParams;
  const tab = normalizeIpWorkspaceTab(query.tab);
  const data = await loadAdminIpWorkspace(ipId, tab);
  if (!data) notFound();
  /* 미사용 초안 삭제는 되돌릴 수 없어 legacy admin·platform.manage만 연다(DB가 다시 판정한다). */
  const canDeleteDraft = canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true });
  return <IpWorkspaceScreen created={query.created === '1'} data={data}>
    {tab === 'basic' ? <IpScreen key={ipId} accountId={auth.user.id} canDeleteDraft={canDeleteDraft} deletion={data.deletion ?? null}
      records={[data.ip]} verticals={data.verticals} selectedId={ipId} hideRecordList /> : null}
  </IpWorkspaceScreen>;
}
