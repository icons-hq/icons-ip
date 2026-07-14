import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TicketDetail } from '@/components/screens/TicketDetail';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeTicketReference } from '@/lib/ticketing';
import { loadTicketOrderDetail } from '@/lib/ticketing.server';

export const metadata: Metadata = {
  title: '티켓 상세 — ICONS',
  description: '팝업 일정, 전자티켓 QR, 사용 및 취소·환불 상태를 확인하세요.',
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ ticketOrderId: string }>;
}) {
  const { ticketOrderId: rawTicketOrderId } = await params;
  const ticketOrderId = normalizeTicketReference(rawTicketOrderId);
  if (!ticketOrderId) notFound();

  const next = `/tickets/${ticketOrderId}`;
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  const order = await loadTicketOrderDetail(auth.user.id, ticketOrderId);
  if (!order) notFound();
  return <TicketDetail order={order} />;
}
