import type { Metadata } from 'next';
import Link from 'next/link';
import { normalizeOrderReference } from '@/lib/checkout';
import { parseTossOrderId } from '@/lib/payments/toss';

export const metadata: Metadata = {
  title: '결제 중단 — ICONS',
  robots: { index: false, follow: false },
};

function one(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

function safeFailureCopy(code: string | null) {
  if (code === 'PAY_PROCESS_CANCELED') return '결제를 취소했어요. 같은 주문에서 다른 결제수단으로 다시 시도할 수 있습니다.';
  if (code === 'PAY_PROCESS_ABORTED') return '결제 기관에서 요청을 완료하지 못했어요. 결제 정보를 확인하고 다시 시도해주세요.';
  if (code === 'REJECT_CARD_COMPANY') return '카드사에서 승인을 거절했어요. 카드사 안내를 확인하거나 다른 결제수단을 선택해주세요.';
  return '결제가 완료되지 않았어요. 주문 상태를 확인한 뒤 다시 시도해주세요.';
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const providerRef = parseTossOrderId(one(query.orderId))?.refId ?? null;
  const refId = normalizeOrderReference(one(query.ref)) ?? normalizeOrderReference(providerRef);

  return (
    <main className="checkout-page checkout-result-page">
      <div className="wrap checkout-result card" role="alert">
        <span className="checkout-result-mark checkout-result-mark--fail" aria-hidden>×</span>
        <div className="eyebrow">PAYMENT NOT COMPLETED</div>
        <h1>결제가 중단됐어요</h1>
        <p>{safeFailureCopy(one(query.code))}</p>
        {refId ? (
          <Link className="btn btn-holo" href={`/checkout/${refId}`}>결제 다시 시도</Link>
        ) : (
          <Link className="btn btn-holo" href="/cart">장바구니로 돌아가기</Link>
        )}
        <Link className="btn btn-ghost" href="/">홈으로</Link>
      </div>
    </main>
  );
}
