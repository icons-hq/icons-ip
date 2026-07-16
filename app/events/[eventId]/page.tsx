import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventDetail } from '@/components/screens/EventDetail';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot, getCatalogSource } from '@/lib/catalog';
import { getIpFollowState } from '@/lib/ip-follow.server';
import { checkoutPaymentsEnabled } from '@/lib/payments/checkout-availability';
import { loadPublicTicketTypes } from '@/lib/ticketing.server';

export const metadata: Metadata = {
  title: '이벤트 상세 — ICONS',
  description: 'ICONS 이벤트 일정과 예매 가능한 회차를 확인하세요.',
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId } = await params;
  const catalogSource = getCatalogSource();
  const [catalog, auth, sessions] = await Promise.all([
    getCatalogSnapshot(),
    getCurrentAuthState(),
    catalogSource === 'supabase' ? loadPublicTicketTypes(eventId) : Promise.resolve([]),
  ]);
  const event = catalog.events.find((item) => item.id === eventId);
  if (!event) notFound();
  const ip = catalog.ips.find((item) => item.id === event.ip) ?? null;
  const [notificationState, query] = await Promise.all([
    event.status === '예정' && ip ? getIpFollowState(ip.id) : Promise.resolve(null),
    searchParams ?? Promise.resolve<Record<string, string | string[] | undefined>>({}),
  ]);

  const next = `/events/${encodeURIComponent(event.id)}`;
  const onboarded = Boolean(auth.user && isOnboarded(auth.profile, auth.user.email));
  const authState = !auth.user ? 'signed-out' : onboarded ? 'ready' : 'onboarding';
  const authHref = authState === 'signed-out'
    ? `/login?next=${encodeURIComponent(next)}`
    : onboardingPath(next);

  return (
    <EventDetail
      authHref={authHref}
      authState={authState}
      event={event}
      ip={ip}
      notificationError={firstParam(query.notification_error) === '1'}
      notificationSaved={firstParam(query.notification_saved) === '1'}
      notificationState={notificationState}
      paymentAvailable={checkoutPaymentsEnabled()}
      sessions={sessions}
    />
  );
}
