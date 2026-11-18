import { MembersSection } from '@/components/admin/sections/Members';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminMemberSummaries } from '@/lib/admin/members.server';
import { notePiiAccess } from '@/lib/admin/pii-access-log.server';

export default async function AdminCommunityMembersPage() {
  const auth = await requireAdminScreenAccess('/admin/community/members');

  const members = await getAdminMemberSummaries('');
  /* 처음 열 때 보이는 최근 회원 목록(닉네임·가린 이메일)도 회원 검색과 같은 접속기록을 남긴다(실패해도 연다). */
  await notePiiAccess({ actorId: auth.user.id, action: 'search', surface: 'member.search', path: '/admin/community/members', subjectKind: 'member',
    subjectIds: members.map((member) => member.id), subjectCount: members.length, detail: { queried: false } });

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
