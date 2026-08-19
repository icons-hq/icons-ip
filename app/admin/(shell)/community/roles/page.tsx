import { RolesSection } from '@/components/admin/sections/Roles';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminProfileRecords } from '@/lib/admin/roles.server';

export default async function AdminCommunityRolesPage() {
  /*
   * 역할 관리는 admin 전용이다. 예전에는 Admin.tsx가 `admin.role === 'admin'`일
   * 때만 렌더해서 감췄지만, 라우트가 생긴 이상 staff가 URL로 바로 들어올 수
   * 있다 — 프로필 목록을 읽기 전에 여기서 막는다.
   */
  const auth = await requireAdminScreenAccess('/admin/community/roles', { adminOnly: true });

  const profiles = await getAdminProfileRecords();

  return <RolesSection adminId={auth.user.id} profiles={profiles} />;
}
