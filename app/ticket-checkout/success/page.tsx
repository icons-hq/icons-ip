import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
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
  const rawRef = one(query.ref);
  const parsedProviderRef = parseTossOrderId(one(query.orderId));
  const providerRef = parsedProviderRef?.purpose === 'ticket' ? parsedProviderRef.refId : null;
  const refId = normalizeTicketReference(rawRef) ?? normalizeTicketReference(providerRef);
  redirect(refId ? `/ticket-checkout/${refId}` : '/events');
}
