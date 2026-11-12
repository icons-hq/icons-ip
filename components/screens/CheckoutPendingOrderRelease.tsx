'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { loadUnpaidCheckoutOrdersAction, releaseUnpaidCheckoutOrdersAction } from '@/app/cart/actions';
import { relevantUnpaidCheckoutOrders, unpaidCheckoutOrderSummary, type UnpaidCheckoutOrder } from '@/lib/checkout-selection';
import { krw } from '@/lib/format';
import { orderReferenceLabel } from '@/lib/orders';

type ReleasePhase = 'idle' | 'confirm' | 'releasing' | 'released' | 'confirming' | 'nothing' | 'failed';

const RELEASE_NOTICES: Partial<Record<ReleasePhase, { role: 'status' | 'alert'; text: string }>> = {
  released: { role: 'status', text: '결제 대기 주문을 취소했어요. 가격과 혜택을 다시 확인하고 있어요.' },
  confirming: { role: 'alert', text: '결제 결과를 확인하고 있는 주문은 취소하지 않았어요. 확인이 끝난 뒤 다시 시도해주세요.' },
  nothing: { role: 'status', text: '이미 정리된 주문이에요. 가격과 혜택을 다시 확인하고 있어요.' },
  failed: { role: 'alert', text: '주문을 취소하지 못했어요. 잠시 후 다시 시도해주세요.' },
};

export interface CheckoutPendingOrderReleaseProps {
  /** 결제 대기 주문을 닫은 뒤 부모가 견적·선택을 다시 읽는다. */
  onReleased: () => void;
  /** 쿠폰·첫구매 혜택·회원 누적 한도처럼 어느 결제 대기 주문이든 원인일 수 있는 막힘이 있다. */
  holdsBenefits?: boolean;
  /** 재고가 모자라 막힌 굿즈 — 결제 대기 주문이 이 굿즈를 담고 있을 때만 안내한다. */
  stockGoodIds?: readonly string[];
}

/**
 * 견적이 결제를 마치지 않은 주문의 쿠폰·첫구매 예약·구매 한도·재고 때문에 막혔을 수 있을 때(ADR-0030). 장바구니·주문서를
 * 열기만 해서는 다른 탭의 결제창을 끊지 않으므로, 막힘이 있을 때 결제 대기 주문을 읽어 실제로 찾았을 때만 안내하고(못 찾으면
 * 아무것도 그리지 않는다 — 화면은 사유만 보인다), 고객이 '결제 대기 주문 취소하고 계속'을 누르면 취소될 주문(주문번호·굿즈·
 * 금액)을 보이는 확인 단계를 거쳐, 확인한 주문만 출처(장바구니·바로구매)와 무관하게 ADR-0026 닫기 경로로 닫는다. 결제 승인을
 * 확인 중인 주문은 닫지 않는다. 경고(사유) 글과 나눈 상자에 실제 버튼·밑줄 링크로 둔다. 부모는 막힘이 없어도 그려 둔다 —
 * 막힘이 풀린 뒤에도 취소 결과 안내가 남는다.
 */
