import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';

export const metadata = {
  robots: { index: false, follow: false },
};

/*
 * IP·콘텐츠 운영 콘솔 레이아웃(D9, A14).
 *
 * 카드·카드풀·뽑기권·게임·이벤트·티켓·IP·커뮤니티 운영 화면은 커머스(`(shell)`)와 분리된
 * 이 route group에 있다. URL은 그대로(route group은 경로에 영향이 없다)이며, 이 레이아웃은
 * 콘텐츠 메뉴만 가진 사이드바와 상단 콘솔 전환을 그린다.
 *
 * 권한 규칙은 커머스 셸과 같다: 진실원은 각 page의 `requireAdminScreenAccess`이고
 * (`shell-route-guards.test.ts`가 두 그룹 모두 강제), layout은 로그인했지만 스태프가
 * 아닌 경우에만 셸 자체를 숨긴다.
 */
export default async function AdminContentLayout({ children }: { children: ReactNode }) {
  const auth = await getCurrentAdminAuthState();

  if (auth.user && !auth.isStaff) {
    notFound();
  }

  return (
    <AdminShell
      console="content"
      admin={{ id: auth.user?.id ?? '', email: auth.user?.email ?? null, role: auth.role ?? 'staff', operatorAccess: auth.operatorAccess }}
    >
      {children}
    </AdminShell>
  );
}
