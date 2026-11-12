'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createDirectRetryDraftAction, type DirectRetryActionError } from '@/app/checkout/draft-actions';

/* 다시 구매하기가 주문서를 열지 못한 이유. 로그인·프로필 미완료는 화면을 옮겨 안내한다. */
const DIRECT_RETRY_ERRORS: Record<Exclude<DirectRetryActionError, 'auth_required' | 'onboarding_required'>, string> = {
  account_suspended: '정지된 계정은 새 주문을 만들 수 없어요.',
  invalid_request: '주문을 다시 확인해주세요.',
  payment_in_progress: '이 주문의 결제 결과를 확인하고 있어요. 확인이 끝난 뒤 다시 시도해주세요.',
  not_retryable: '이 주문은 다시 구매할 수 없는 상태예요. 주문 상세에서 결제 상태를 확인해주세요.',
  lines_unavailable: '이 주문은 결제 없이 취소했어요. 지금은 같은 구성으로 주문서를 열 수 없으니 굿즈 상세에서 다시 골라주세요.',
  unavailable: '주문서를 열지 못했어요. 잠시 후 다시 시도해주세요.',
};

/*
 * 결제가 승인 전에 끝난 바로구매 주문의 '다시 구매하기'(ADR-0030 확정 동작 8). 서버가 그 주문을 결제 없이 닫고(재고·쿠폰·
 * 적립금·구매 한도가 돌아온다) 같은 굿즈·옵션·수량·추가 구성·직접입력값으로 바로구매 주문서를 다시 연다 — 굿즈 상세에서 다시
 * 고르지 않는다. 장바구니는 읽지도 바꾸지도 않는다. 구성을 바꾸고 싶으면 보조 링크로 굿즈 상세에 간다.
 */
export function CheckoutDirectRetryButton({ orderId, goodId }: { orderId: string; goodId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await createDirectRetryDraftAction(orderId);
      if (result.ok) {
        router.push(result.href);
        return;
      }
      if (result.error === 'auth_required') {
        router.push(`/login?next=${encodeURIComponent(`/checkout/${orderId}`)}`);
        return;
      }
      if (result.error === 'onboarding_required') {
        router.push(`/onboarding?next=${encodeURIComponent(`/checkout/${orderId}`)}`);
        return;
      }
      setError(DIRECT_RETRY_ERRORS[result.error]);
      /* 닫았거나(lines_unavailable) 상태가 바뀐 주문은 화면을 서버 상태로 다시 읽는다. */
      if (result.error === 'lines_unavailable' || result.error === 'not_retryable') router.refresh();
    } catch {
      setError(DIRECT_RETRY_ERRORS.unavailable);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button aria-disabled={pending ? 'true' : undefined} className="btn btn-holo" onClick={() => void retry()} type="button">
        {pending ? '주문서를 여는 중' : '다시 구매하기'}
      </button>
      <Link className="checkout-retry-secondary" href={`/shop/${encodeURIComponent(goodId)}`}>굿즈 상세에서 다시 고르기</Link>
      {error ? <p className="checkout-error" role="alert">{error}</p> : null}
    </>
  );
}
