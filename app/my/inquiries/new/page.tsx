import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { InquiryComposer } from '@/components/screens/InquiryComposer';
import { isAccountSuspended, isOnboarded, nextPathWithSearch, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isInquiryCategory, isRestrictedMemberInquiryCategory, RESTRICTED_MEMBER_INQUIRY_CATEGORY, type InquiryCategory } from '@/lib/inquiries';
import { resolveInquiryLinkTargets } from '@/lib/inquiries.server';

export const metadata: Metadata = {
  title: '문의하기 — 엑스스퀘어',
  description: '주문·배송, 취소/반품/교환, 상품, 계정에 대해 운영자에게 문의하세요.',
  robots: { index: false, follow: false },
};

function singleParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

const NO_LINK = { orderId: null, orderLabel: null, goodId: null, goodName: null };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const rawCategory = singleParam(query.category);
  /* 로그인·온보딩을 거쳐 돌아올 때 진입점이 실은 유형·연결 대상을 잃지 않게 그대로 싣는다. */
  const forwarded = new URLSearchParams();
  for (const key of ['category', 'orderId', 'goodId']) {
    const value = singleParam(query[key]);
    if (value) forwarded.set(key, value);
  }
  const next = nextPathWithSearch('/my/inquiries/new', forwarded);

  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  /* 정지 회원·온보딩 미완료 회원은 계정 문의(탈퇴 요청 등)만 쓴다(원장 CUS-035). 정지 회원은 어느 진입점이든 계정 문의로 고정하고,
     온보딩 미완료 회원은 계정 문의로 들어왔을 때만 바로 쓴다 — 다른 유형은 지금처럼 온보딩부터 마친다. */
  const suspended = isAccountSuspended(auth.profile);
  const onboarded = isOnboarded(auth.profile, auth.user.email);
  if (suspended || !onboarded) {
    if (!suspended && !isRestrictedMemberInquiryCategory(rawCategory)) redirect(onboardingPath(next));
    return <InquiryComposer defaultCategory={RESTRICTED_MEMBER_INQUIRY_CATEGORY} link={NO_LINK} restricted />;
  }

  /* 진입점이 실어 보낸 유형만 신뢰한다. 모르는 값은 기타가 아니라 주문/배송으로
     떨어뜨리지 않고 첫 항목으로 두면 사용자가 유형을 고른 것처럼 보인다. */
  const defaultCategory: InquiryCategory = isInquiryCategory(rawCategory) ? rawCategory : 'order';

  const link = await resolveInquiryLinkTargets(auth.user.id, {
    goodId: singleParam(query.goodId) || null,
    orderId: singleParam(query.orderId) || null,
  });

  return <InquiryComposer defaultCategory={defaultCategory} link={link} />;
}
