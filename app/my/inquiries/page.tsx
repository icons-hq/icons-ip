import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Inquiries } from '@/components/screens/Inquiries';
import { isAccountSuspended, isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isRestrictedMemberInquiryCategory } from '@/lib/inquiries';
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
  const onboarded = isOnboarded(auth.profile, auth.user.email);
  const suspended = isAccountSuspended(auth.profile);

  const inquiries = await loadMyInquiries(auth.user.id);
  /* 정지·온보딩 미완료 회원은 자기 계정 문의(탈퇴 요청 등)만 본다(원장 CUS-035). 정지 회원은 계정 문의가 없어도 빈 목록에서
     계정 문의를 새로 쓸 수 있고, 온보딩 미완료 회원은 계정 문의가 없으면 지금처럼 온보딩부터 마친다. */
  if (suspended || !onboarded) {
    const accountInquiries = inquiries.filter((inquiry) => isRestrictedMemberInquiryCategory(inquiry.category));
    if (!suspended && !accountInquiries.length) redirect(onboardingPath('/my/inquiries'));
    return <Inquiries inquiries={accountInquiries} />;
  }

  return <Inquiries inquiries={inquiries} />;
}
