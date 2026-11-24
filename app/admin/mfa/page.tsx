import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AdminMfaGate } from '@/components/admin/mfa/AdminMfaGate';
import { ADMIN_MFA_PATH, safeAdminNextPath } from '@/lib/admin/mfa';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';

export const metadata: Metadata = {
  title: '2단계 인증 — 엑스스퀘어 어드민',
  robots: { index: false, follow: false },
};

/*
 * 운영자 2단계 인증 화면(OPS-006). 셸 밖의 전체 화면이라 `(shell)` 게이트 규칙 대상이 아니다 — 대신 여기서 직접 판정한다:
 * 미로그인은 로그인으로, 인증이 필요 없는(이미 aal2이거나 스위치가 꺼진) 운영자는 원래 화면으로, 운영자가 아니면 404.
 */
export default async function AdminMfaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const next = safeAdminNextPath(typeof query.next === 'string' ? query.next : null);
  const auth = await getCurrentAdminAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent(`${ADMIN_MFA_PATH}?next=${encodeURIComponent(next)}`)}`);
  }
  if (!auth.mfaPending) {
    if (auth.isStaff) redirect(next);
    notFound();
  }

  return <AdminMfaGate email={auth.user.email} next={next} />;
}
