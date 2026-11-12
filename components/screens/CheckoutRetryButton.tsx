'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createCartRetryDraftAction } from '@/app/checkout/draft-actions';

/*
 * 결제 없이 끝난 장바구니 주문의 '다시 결제하기'(ADR-0026·0030). 그 주문에 들어 있던 줄 가운데 아직 장바구니에 있는
 * 줄로 주문서 초안을 만들어 주문서로 간다 — 장바구니에서 고르지 않았던 줄이 다시 결제 주문서에 끼어들지 않는다.
 * 남은 줄이 없으면 장바구니로 간다. 주문서가 이 주문을 결제 없이 닫고 새 주문을 만든다.
 */
export function CheckoutRetryButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const retry = async () => {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const result = await createCartRetryDraftAction(orderId);
      if (result.ok) {
        router.push(result.href);
        return;
      }
      if (result.error === 'auth_required') {
        router.push(`/login?next=${encodeURIComponent(`/checkout/${orderId}`)}`);
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button aria-disabled={pending ? 'true' : undefined} className="btn btn-holo" onClick={() => void retry()} type="button">
        {pending ? '주문서를 여는 중' : '다시 결제하기'}
      </button>
      {failed ? <p className="checkout-error" role="alert">주문서를 열지 못했어요. 잠시 후 다시 시도해주세요.</p> : null}
    </>
  );
}
