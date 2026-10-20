import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyBillingCards, loadMyGoodsSubscriptions } from '@/lib/subscriptions/customer.server';
import { subscriptionAvailability } from '@/lib/subscriptions/runtime.server';
import { SubscriptionList } from '@/components/screens/subscriptions/SubscriptionList';
import { isUuid } from '@/lib/uuid';
export const metadata: Metadata = { title: '정기구매 — ICONS', robots: { index: false, follow: false } };
export const maxDuration = 90;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await getCurrentAuthState(); if (!auth.user) redirect('/login?next=%2Fmy%2Fsubscriptions');
  const query = await searchParams, actorId = auth.user.id;
  const [plans, cards, availability] = await Promise.allSettled([loadMyGoodsSubscriptions(actorId, typeof query.beforeAt === 'string' && Number.isFinite(Date.parse(query.beforeAt)) && isUuid(query.beforeId) ? { updatedAt: query.beforeAt, id: query.beforeId as string } : undefined), loadMyBillingCards(actorId), subscriptionAvailability(actorId)]);
  return <SubscriptionList actorId={actorId} plans={plans.status === 'fulfilled' ? plans.value.rows : []} cards={cards.status === 'fulfilled' ? cards.value : []}
    total={plans.status === 'fulfilled' ? plans.value.total : 0} nextCursor={plans.status === 'fulfilled' ? plans.value.nextCursor : null} older={typeof query.beforeAt === 'string'}
    canEnroll={availability.status === 'fulfilled' && availability.value.canEnroll} unavailable={plans.status === 'rejected' || cards.status === 'rejected'}
    registrationId={isUuid(query.registration) ? query.registration as string : undefined} />;
}
