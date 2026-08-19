import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { InquiryThread } from '@/components/screens/InquiryThread';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyInquiryThread } from '@/lib/inquiries.server';

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
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  const inquiry = await loadMyInquiryThread(auth.user.id, inquiryId);
  if (!inquiry) notFound();

  return <InquiryThread inquiry={inquiry} />;
}
