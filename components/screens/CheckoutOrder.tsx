'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { TossPaymentWidget } from '@/components/payments/TossPaymentWidget';
import { checkoutOrderName, checkoutOrderState } from '@/lib/checkout';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';

const krw = (value: number) => `₩${value.toLocaleString('ko-KR')}`;

interface CheckoutOrderProps {
  clientKey: string | null;
  customer: { id: string; email: string | null; name: string };
  order: CheckoutOrderSnapshot;
}

export function CheckoutOrder({ clientKey, customer, order }: CheckoutOrderProps) {
  const router = useRouter();
  const [pollAttempts, setPollAttempts] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  const state = checkoutOrderState(order.status, order.paymentStatus, order.expiresAt, now ?? 0);
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
    if (state === 'complete') return { eyebrow: 'PAYMENT CONFIRMED', title: '결제가 확인됐어요', body: '주문이 안전하게 접수됐습니다. 배송 진행은 주문 내역에서 이어서 확인할 수 있어요.' };
    if (state === 'checking') return { eyebrow: 'VERIFYING PAYMENT', title: '결제를 확인하고 있어요', body: '승인은 접수됐고 웹훅으로 최종 상태를 확인 중입니다. 이 화면을 닫아도 확인은 계속됩니다.' };
    if (state === 'closed') return { eyebrow: 'CHECKOUT CLOSED', title: '결제 가능한 시간이 지났어요', body: '선점된 재고는 자동으로 복원됩니다. 새 장바구니에서 주문을 다시 만들어주세요.' };
    return null;
  }, [state]);

  return (
    <main className="checkout-page checkout-order-page">
      <header className="checkout-header checkout-order-header">
        <div className="wrap">
          <div className="eyebrow" style={{ color: state === 'complete' ? 'var(--mint)' : 'var(--cyan)' }}>
            {statusCopy?.eyebrow ?? 'SECURE PAYMENT'}
          </div>
          <h1 className="h-xl">{statusCopy?.title ?? '결제수단을 선택하세요'}</h1>
          <p>{statusCopy?.body ?? '주문 금액은 서버에서 다시 확인했습니다. 결제수단과 필수 약관을 선택해주세요.'}</p>
          <span className="checkout-order-ref mono">ORDER · {order.id}</span>
        </div>
      </header>

      <div className="wrap checkout-order-layout">
        <section className="checkout-order-main card">
          {state === 'payable' && now === null ? (
            <div className="checkout-state-panel" role="status">결제 가능 시간을 확인하고 있어요.</div>
          ) : state === 'payable' && clientKey ? (
            <>
              <div className="checkout-deadline" role="timer">
                <span>재고 선점 남은 시간</span>
                <strong className="mono">{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</strong>
              </div>
              <TossPaymentWidget
                clientKey={clientKey}
                customerEmail={customer.email}
                customerKey={customer.id}
                customerName={customer.name}
                orderId={order.id}
                orderName={checkoutOrderName(order.items.map((item) => item.name))}
                total={order.total}
              />
            </>
          ) : state === 'payable' ? (
            <div className="checkout-state-panel" role="alert">
              <h2>결제 환경을 확인 중이에요</h2>
              <p>주문은 생성됐지만 결제수단을 불러올 수 없습니다. 만료 전에 새로고침하거나 잠시 후 다시 시도해주세요.</p>
            </div>
          ) : (
            <div className={`checkout-state-panel checkout-state-panel--${state}`} role="status">
              <span className="checkout-state-mark" aria-hidden>{state === 'complete' ? '✓' : state === 'checking' ? '···' : '×'}</span>
              <h2>{statusCopy?.title}</h2>
              <p>{statusCopy?.body}</p>
              {state === 'checking' && pollAttempts >= 15 && (
                <button className="btn btn-ghost" type="button" onClick={() => router.refresh()}>상태 다시 확인</button>
              )}
              {state === 'closed' && <Link className="btn btn-holo" href="/shop">굿즈 다시 담기</Link>}
              {state === 'complete' && <Link className="btn btn-holo" href="/">홈으로</Link>}
            </div>
          )}
        </section>

        <aside className="checkout-receipt card" aria-label="주문 영수증">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">ORDER</span>
            <h2>주문 내역</h2>
          </div>
          <div className="checkout-items">
            {order.items.map((item) => (
              <div className="checkout-item" key={item.goodId}>
                <div><span>{item.type}</span><strong>{item.name}</strong></div>
                <span className="mono">{item.qty} × {krw(item.unitPrice)}</span>
              </div>
            ))}
          </div>
          <dl className="checkout-totals">
            <div><dt>굿즈 금액</dt><dd>{krw(order.total)}</dd></div>
            <div><dt>배송비</dt><dd>무료</dd></div>
            <div className="checkout-total"><dt>결제 금액</dt><dd>{krw(order.total)}</dd></div>
          </dl>
          {order.address && (
            <div className="checkout-address-preview">
              <span>배송지</span>
              <strong>{order.address.recipientName} · {order.address.phone}</strong>
              <p>[{order.address.postalCode}] {order.address.address1} {order.address.address2}</p>
              {order.address.deliveryNote && <small>{order.address.deliveryNote}</small>}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
