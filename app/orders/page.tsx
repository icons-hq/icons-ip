import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Orders, type OrdersPaymentResult } from '@/components/screens/Orders';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadOrders } from '@/lib/orders.server';

export const metadata: Metadata = {
  title: '주문 내역 — ICONS',
  description: 'ICONS 굿즈 주문과 배송 상태를 확인하세요.',
};

/** Korpay confirm 콜백이 붙이는 결과 쿼리만 통과시키고, 그 외 값은 배너 없이 무시한다. */
function paymentResultFromQuery(
  value: string | string[] | undefined,
): OrdersPaymentResult | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === 'approved' || first === 'checking' || first === 'failed' ? first : undefined;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string | string[] }>;
}) {
  const paymentResult = paymentResultFromQuery((await searchParams).payment);
  const next = paymentResult ? `/orders?payment=${paymentResult}` : '/orders';

  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  const orders = await loadOrders(auth.user.id);
  return <Orders orders={orders} paymentResult={paymentResult} />;
}