export function CheckoutPendingOrderRelease({ onReleased, holdsBenefits = false, stockGoodIds = [] }: CheckoutPendingOrderReleaseProps) {
  const [orders, setOrders] = useState<readonly UnpaidCheckoutOrder[] | null>(null);
  const [phase, setPhase] = useState<ReleasePhase>('idle');
  const [loadKey, setLoadKey] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmWasOpen = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  /* 막힘이 있을 때만 원인일 수 있는 결제 대기 주문을 읽는다. 읽지 못하면 안내하지 않는다(사유만 남는다). */
  const cause = `${holdsBenefits ? 'benefits' : ''}|${[...new Set(stockGoodIds)].sort().join(',')}`;
  useEffect(() => {
    if (cause === '|') return;
    let active = true;
    void loadUnpaidCheckoutOrdersAction().then((result) => {
      if (active) setOrders(result.ok ? result.orders : []);
    }, () => {
      if (active) setOrders([]);
    });
    return () => {
      active = false;
    };
  }, [cause, loadKey]);

  /* 확인 단계를 닫으면(돌아가기) 연 버튼으로 포커스를 돌려준다. */
  useEffect(() => {
    if (phase === 'idle' && confirmWasOpen.current) triggerRef.current?.focus();
    confirmWasOpen.current = phase === 'confirm';
  }, [phase]);

  const relevant = relevantUnpaidCheckoutOrders(orders ?? [], { holdsBenefits, stockGoodIds });
  const releasable = relevant.filter((order) => order.releasable);
  const checking = relevant.filter((order) => !order.releasable);
  const notice = RELEASE_NOTICES[phase];
  const stock = new Set(stockGoodIds);
  const holdsStock = releasable.some((order) => order.goodIds.some((goodId) => stock.has(goodId)));

  const release = async () => {
    if (phase === 'releasing' || !releasable.length) return;
    setPhase('releasing');
    try {
      const result = await releaseUnpaidCheckoutOrdersAction(releasable.map((order) => order.id));
      if (!result.ok) {
        setPhase('failed');
        return;
      }
      if (result.released > 0 || !result.confirming) onReleased();
      setPhase(result.confirming ? 'confirming' : result.released > 0 ? 'released' : 'nothing');
    } catch {
      setPhase('failed');
    } finally {
      setLoadKey((key) => key + 1);
    }
  };

  if (!releasable.length) {
    if (notice) return <div className="checkout-pending-release"><p role={notice.role}>{notice.text}</p></div>;
    if (!checking.length) return null;
    return (
      <div className="checkout-pending-release">
        <p role="status">결제 결과를 확인하고 있는 주문이 있어요. 확인이 끝나면 쿠폰·구매 한도·재고가 정리돼요.</p>
        <Link className="checkout-pending-release__link" href={checking.length === 1 ? `/orders/${encodeURIComponent(checking[0].id)}` : '/orders?pending=1'}>
          주문 보기
        </Link>
      </div>
    );
  }

  const count = releasable.length;
  return (
    <div className="checkout-pending-release">
      <p>
        {!holdsBenefits
          ? `결제 대기 주문 ${count}건이 이 굿즈의 재고를 잡고 있어요.`
          : holdsStock
            ? `결제 대기 주문 ${count}건이 쿠폰·구매 한도나 재고를 잡고 있을 수 있어요.`
            : `결제 대기 주문 ${count}건이 쿠폰·첫구매 혜택·구매 한도를 잡고 있을 수 있어요.`}
      </p>
      <Link className="checkout-pending-release__link" href={count === 1 ? `/orders/${encodeURIComponent(releasable[0].id)}` : '/orders?pending=1'}>
        결제 대기 주문 보기
      </Link>
      {phase === 'confirm' || phase === 'releasing' ? (
        <div aria-describedby={bodyId} aria-labelledby={titleId} className="checkout-pending-release__confirm" role="alertdialog">
          <strong id={titleId}>{`결제하지 않은 주문 ${count}건을 취소할까요?`}</strong>
          <p id={bodyId}>청구된 금액은 없고, 다른 창에서 진행 중인 결제는 끝나요. 이 주문이 쓰던 쿠폰·적립금·재고는 돌아와요.</p>
          <ul aria-label="취소할 결제 대기 주문" className="checkout-pending-release__orders">
            {releasable.map((order) => (
              <li key={order.id}>
                <span className="checkout-pending-release__order-number">{`주문번호 ${orderReferenceLabel(order.id, order.orderNumber)}`}</span>
                <span>{unpaidCheckoutOrderSummary(order)}</span>
                <span className="checkout-pending-release__order-total">{krw(order.total)}</span>
              </li>
            ))}
          </ul>
          <div className="checkout-pending-release__confirm-actions">
            <button autoFocus className="wc-btn" disabled={phase === 'releasing'} onClick={() => setPhase('idle')} type="button">돌아가기</button>
            <button aria-disabled={phase === 'releasing' ? 'true' : undefined} className="wc-btn primary" onClick={() => void release()} type="button">
              {phase === 'releasing' ? '주문을 취소하는 중' : `${count}건 취소하고 계속`}
            </button>
          </div>
        </div>
      ) : (
        <button className="wc-btn" onClick={() => setPhase('confirm')} ref={triggerRef} type="button">결제 대기 주문 취소하고 계속</button>
      )}
      {notice ? <p role={notice.role}>{notice.text}</p> : null}
    </div>
  );
}
