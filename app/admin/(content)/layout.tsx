import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { adminNavigationAccountId, parseAdminNavigationCookie } from '@/lib/admin/navigation-preferences';
import { readAdminShellCookies } from '@/lib/admin/sidebar-state.server';

export const metadata = {
  robots: { index: false, follow: false },
};

/*
 * 카드·게임 칸과 IP·이벤트·티켓 회차 화면의 레이아웃 묶음(1014-074·075).
 *
 * 칸(쇼핑·카드·게임)은 이 레이아웃이 아니라 경로가 정한다(`adminConsoleForPath`) — 셸이 사이드바 메뉴와 상단 전환을 거기서 고른다.
 * 그래서 이 route group은 `(shell)`과 같은 셸을 그린다. 파일 위치만 갈라 둔 이유는 카드·게임·IP 화면 소유가 커머스와 다르기 때문이다.
 *
 * 권한 규칙은 쇼핑 셸과 같다: 진실원은 각 page의 `requireAdminScreenAccess`이고
 * (`shell-route-guards.test.ts`가 두 그룹 모두 강제), layout은 로그인했지만 스태프가
 * 아닌 경우에만 셸 자체를 숨긴다.
 */
export default async function AdminContentLayout({ children }: { children: ReactNode }) {
  const auth = await getCurrentAdminAuthState();

  if (auth.user && !auth.isStaff) {
    notFound();
  }

  const admin = { id: auth.user?.id ?? '', email: auth.user?.email ?? null, role: auth.role ?? 'staff', operatorAccess: auth.operatorAccess };
  const shellCookies = await readAdminShellCookies(adminNavigationAccountId(admin));

  return (
    <AdminShell
      initialNavigation={parseAdminNavigationCookie(shellCookies.navigationCookie)}
      sidebarDefaultOpen={shellCookies.sidebarDefaultOpen}
      admin={admin}
    >
      {children}
    </AdminShell>
  );
}
