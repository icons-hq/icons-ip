import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventDetail } from '@/components/screens/EventDetail';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot, getCatalogSource } from '@/lib/catalog';
import { checkoutPaymentsEnabled } from '@/lib/payments/checkout-availability';
import { loadPublicTicketTypes } from '@/lib/ticketing.server';

export const metadata: Metadata = {
  title: '이벤트 상세 — ICONS',
  description: 'ICONS 이벤트 일정과 예매 가능한 회차를 확인하세요.',
};

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const catalogSource = getCatalogSource();
  const [catalog, auth, sessions] = await Promise.all([
    getCatalogSnapshot(),
    getCurrentAuthState(),
    catalogSource === 'supabase' ? loadPublicTicketTypes(eventId) : Promise.resolve([]),
  ]);
  const event = catalog.events.find((item) => item.id === eventId);
  if (!event) notFound();

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
      ip={catalog.ips.find((item) => item.id === event.ip) ?? null}
      paymentAvailable={checkoutPaymentsEnabled()}
      sessions={sessions}
    />
  );
}
