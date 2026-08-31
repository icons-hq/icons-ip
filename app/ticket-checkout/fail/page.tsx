import type { Metadata } from 'next';
import Link from 'next/link';
import { parseTossOrderId } from '@/lib/payments/toss';
import { normalizeTicketReference } from '@/lib/ticketing';

export const metadata: Metadata = {
  title: '예매 결제 중단 — ICONS',
  robots: { index: false, follow: false },
};

function one(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

function safeFailureCopy(code: string | null) {
  if (code === 'PAY_PROCESS_CANCELED') return '결제를 취소했어요. 예매 상태와 정원 복원 여부를 확인해주세요.';
  if (code === 'PAY_PROCESS_ABORTED') return '결제 기관에서 요청을 완료하지 못했어요. 예매 상태가 확정될 때까지 중복 결제를 피해주세요.';
  if (code === 'REJECT_CARD_COMPANY') return '카드사에서 승인을 거절했어요. 예매 상태를 확인한 뒤 회차를 다시 선택해주세요.';
  return '결제가 완료되지 않았어요. 중복 결제 전에 예매 상태를 먼저 확인해주세요.';
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const parsedProviderRef = parseTossOrderId(one(query.orderId));
  const providerRef = parsedProviderRef?.purpose === 'ticket' ? parsedProviderRef.refId : null;
  const refId = normalizeTicketReference(one(query.ref)) ?? normalizeTicketReference(providerRef);

  return (
    <main className="wc-root wc-receipt checkout-page checkout-result-page">
      <div className="wrap checkout-result card" role="alert">
        <span className="checkout-result-mark checkout-result-mark--fail" aria-hidden>×</span>
        <h1>결제가 중단됐어요</h1>
        <p>{safeFailureCopy(one(query.code))}</p>
        {refId ? (
          <Link className="btn btn-holo" href={`/ticket-checkout/${refId}`}>예매 상태 확인</Link>
        ) : (
          <Link className="btn btn-holo" href="/events">이벤트 목록으로</Link>
        )}
        <Link className="btn btn-ghost" href="/">홈으로</Link>
      </div>
    </main>
  );
}
