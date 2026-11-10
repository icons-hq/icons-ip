import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCatalogSnapshot } from '@/lib/catalog';
import { loadMyCoupons } from '@/lib/coupons.server';
import { loadSubscriptionOffers } from '@/lib/subscriptions/customer.server';
import { subscriptionAvailability } from '@/lib/subscriptions/runtime.server';
import { SubscriptionNew } from '@/components/screens/subscriptions/SubscriptionNew';
export const metadata: Metadata = { title: '정기배송 신청 — ICONS', robots: { index: false, follow: false } };
export const maxDuration = 90;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await getCurrentAuthState(); if (!auth.user) redirect('/login?next=%2Fmy%2Fsubscriptions%2Fnew');
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/my/subscriptions/new'));
  const query = await searchParams, [catalog, coupons, availability] = await Promise.all([getCatalogSnapshot(), loadMyCoupons(), subscriptionAvailability(auth.user.id).catch(() => null)]);
  const offers = availability?.canEnroll ? await loadSubscriptionOffers(catalog.goods.map(good => good.id)).catch(() => []) : [];
  return <SubscriptionNew actorId={auth.user.id} goods={catalog.goods} coupons={coupons} offers={offers} canEnroll={Boolean(availability?.canEnroll)}
    initialGoodId={typeof query.goodId === 'string' ? query.goodId : undefined} />;
}
