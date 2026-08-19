import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { InquiryComposer } from '@/components/screens/InquiryComposer';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isInquiryCategory, type InquiryCategory } from '@/lib/inquiries';
import { resolveInquiryLinkTargets } from '@/lib/inquiries.server';

export const metadata: Metadata = {
  title: '문의하기 — ICONS',
  description: '주문·배송, 취소/반품/교환, 상품, 계정에 대해 운영자에게 문의하세요.',
  robots: { index: false, follow: false },
};

function singleParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/my/inquiries/new')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/my/inquiries/new'));

  const query = await searchParams;
  const rawCategory = singleParam(query.category);
  /* 진입점이 실어 보낸 유형만 신뢰한다. 모르는 값은 기타가 아니라 주문/배송으로
     떨어뜨리지 않고 첫 항목으로 두면 사용자가 유형을 고른 것처럼 보인다. */
  const defaultCategory: InquiryCategory = isInquiryCategory(rawCategory) ? rawCategory : 'order';

  const link = await resolveInquiryLinkTargets(auth.user.id, {
    goodId: singleParam(query.goodId) || null,
    orderId: singleParam(query.orderId) || null,
  });

  return <InquiryComposer defaultCategory={defaultCategory} link={link} />;
}
