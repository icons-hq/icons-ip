import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyReviews } from '@/components/screens/MyReviews';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyReviewTargets } from '@/lib/reviews.server';

export const metadata: Metadata = {
  title: '내 리뷰 — ICONS',
  description: '배송이 완료된 굿즈에 남길 수 있는 리뷰와 이미 작성한 리뷰를 관리하세요.',
  robots: { index: false, follow: false },
};

/* 리뷰 읽기는 공개지만 "내 리뷰"는 내 주문 목록이다 — 진입 자체에 로그인이 필요하다. */
export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/my/reviews')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/my/reviews'));

  const targets = await loadMyReviewTargets();

  return <MyReviews targets={targets} />;
}
