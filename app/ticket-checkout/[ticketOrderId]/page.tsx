import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TicketCheckout } from '@/components/screens/TicketCheckout';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { checkoutPaymentsEnabled } from '@/lib/payments/checkout-availability';
import { normalizeTicketReference } from '@/lib/ticketing';
import { loadTicketOrder } from '@/lib/ticketing.server';

export const metadata: Metadata = {
  title: '티켓 결제 — ICONS',
  description: 'ICONS 티켓 예매 결제 상태를 확인하세요.',
};

export default async function Page({ params }: { params: Promise<{ ticketOrderId: string }> }) {
  const { ticketOrderId: rawTicketOrderId } = await params;
  const ticketOrderId = normalizeTicketReference(rawTicketOrderId);
  if (!ticketOrderId) notFound();

  const auth = await getCurrentAuthState();
  const next = `/ticket-checkout/${ticketOrderId}`;
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  const order = await loadTicketOrder(auth.user.id, ticketOrderId);
  if (!order) notFound();

  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  const configured = checkoutPaymentsEnabled(auth.user.id);

  return (
    <TicketCheckout
      clientKey={configured ? clientKey ?? null : null}
      customer={{
        id: auth.user.id,
        email: auth.profile?.email ?? auth.user.email,
        name: auth.profile?.nickname ?? 'ICONS 팬',
      }}
      order={order}
    />
  );
}
