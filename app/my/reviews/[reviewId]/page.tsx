import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ReviewComposer } from '@/components/screens/ReviewComposer';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyReviewTargets } from '@/lib/reviews.server';

export const metadata: Metadata = {
  title: '리뷰 수정 — ICONS',
  description: '작성한 리뷰의 별점, 내용, 사진을 수정하세요.',
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  const next = `/my/reviews/${reviewId}`;

  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  /*
   * 리뷰 id로 바로 읽지 않고 내 리뷰 대상 목록에서 찾는다. 수정 폼은 별점·본문뿐
   * 아니라 기한(배송완료 시각)까지 알아야 하는데, 그 값은 리뷰가 아니라 주문에 있다.
   * 목록 RPC 하나가 둘을 함께 돌려주므로 왕복도 한 번이다.
   */
  const targets = await loadMyReviewTargets();
  const target = targets.find((entry) => entry.review?.id === reviewId);
  if (!target) notFound();

  return <ReviewComposer mode="edit" target={target} />;
}
