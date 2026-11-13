'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  closeDirectOrderAction, createDirectRetryDraftAction, type DirectRetryActionError, type DirectRetryActionResult,
} from '@/app/checkout/draft-actions';

/* 다시 구매하기·이 주문 닫기가 끝나지 못한 이유. 로그인·프로필 미완료는 화면을 옮겨 안내한다. */
const DIRECT_RETRY_ERRORS: Record<Exclude<DirectRetryActionError, 'auth_required' | 'onboarding_required'>, string> = {
  account_suspended: '정지된 계정은 새 주문을 만들 수 없어요.',
  invalid_request: '주문을 다시 확인해주세요.',
  payment_in_progress: '결제 결과를 확인하고 있는 주문이 있어요. 확인이 끝난 뒤 다시 시도해주세요.',
  not_retryable: '이 주문은 다시 구매할 수 없는 상태예요. 주문 상세에서 결제 상태를 확인해주세요.',
  lines_unavailable: '이 주문은 결제 없이 취소했어요. 지금은 같은 구성으로 주문서를 열 수 없으니 굿즈 상세에서 다시 골라주세요.',
  unavailable: '요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.',
};
/* 같은 주문의 다시 구매는 한 번이다 — 두 탭·뒤로 가기로 다시 눌렀는데 이미 그 초안으로 접수·결제했으면 그 주문으로 잇는다. */
const ALREADY_REORDERED = '이미 다시 주문했어요. 주문 내용과 결제·입금 상태를 확인해주세요.';

/*
 * 결제가 승인 전에 끝난 바로구매 주문의 '다시 구매하기'(ADR-0030 확정 동작 8). 서버가 그 주문을 결제 없이 닫고(재고·쿠폰·
 * 적립금·구매 한도가 돌아온다) 같은 굿즈·옵션·수량·추가 구성·직접입력값으로 바로구매 주문서를 다시 연다 — 굿즈 상세에서 다시
 * 고르지 않는다. 장바구니는 읽지도 바꾸지도 않는다. 구성을 바꾸고 싶으면 보조 동작으로 굿즈 상세에 간다: 주문이 아직 결제
 * 대기면 같은 닫기를 먼저 해서(마지막 재고를 잡은 본인 주문 때문에 상세가 품절로 보이지 않게) 상세로 보내고, 이미 취소된
 * 주문이면 그냥 상세로 간다.
 */
export function CheckoutDirectRetryButton({ orderId, goodId, orderPending, secondary = true }: {
  orderId: string;
  goodId: string;
  orderPending: boolean;
  /** 보조 동작(굿즈 상세에서 다시 고르기)을 함께 둘지. 주문 내역 한 줄처럼 좁은 자리는 주 동작만 둔다. */
  secondary?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<'retry' | 'close' | null>(null);
  const [error, setError] = useState<{ text: string; orderId?: string } | null>(null);

  const run = async (kind: 'retry' | 'close') => {
    if (pending) return;
    setPending(kind);
    setError(null);
    try {
      const result: DirectRetryActionResult = kind === 'retry' ? await createDirectRetryDraftAction(orderId) : await closeDirectOrderAction(orderId);
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
      setError({
        text: result.error === 'not_retryable' && result.orderId ? ALREADY_REORDERED : DIRECT_RETRY_ERRORS[result.error],
        ...(result.orderId ? { orderId: result.orderId } : {}),
      });
      /* 닫았거나(lines_unavailable) 상태가 바뀐 주문은 화면을 서버 상태로 다시 읽는다. */
      if (result.error === 'lines_unavailable' || result.error === 'not_retryable') router.refresh();
    } catch {
      setError({ text: DIRECT_RETRY_ERRORS.unavailable });
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <button aria-disabled={pending ? 'true' : undefined} className="btn btn-holo" onClick={() => void run('retry')} type="button">
        {pending === 'retry' ? '주문서를 여는 중' : '다시 구매하기'}
      </button>
      {!secondary ? null : orderPending ? (
        <button aria-disabled={pending ? 'true' : undefined} className="checkout-retry-secondary" onClick={() => void run('close')} type="button">
          {pending === 'close' ? '주문을 닫는 중' : '이 주문 닫고 굿즈 상세에서 다시 고르기'}
        </button>
      ) : (
        <Link className="checkout-retry-secondary" href={`/shop/${encodeURIComponent(goodId)}`}>굿즈 상세에서 다시 고르기</Link>
      )}
      {error ? (
        <p className="checkout-error" role="alert">
          {error.text}
          {error.orderId ? <> <Link href={`/orders/${encodeURIComponent(error.orderId)}`}>주문 보기</Link></> : null}
        </p>
      ) : null}
    </>
  );
}
