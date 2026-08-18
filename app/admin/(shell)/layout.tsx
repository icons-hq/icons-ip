import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export const metadata = {
  robots: { index: false, follow: false },
};

/*
 * 어드민 셸 레이아웃.
 *
 * `/admin/check-in`은 이 route group 밖에 있어 사이드바 없이 전체화면으로 뜬다 —
 * 현장 검표는 태블릿을 들고 쓰는 화면이라 셸이 방해가 된다.
 *
 * 여기 게이트는 1차 방어선이다. Next.js가 layout과 page를 병렬로 렌더하므로
 * 각 page도 requireAdminScreenAccess를 자기 몫으로 부른다.
 */
export default async function AdminShellLayout({ children }: { children: ReactNode }) {
  const auth = await requireAdminScreenAccess('/admin');

  return (
    <AdminShell
      admin={{ id: auth.user.id, email: auth.user.email, role: auth.role ?? 'staff' }}
    >
      {children}
    </AdminShell>
  );
}
