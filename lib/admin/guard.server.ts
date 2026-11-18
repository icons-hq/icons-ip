import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { getCurrentAdminAuthState, type CurrentAdminAuthState } from '@/lib/auth/admin';
import { canAccessAdminScreen, type AdminCapability } from './access';
import { adminMfaPath } from './mfa';
import { adminScreenForPath } from './navigation';

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
  options: { adminOnly?: boolean; capability?: AdminCapability } = {},
): Promise<CurrentAdminAuthState & { user: NonNullable<CurrentAdminAuthState['user']> }> {
  const auth = await getCurrentAdminAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent(pathname)}`);
  }

  /* 운영자 2단계 인증 스위치가 켜졌는데 세션이 aal2가 아니면 화면 대신 인증 화면으로 보낸다(OPS-006). 인증 뒤 이 화면으로 돌아온다. */
  if (auth.mfaPending) {
    redirect(adminMfaPath(pathname));
  }

  if (!auth.isStaff) {
    notFound();
  }

  if (!canAccessAdminScreen(auth, adminScreenForPath(pathname), options)) {
    notFound();
  }

  return auth as CurrentAdminAuthState & { user: NonNullable<CurrentAdminAuthState['user']> };
}
