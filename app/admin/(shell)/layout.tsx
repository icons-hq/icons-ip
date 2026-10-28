import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';

export const metadata = {
  robots: { index: false, follow: false },
};

/*
 * 어드민 셸 레이아웃 — 커머스 콘솔. IP·콘텐츠 운영 화면은 `(content)` route group의
 * 별도 콘솔 레이아웃이 그린다(D9, A14). 상단의 콘솔 전환으로 오간다.
 *
 * `/admin/check-in`은 이 route group 밖에 있어 사이드바 없이 전체화면으로 뜬다 —
 * 현장 검표는 태블릿을 들고 쓰는 화면이라 셸이 방해가 된다.
 *
 * 권한의 진실원은 각 page의 `requireAdminScreenAccess`다. layout은 pathname을
 * 모르기 때문에 미인증 리다이렉트를 여기서 하면 로그인 next가 항상 /admin으로
 * 굳는다 — 딥링크로 들어온 운영자가 로그인 후 원래 화면을 잃는다. 그래서
 * 미인증은 page에 맡기고, layout은 "로그인은 했지만 스태프가 아닌" 경우만
 * 셸 자체를 숨긴다. page 게이트 누락은 `shell-route-guards.test.ts`가 막는다.
 *
 * 미답변 1:1 문의 배지는 셸 공통이 아니다(10/27 회의 D1①). 고객문의 목록·상세
 * 페이지가 자기 집계로 그린다 — layout은 소프트 이동 때 다시 렌더되지 않아 여기서
 * 센 수는 금방 낡고, 상품 등록·주문 화면에는 보이지 않아야 한다.
 */
export default async function AdminShellLayout({ children }: { children: ReactNode }) {
  const auth = await getCurrentAdminAuthState();

  if (auth.user && !auth.isStaff) {
    notFound();
  }

  return (
    <AdminShell
      console="commerce"
      admin={{ id: auth.user?.id ?? '', email: auth.user?.email ?? null, role: auth.role ?? 'staff', operatorAccess: auth.operatorAccess }}
    >
      {children}
    </AdminShell>
  );
}
