'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PreparedCheckoutAction } from '@/components/payments/PreparedCheckoutAction';
import { krw } from '@/lib/format';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { ticketCheckoutState } from '@/lib/ticketing';
import type { TicketOrderSnapshot } from '@/lib/ticketing.server';

export function TicketCheckout({
  order,
  prepared,
}: {
  order: TicketOrderSnapshot;
  prepared: PreparedCheckout | null;
}) {
  const router = useRouter();
  const [pollAttempts, setPollAttempts] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  const state = ticketCheckoutState(order.status, order.paymentStatus, order.expiresAt, now ?? 0);
  const expiresIn = order.expiresAt && now !== null ? Math.max(0, Date.parse(order.expiresAt) - now) : 0;
  const minutes = Math.floor(expiresIn / 60_000);
  const seconds = Math.floor((expiresIn % 60_000) / 1_000);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0);
    if (state !== 'payable') return () => window.clearTimeout(initialTimer);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [state]);

  useEffect(() => {
    if (state !== 'checking' || pollAttempts >= 15) return;
    const timer = window.setTimeout(() => {
      setPollAttempts((attempts) => attempts + 1);
      router.refresh();
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [order.paymentStatus, order.status, pollAttempts, router, state]);

  const statusCopy = useMemo(() => {
    if (state === 'complete') {
      return {
        eyebrow: 'BOOKING CONFIRMED',
        title: '예매가 완료됐어요',
        body: `전자티켓 ${order.qty}장이 발급됐어요. 이 화면을 닫아도 예매 상태는 안전하게 보관됩니다.`,
      };
    }
    if (state === 'checking') {
      return {
        eyebrow: 'VERIFYING PAYMENT',
        title: '결제를 확인하고 있어요',
        body: '결제사 결과를 서버에서 다시 확인 중입니다. 이 화면을 닫아도 예약은 자동 해제되지 않습니다.',
      };
    }
    if (state === 'closed') {
      return {
        eyebrow: 'BOOKING CLOSED',
        title: '예매가 종료됐어요',
        body: '결제 가능한 시간이 지났거나 예매가 취소됐습니다. 선점 수량은 자동으로 복원됩니다.',
      };
    }
    return null;
  }, [order.qty, state]);

  return (
    <main className="checkout-page ticket-checkout-page">
      <header className="checkout-header checkout-order-header">
        <div className="wrap">
          <div className="eyebrow" style={{ color: state === 'complete' ? 'var(--mint)' : 'var(--cyan)' }}>
            {statusCopy?.eyebrow ?? 'SECURE TICKET PAYMENT'}
          </div>
          <h1 className="h-xl">{statusCopy?.title ?? '결제수단을 선택하세요'}</h1>
          <p>{statusCopy?.body ?? '예매 금액은 서버에서 다시 확인했습니다. 결제수단과 필수 약관을 선택해주세요.'}</p>
          <span className="checkout-order-ref mono">BOOKING · {order.id}</span>
        </div>
      </header>

      <div className="wrap checkout-order-layout">
        <section className="checkout-order-main card">
          {state === 'payable' && now === null ? (
            <div className="checkout-state-panel" role="status">결제 가능 시간을 확인하고 있어요.</div>
          ) : state === 'payable' && prepared ? (
            <>
              <div className="checkout-deadline" role="timer">
                <span>회차 선점 남은 시간</span>
                <strong className="mono">{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</strong>
              </div>
              <PreparedCheckoutAction prepared={prepared} />
            </>
          ) : state === 'payable' ? (
            <div className="checkout-state-panel" role="alert">
              <h2>결제 환경을 확인 중이에요</h2>
              <p>예매는 생성됐지만 결제수단을 불러올 수 없습니다. 만료 전에 새로고침하거나 잠시 후 다시 시도해주세요.</p>
            </div>
          ) : (
            <div className={`checkout-state-panel checkout-state-panel--${state}`} role="status">
              <span className="checkout-state-mark" aria-hidden>{state === 'complete' ? '✓' : state === 'checking' ? '···' : '×'}</span>
              <h2>{statusCopy?.title}</h2>
              <p>{statusCopy?.body}</p>
              {state === 'checking' && pollAttempts >= 15 && (
                <button className="btn btn-ghost" onClick={() => router.refresh()} type="button">상태 다시 확인</button>
              )}
              {state === 'closed' && <Link className="btn btn-holo" href={`/events/${encodeURIComponent(order.eventId)}`}>회차 다시 보기</Link>}
              {state === 'complete' && <Link className="btn btn-holo" href={`/tickets/${order.id}`}>전자티켓 보기</Link>}
            </div>
          )}
        </section>

        <aside className="checkout-receipt card" aria-label="예매 영수증">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">TICKET</span>
            <h2>예매 내역</h2>
          </div>
          <div className="ticket-receipt-event">
            <span>{order.eventTitle}</span>
            <strong>{order.ticketTypeName}</strong>
            <small className="mono">{order.qty}매</small>
          </div>
          <dl className="checkout-totals">
            <div><dt>티켓 금액</dt><dd>{krw(order.total)}</dd></div>
            <div className="checkout-total"><dt>결제 금액</dt><dd>{krw(order.total)}</dd></div>
          </dl>
          <p className="money-caption">결제 확인 전에는 QR이 발급되지 않습니다. 승인 콜백만으로 완료 처리하지 않습니다.</p>
        </aside>
      </div>
    </main>
  );
}
