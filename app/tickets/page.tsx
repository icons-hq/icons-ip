import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Tickets } from '@/components/screens/Tickets';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { listTicketOrders } from '@/lib/ticketing.server';

export const metadata: Metadata = {
  title: '내 티켓 — ICONS',
  description: 'ICONS 팝업 예매와 전자티켓 상태를 확인하세요.',
  robots: { index: false, follow: false },
};

export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/tickets')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/tickets'));

  const orders = await listTicketOrders(auth.user.id);
  return <Tickets orders={orders} />;
}
