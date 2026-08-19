import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Inquiries } from '@/components/screens/Inquiries';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyInquiries } from '@/lib/inquiries.server';

export const metadata: Metadata = {
  title: '1:1 문의 — ICONS',
  description: '운영자에게 보낸 문의와 답변을 확인하세요.',
  robots: { index: false, follow: false },
};

/* 문의는 개인 기록이라 공개 브라우징 대상이 아니다. 진입 자체에 로그인이 필요하다. */
export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/my/inquiries')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/my/inquiries'));

  const inquiries = await loadMyInquiries(auth.user.id);

  return <Inquiries inquiries={inquiries} />;
}
