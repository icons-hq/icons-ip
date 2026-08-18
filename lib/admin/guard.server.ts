import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { getCurrentAdminAuthState, type CurrentAdminAuthState } from '@/lib/auth/admin';

/*
 * 어드민 화면 권한 게이트.
 *
 * layout에도 같은 게이트가 있지만 각 page가 자기 몫으로 한 번 더 부른다.
 * Next.js는 layout과 page를 병렬로 렌더하므로 layout의 redirect가 page의
 * 데이터 로딩을 막지 못한다 — 비스태프가 로더를 실행시키는 창이 생긴다.
 * 여기서 pathname을 받는 이유는 로그인 후 원래 화면으로 돌려보내기 위해서다.
 */
export async function requireAdminScreenAccess(
  pathname: string,
  options: { adminOnly?: boolean } = {},
): Promise<CurrentAdminAuthState & { user: NonNullable<CurrentAdminAuthState['user']> }> {
  const auth = await getCurrentAdminAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent(pathname)}`);
  }

  if (!auth.isStaff) {
    notFound();
  }

  if (options.adminOnly && auth.role !== 'admin') {
    notFound();
  }

  return auth as CurrentAdminAuthState & { user: NonNullable<CurrentAdminAuthState['user']> };
}
