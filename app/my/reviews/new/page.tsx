import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ReviewComposer } from '@/components/screens/ReviewComposer';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyReviewTargets } from '@/lib/reviews.server';

export const metadata: Metadata = {
  title: '리뷰 쓰기 — ICONS',
  description: '배송이 완료된 굿즈에 별점과 후기를 남기세요.',
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
  const query = await searchParams;
  const orderId = singleParam(query.orderId);
  const goodId = singleParam(query.goodId);
  const next = `/my/reviews/new?orderId=${encodeURIComponent(orderId)}&goodId=${encodeURIComponent(goodId)}`;

  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  /*
   * 자격은 화면이 아니라 RPC가 판정한다. 대상 자체가 없으면(남의 주문, 배송 전,
   * 그 주문에 없는 굿즈) 목록이 비어 돌아온다 — 그때는 404다. "없는 것"과
   * "쓸 수 없는 것"은 다르고, 후자는 폼 화면이 이유를 설명한다.
   */
  const [target] = await loadMyReviewTargets({ goodId, orderId });
  if (!target) notFound();

  return <ReviewComposer mode="create" target={target} />;
}
