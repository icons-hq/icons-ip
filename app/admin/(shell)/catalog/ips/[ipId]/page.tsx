import { notFound } from 'next/navigation';
import { IpScreen } from '@/components/admin/screens/IpScreen';
import { IpWorkspaceScreen } from '@/components/admin/screens/IpWorkspaceScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ipWorkspaceHref, normalizeIpWorkspaceTab } from '@/lib/admin/ip-workspace';
import { loadAdminIpWorkspace } from '@/lib/admin/ip-workspace.server';

export default async function Page({ params, searchParams }: {
  params: Promise<{ ipId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ipId } = await params;
  const auth = await requireAdminScreenAccess(ipWorkspaceHref(ipId));
  const tab = normalizeIpWorkspaceTab((await searchParams).tab);
  const data = await loadAdminIpWorkspace(ipId, tab);
  if (!data) notFound();
  return <IpWorkspaceScreen data={data}>
    {tab === 'basic' ? <IpScreen key={ipId} accountId={auth.user.id} records={[data.ip]} verticals={data.verticals} selectedId={ipId} hideRecordList /> : null}
  </IpWorkspaceScreen>;
}
