import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Tickets, type TicketsPaymentResult } from '@/components/screens/Tickets';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { listTicketOrders } from '@/lib/ticketing.server';

export const metadata: Metadata = {
  title: '내 티켓 — ICONS',
  description: 'ICONS 팝업 예매와 전자티켓 상태를 확인하세요.',
  robots: { index: false, follow: false },
};

/** Korpay confirm 콜백이 붙이는 결과 쿼리만 통과시키고, 그 외 값은 배너 없이 무시한다. */
function paymentResultFromQuery(
  value: string | string[] | undefined,
): TicketsPaymentResult | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === 'approved' || first === 'checking' || first === 'failed' ? first : undefined;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string | string[] }>;
}) {
  const paymentResult = paymentResultFromQuery((await searchParams).payment);
  const next = paymentResult ? `/tickets?payment=${paymentResult}` : '/tickets';

  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  const orders = await listTicketOrders(auth.user.id);
  return <Tickets orders={orders} paymentResult={paymentResult} />;
}
