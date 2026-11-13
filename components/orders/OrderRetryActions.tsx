import Link from 'next/link';
import { CheckoutDirectRetryButton } from '@/components/screens/CheckoutDirectRetryButton';
import { CheckoutRetryButton } from '@/components/screens/CheckoutRetryButton';
import type { OrderRetrySource } from '@/lib/checkout';

/*
 * 주문 내역·주문 상세의 다시 결제 진입(QA1 S-D2-15, ADR-0030 '다시 결제'). 결제 화면을 닫은 고객도 여기서 같은 길을 찾는다.
 *
 * - 결제 대기: 결제 화면에서 결제를 잇거나(같은 주문으로 다시 준비할 수 있으면) 다시 결제한다. 취소는 주문 상세의 취소 패널이다.
 * - 결제 없이 닫힌 장바구니 주문: 그 주문의 줄 가운데 장바구니에 남은 것만 고른 주문서로 간다(남은 줄이 없으면 아무 줄도 체크하지
 *   않은 장바구니) — 고르지 않았던 줄이 끼어든 모든 줄 체크 장바구니로 보내지 않는다. 이미 다시 결제해 주문을 만들었으면(T22i)
 *   [다시 결제하기] 대신 그 주문으로 잇는다.
 * - 결제 없이 닫힌 바로구매 주문: 같은 굿즈·옵션·수량의 주문서로 간다. 이미 다시 구매로 주문했으면 그 주문으로 잇는다.
 */
export function OrderRetryActions({ orderId, retry, layout }: { orderId: string; retry: OrderRetrySource; layout: 'list' | 'detail' }) {
  const id = encodeURIComponent(orderId);
  if (retry.awaitingPayment && retry.paymentUnresolved) {
    /* 결제 승인 확인 중·결과 불명·승인 뒤 취소 환불 진행 중 — 주문 상세와 같이 결제 화면의 상태 보기 하나만 둔다. */
    return (
      <div className="order-retry-actions">
        <Link className="btn btn-ghost btn-sm" href={`/checkout/${id}`}>결제 상태 보기</Link>
      </div>
    );
  }
  if (retry.awaitingPayment) {
    return (
      <div className="order-retry-actions">
        <Link className="btn btn-holo btn-sm" href={retry.source === 'cart' ? `/checkout/${id}?retry=1` : `/checkout/${id}`}>다시 결제하기</Link>
        {layout === 'list' ? <Link className="btn btn-ghost btn-sm" href={`/orders/${id}#order-cancellation`}>주문 취소</Link> : null}
      </div>
    );
  }
  if (retry.retryOrderId) {
    return (
      <div className="order-retry-actions">
        <Link className="btn btn-ghost btn-sm" href={`/orders/${encodeURIComponent(retry.retryOrderId)}`}>다시 주문한 주문 보기</Link>
      </div>
    );
  }
  return (
    <div className="order-retry-actions">
      {retry.source === 'cart' ? <CheckoutRetryButton orderId={orderId} />
        : retry.baseGoodId ? <CheckoutDirectRetryButton goodId={retry.baseGoodId} orderId={orderId} orderPending={false} secondary={layout === 'detail'} /> : null}
    </div>
  );
}
