import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CheckoutOrder } from '@/components/screens/CheckoutOrder';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { loadCheckoutOrder } from '@/lib/checkout.server';
import { isAwaitingDepositAttempt } from '@/lib/payments/virtual-account';
import { orderCompleteHref } from '@/lib/routes';
import { getBankTransferAccount } from '@/lib/payments/bank-transfer.server';

export const metadata: Metadata = {
  title: '주문 결제 — ICONS',
  description: 'ICONS 주문 결제 상태를 확인하세요.',
};

interface PageProps {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ params, searchParams }: PageProps) {
  const { orderId: rawOrderId } = await params;
  const orderId = normalizeOrderReference(rawOrderId);
  if (!orderId) notFound();

  const auth = await getCurrentAuthState();
  const next = `/checkout/${orderId}`;
  if (auth.authUnavailable) throw new Error('Checkout authentication temporarily unavailable');
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  const order = await loadCheckoutOrder(auth.user.id, orderId);
  if (!order) notFound();

  /* 토스 가상계좌 입금 대기(ADR-0049): 이미 결제가 잡혀 있어 위젯을 다시 열지 않는다. 입금 안내는 주문 완료 화면이 보인다. */
  if (order.status === 'pending' && order.paymentMethod === 'card' && isAwaitingDepositAttempt(order.paymentAttempt)) {
    redirect(orderCompleteHref(order.id));
  }

  /* 토스 failUrl은 실패한 그 주문의 이 화면으로 돌아온다(?code=…&message=…). 루트
     /checkout과 같은 규칙으로 code는 형식만 통과시키고, message는 아예 읽지 않는다. */
  const query = (await searchParams) ?? {};
  const rawFailCode = typeof query.code === 'string' ? query.code : null;
  const paymentFailCode = rawFailCode && /^[A-Z_]{2,64}$/.test(rawFailCode)
    ? rawFailCode
    : null;

  return (
    <CheckoutOrder
      order={order}
      bankTransferAccount={
        order.paymentMethod === 'bank_transfer' ? await getBankTransferAccount() : null
      }
      paymentFailCode={paymentFailCode}
      autoRetry={query.retry === '1'}
    />
  );
}
