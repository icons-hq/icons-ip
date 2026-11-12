'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadPendingCheckoutOrderAction, releaseUnpaidCheckoutOrdersAction } from '@/app/cart/actions';

type ReleaseState = 'idle' | 'pending' | 'released' | 'confirming' | 'nothing' | 'failed';

const RELEASE_NOTICES: Partial<Record<ReleaseState, { role: 'status' | 'alert'; text: string }>> = {
  released: { role: 'status', text: '결제하지 않은 주문을 취소했어요. 가격과 혜택을 다시 확인하고 있어요.' },
  confirming: { role: 'alert', text: '앞서 결제한 주문의 승인 결과를 확인하고 있어요. 확인이 끝난 뒤 다시 시도해주세요.' },
  nothing: { role: 'status', text: '취소할 수 있는 미결제 주문이 없어요. 진행 중인 주문에서 결제를 이어가거나 입금 안내를 확인해주세요.' },
  failed: { role: 'alert', text: '주문을 취소하지 못했어요. 잠시 후 다시 시도해주세요.' },
};

/**
 * 견적이 결제를 마치지 않은 주문의 쿠폰·첫구매 예약·구매 한도 때문에 막혔을 때(ADR-0030). 장바구니·주문서를 열기만 해서는
 * 다른 탭의 결제창을 끊지 않으므로, 그 주문을 알리고 고객이 '진행 중인 미결제 주문 취소하고 계속'을 누를 때만 출처(장바구니·
 * 바로구매)와 무관하게 결제를 마치지 않은 카드 주문을 닫는다(ADR-0026 닫기 경로). 결제 승인을 확인 중인 주문은 닫지 않는다.
 * 닫았으면 부모가 견적을 다시 받는다(`onReleased`).
 */
export function CheckoutPendingOrderRelease({ onReleased }: { onReleased: () => void }) {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [state, setState] = useState<ReleaseState>('idle');

  /* 막힌 원인일 수 있는 결제 대기 주문을 알린다(가장 최근 것). 읽지 못하면 진행 중인 주문 목록으로 잇는다. */
  useEffect(() => {
    let active = true;
    void loadPendingCheckoutOrderAction().then((result) => {
      if (active) setOrderId(result.orderId);
    }, () => undefined);
    return () => {
      active = false;
    };
  }, []);

  const release = async () => {
    if (state === 'pending') return;
    setState('pending');
    try {
      const result = await releaseUnpaidCheckoutOrdersAction();
      if (!result.ok) {
        setState('failed');
        return;
      }
      setOrderId(result.pendingOrderId);
      if (result.confirming) setState('confirming');
      else if (result.released > 0) {
        setState('released');
        onReleased();
      } else setState('nothing');
    } catch {
      setState('failed');
    }
  };

  const notice = RELEASE_NOTICES[state];
  return (
    <span className="checkout-pending-release">
      {' 결제를 마치지 않은 주문이 쿠폰·첫구매 혜택·구매 한도를 잡고 있을 수 있어요. '}
      <Link href={orderId ? `/orders/${encodeURIComponent(orderId)}` : '/orders?pending=1'}>{orderId ? '결제 대기 주문 보기' : '진행 중인 주문 보기'}</Link>
      {' '}
      <button disabled={state === 'pending'} onClick={() => void release()} type="button">
        {state === 'pending' ? '미결제 주문을 취소하는 중' : '진행 중인 미결제 주문 취소하고 계속'}
      </button>
      {notice ? <span role={notice.role}>{` ${notice.text}`}</span> : null}
    </span>
  );
}
