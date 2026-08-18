import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminOpenInquiryBadge } from '@/components/admin/AdminOpenInquiryBadge';
import { AdminShell } from '@/components/admin/AdminShell';
import { getAdminOpenInquiryCount } from '@/lib/admin/inquiries.server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';

export const metadata = {
  robots: { index: false, follow: false },
};

/*
 * 어드민 셸 레이아웃.
 *
 * `/admin/check-in`은 이 route group 밖에 있어 사이드바 없이 전체화면으로 뜬다 —
 * 현장 검표는 태블릿을 들고 쓰는 화면이라 셸이 방해가 된다.
 *
 * 권한의 진실원은 각 page의 `requireAdminScreenAccess`다. layout은 pathname을
 * 모르기 때문에 미인증 리다이렉트를 여기서 하면 로그인 next가 항상 /admin으로
 * 굳는다 — 딥링크로 들어온 운영자가 로그인 후 원래 화면을 잃는다. 그래서
 * 미인증은 page에 맡기고, layout은 "로그인은 했지만 스태프가 아닌" 경우만
 * 셸 자체를 숨긴다. page 게이트 누락은 `shell-route-guards.test.ts`가 막는다.
 */
export default async function AdminShellLayout({ children }: { children: ReactNode }) {
  const auth = await getCurrentAdminAuthState();

  if (auth.user && !auth.isStaff) {
    notFound();
  }

  /* 배지는 staff에게만 센다. 미인증 요청까지 집계를 부르면 반드시 실패할 RPC를
     모든 어드민 진입에서 한 번씩 때리게 된다. 집계 실패는 0으로 접히므로
     배지 하나 때문에 어드민 전체가 넘어지지는 않는다. */
  const openInquiryCount = auth.isStaff ? await getAdminOpenInquiryCount() : 0;

  return (
    <AdminShell
      admin={{ id: auth.user?.id ?? '', email: auth.user?.email ?? null, role: auth.role ?? 'staff' }}
      badges={<AdminOpenInquiryBadge count={openInquiryCount} />}
    >
      {children}
    </AdminShell>
  );
}
