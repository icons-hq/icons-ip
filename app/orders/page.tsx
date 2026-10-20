import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Orders, type OrdersPaymentResult } from '@/components/screens/Orders';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadLatestCardPaymentResultFocus } from '@/lib/checkout.server';
import { loadOrders } from '@/lib/orders.server';

export const metadata: Metadata = {
  title: '주문 내역 — ICONS',
  description: 'ICONS 굿즈 주문과 배송 상태를 확인하세요.',
};

/** 결제 confirm 콜백이 붙이는 결과 쿼리만 통과시키고, 그 외 값은 배너 없이 무시한다. */
function paymentResultFromQuery(
  value: string | string[] | undefined,
): OrdersPaymentResult | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === 'approved' || first === 'checking' || first === 'failed' ? first : undefined;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string | string[]; pending?: string | string[] }>;
}) {
  const query=await searchParams;
  const paymentResult = paymentResultFromQuery(query.payment);
  const includePending=query.pending==='1';
  const params=new URLSearchParams();
  if (paymentResult) params.set('payment',paymentResult);
  if (includePending) params.set('pending','1');
  const next = params.size ? `/orders?${params}` : '/orders';

  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  /* 결제가 확정되지 않고 돌아온 화면에서는 결제 대기 주문을 목록에 함께 보여야 고객이 자기
     주문을 찾는다 — 콜백 리다이렉트에는 주문 식별자가 없다. 배너 문구는 쿼리가 아니라
     최근 결제 시도의 원장 상태로 고른다. */
  const unresolvedResult = paymentResult === 'checking' || paymentResult === 'failed';
  const [orders, paymentFocus] = await Promise.all([
    includePending || unresolvedResult
      ? loadOrders(auth.user.id, { includePending: true })
      : loadOrders(auth.user.id),
    paymentResult ? loadLatestCardPaymentResultFocus(auth.user.id) : Promise.resolve(null),
  ]);
  return <Orders orders={orders} paymentResult={paymentResult} paymentFocus={paymentFocus} />;
}
