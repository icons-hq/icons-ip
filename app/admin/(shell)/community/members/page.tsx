import { MembersSection } from '@/components/admin/sections/Members';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminMemberSummaries } from '@/lib/admin/members.server';

export default async function AdminCommunityMembersPage() {
  const auth = await requireAdminScreenAccess('/admin/community/members');

  const members = await getAdminMemberSummaries('');

  /*
   * key로 검색·정지 상태를 담은 useActionState를 갈아끼운다. 정지/해제 후
   * revalidate가 새 목록을 내려도 key가 그대로면 화면은 옛 상태를 계속 쓴다.
   */
  return (
    <MembersSection
      actor={{ id: auth.user.id, role: auth.role ?? 'staff' }}
      initialMembers={members}
      key={JSON.stringify(members.map((member) => [member.id, member.role, member.suspendedAt]))}
    />
  );
}
