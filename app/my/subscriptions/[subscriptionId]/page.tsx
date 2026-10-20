import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { isUuid } from '@/lib/uuid';
import { loadMyBillingCards, loadMyGoodsSubscription, loadMySubscriptionCycles } from '@/lib/subscriptions/customer.server';
import { subscriptionAvailability } from '@/lib/subscriptions/runtime.server';
import { SubscriptionDetail } from '@/components/screens/subscriptions/SubscriptionDetail';
export const metadata: Metadata = { title: '정기배송 상세 — ICONS', robots: { index: false, follow: false } };
export const maxDuration = 90;
export default async function Page({ params, searchParams }: { params: Promise<{ subscriptionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { subscriptionId } = await params; if (!isUuid(subscriptionId)) notFound();
  const auth = await getCurrentAuthState(); if (!auth.user) redirect(`/login?next=${encodeURIComponent(`/my/subscriptions/${subscriptionId}`)}`);
  const query = await searchParams, beforeNumber = typeof query.before === 'string' && /^[1-9][0-9]{0,8}$/.test(query.before) ? Number(query.before) : undefined;
  const actorId = auth.user.id, plan = await loadMyGoodsSubscription(actorId, subscriptionId).catch(() => null); if (!plan) notFound();
  const [cards, availability, catalog, cycles] = await Promise.all([loadMyBillingCards(actorId).catch(() => []), subscriptionAvailability(actorId).catch(() => null), getCatalogSnapshot(), loadMySubscriptionCycles(actorId, subscriptionId, beforeNumber)]);
  return <SubscriptionDetail key={`${plan.id}:${plan.revision}:${beforeNumber ?? 0}`} actorId={actorId} initialPlan={plan} history={cycles} older={beforeNumber !== undefined} cards={cards} canRegister={Boolean(availability?.canEnroll)}
    names={Object.fromEntries(catalog.goods.map(good => [good.id, good.name]))} />;
}
