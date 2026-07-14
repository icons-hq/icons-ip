import type { Metadata } from 'next';
import { PaymentConfirmation } from '@/components/payments/PaymentConfirmation';
import { parseTossOrderId } from '@/lib/payments/toss';
import { normalizeTicketReference } from '@/lib/ticketing';

export const metadata: Metadata = {
  title: '예매 결제 확인 — ICONS',
  robots: { index: false, follow: false },
};

function one(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const paymentKey = one(query.paymentKey);
  const orderId = one(query.orderId);
  const paymentType = one(query.paymentType);
  const rawAmount = one(query.amount);
  const rawRef = one(query.ref);
  const parsedProviderRef = parseTossOrderId(orderId);
  const providerRef = parsedProviderRef?.purpose === 'ticket' ? parsedProviderRef.refId : null;
  const refId = normalizeTicketReference(rawRef) ?? normalizeTicketReference(providerRef);
  const amountValue = Number(rawAmount);
  const amount = Number.isSafeInteger(amountValue) && amountValue > 0 ? amountValue : null;
  const resumeParams = new URLSearchParams();
  for (const [key, value] of [
    ['paymentKey', paymentKey],
    ['orderId', orderId],
    ['amount', rawAmount],
    ['paymentType', paymentType],
    ['ref', rawRef],
  ] as const) {
    if (value) resumeParams.set(key, value);
  }
  const resumePath = `/ticket-checkout/success${resumeParams.size ? `?${resumeParams.toString()}` : ''}`;

  return (
    <PaymentConfirmation
      amount={amount}
      destinationPath={refId ? `/ticket-checkout/${refId}` : null}
      fallbackHref="/events"
      fallbackLabel="이벤트 목록으로"
      orderId={orderId}
      paymentKey={paymentKey}
      paymentType={paymentType}
      resumePath={resumePath}
      subject="예매"
    />
  );
}
