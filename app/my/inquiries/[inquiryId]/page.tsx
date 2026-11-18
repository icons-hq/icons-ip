import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { InquiryThread } from '@/components/screens/InquiryThread';
import { ACCOUNT_SUSPENDED_PATH, isAccountSuspended, isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isRestrictedMemberInquiryCategory } from '@/lib/inquiries';
import { loadMyInquiryThread } from '@/lib/inquiries.server';
import { loadMyInquirySatisfaction } from '@/lib/inquiry-satisfaction.server';

export const metadata: Metadata = {
  title: '문의 상세 — ICONS',
  description: '문의 내용과 운영자 답변을 확인하세요.',
  robots: { index: false, follow: false },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function Page({ params }: PageProps<'/my/inquiries/[inquiryId]'>) {
  const { inquiryId: raw } = await params;
  const inquiryId = raw.toLowerCase();
  if (!UUID_PATTERN.test(inquiryId)) notFound();

  const next = `/my/inquiries/${inquiryId}`;
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const onboarded = isOnboarded(auth.profile, auth.user.email);

  const [inquiry, satisfaction] = await Promise.all([
    loadMyInquiryThread(auth.user.id, inquiryId), loadMyInquirySatisfaction(inquiryId),
  ]);
  /* 정지·온보딩 미완료 회원은 자기 계정 문의(탈퇴 요청 등)만 본다(원장 CUS-035). 로그인은 이 경로를 정지·온보딩 게이트 없이
     돌려보내므로(답변 알림 메일 링크) 유형 판정은 여기서 한다 — 다른 문의는 정지 화면·온보딩으로 보낸다. */
  const suspended = isAccountSuspended(auth.profile);
  const restricted = suspended || !onboarded;
  if (restricted && !isRestrictedMemberInquiryCategory(inquiry?.category)) {
    redirect(suspended ? ACCOUNT_SUSPENDED_PATH : onboardingPath(next));
  }
  if (!inquiry) notFound();

  return <InquiryThread inquiry={inquiry} restricted={restricted} satisfaction={satisfaction} />;
}
