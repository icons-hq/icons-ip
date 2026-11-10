import { OperatorDirectoryScreen } from '@/components/admin/screens/OperatorDirectoryScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeOperatorFilters } from '@/lib/admin/operator-directory';
import { loadOperatorDirectory } from '@/lib/admin/operator-directory.server';
import { loadOperatorInvitations, normalizeInvitationListFilters } from '@/lib/admin/operator-invitations.server';

export default async function AdminCommunityRolesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const auth = await requireAdminScreenAccess('/admin/community/roles', { adminOnly: true, capability: 'operators.manage' });

  const params = await searchParams ?? {};
  const data = await loadOperatorDirectory(normalizeOperatorFilters(params));
  const invitations = data.mode === 'configured' ? await loadOperatorInvitations(normalizeInvitationListFilters(params)) : undefined;

  return <OperatorDirectoryScreen adminId={auth.user.id} data={data} invitations={invitations} />;
}
