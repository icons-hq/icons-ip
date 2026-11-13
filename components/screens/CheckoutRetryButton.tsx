'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createCartRetryDraftAction } from '@/app/checkout/draft-actions';

/*
 * 결제 없이 끝난 장바구니 주문의 '다시 결제하기'(ADR-0026·0030). 그 주문에 들어 있던 줄 가운데 아직 장바구니에 있는
 * 줄로 주문서 초안을 만들어 주문서로 간다 — 장바구니에서 고르지 않았던 줄이 다시 결제 주문서에 끼어들지 않는다.
 * 남은 줄이 없으면 장바구니로 간다. 주문서가 이 주문을 결제 없이 닫고 새 주문을 만든다.
 *
 * autoStart: 주문 목록·결제 결과 안내의 [다시 결제하기]로 이 화면에 왔다(?retry=1). 이미 한 번 누른 고객이 같은 버튼을 또 누르지
 * 않게 한 번만 바로 시작한다(T22i·QA1c S-D2-15). 뒤로 가기가 다시 시작하지 않도록 주소의 retry 표시는 먼저 지운다.
 */
export function CheckoutRetryButton({ orderId, autoStart = false }: { orderId: string; autoStart?: boolean }) {
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

  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('retry')) {
        url.searchParams.delete('retry');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch { /* 주소 정리는 편의다 */ }
    void retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 한 번만 시작한다(started 표시)
  }, [autoStart]);

  return (
    <>
      <button aria-disabled={pending ? 'true' : undefined} className="btn btn-holo" onClick={() => void retry()} type="button">
        {pending ? '주문서를 여는 중' : '다시 결제하기'}
      </button>
      {failed ? <p className="checkout-error" role="alert">주문서를 열지 못했어요. 잠시 후 다시 시도해주세요.</p> : null}
    </>
  );
}
