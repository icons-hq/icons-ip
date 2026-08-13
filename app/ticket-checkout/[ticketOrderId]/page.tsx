import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TicketCheckout } from '@/components/screens/TicketCheckout';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
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

  return <TicketCheckout order={order} />;
}
