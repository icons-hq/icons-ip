'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  prepareGoodsPaymentAction,
  type PrepareGoodsPaymentActionState,
} from '@/app/checkout/actions';
import { PreparedCheckoutAction } from '@/components/payments/PreparedCheckoutAction';
import { checkoutOrderState } from '@/lib/checkout';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import { krw } from '@/lib/format';
import {
  bankTransferDeadlineLabel,
  bankTransferDepositName,
  type BankTransferAccount,
} from '@/lib/payments/bank-transfer';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { shippingFeeLabel } from '@/lib/shipping';

interface CheckoutOrderProps {
  order: CheckoutOrderSnapshot;
  /** 무통장 주문에만 실린다. 서버 설정에 계좌가 없으면 null(#255). */
  bankTransferAccount?: BankTransferAccount | null;
}

const emptyPrepareState: PrepareGoodsPaymentActionState = {};

const prepareErrorCopy: Record<NonNullable<PrepareGoodsPaymentActionState['error']>, string> = {
  auth_required: '로그인 상태를 다시 확인한 뒤 결제를 준비해주세요.',
  not_found: '이 주문을 확인할 수 없습니다.',
  not_payable: '이 주문은 더 이상 결제할 수 없습니다.',
  payment_unavailable: '결제 환경을 준비 중입니다. 잠시 후 다시 시도해주세요.',
};

export function effectiveGoodsCheckoutExpiry(
  orderExpiresAt: string,
  providerExpiresAt?: string,
) {
  const orderExpiry = Date.parse(orderExpiresAt);
  const providerExpiry = providerExpiresAt ? Date.parse(providerExpiresAt) : orderExpiry;
  return Math.min(orderExpiry, providerExpiry);
}

export function preparedGoodsCheckoutUsable(
  prepared: PreparedCheckout | undefined,
  orderExpiresAt: string | null,
  now: number,
) {
  return Boolean(
    prepared
    && orderExpiresAt
    && effectiveGoodsCheckoutExpiry(orderExpiresAt, prepared.expiresAt) > now,
  );
}

export function CheckoutOrder({ order, bankTransferAccount = null }: CheckoutOrderProps) {
  const router = useRouter();
  const [prepareState, prepareAction, preparePending] = useActionState(
    prepareGoodsPaymentAction,
    emptyPrepareState,
  );
  const [pollAttempts, setPollAttempts] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  const state = checkoutOrderState(order.status, order.paymentStatus, order.expiresAt, now ?? 0);
  const effectiveExpiry = order.expiresAt
    ? effectiveGoodsCheckoutExpiry(order.expiresAt, prepareState.prepared?.expiresAt)
    : 0;
  const preparedUsable = now !== null && preparedGoodsCheckoutUsable(
    prepareState.prepared,
    order.expiresAt,
    now,
  );
  const preparedExpired = Boolean(prepareState.prepared && now !== null && !preparedUsable);
  const expiresIn = now !== null ? Math.max(0, effectiveExpiry - now) : 0;
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

  const isBankTransfer = order.paymentMethod === 'bank_transfer';

  const statusCopy = useMemo(() => {
    if (state === 'complete') return { title: '결제가 확인됐어요', body: '주문이 안전하게 접수됐습니다. 배송 진행은 주문 내역에서 이어서 확인할 수 있어요.' };
    if (state === 'checking') return { title: '결제를 확인하고 있어요', body: '결제사 확인 결과와 서버 원장을 대조하고 있습니다. 이 화면을 닫아도 확인은 계속됩니다.' };
    if (state === 'closed') {
      if (isBankTransfer) {
        return { title: '입금 기한이 지났어요', body: '선점된 재고는 자동으로 복원됩니다. 기한이 지난 뒤 입금하셨다면 고객센터 문의로 알려주세요 — 주문은 되살아나지 않고 입금액을 반환해 드립니다.' };
      }
      return { title: '결제 가능한 시간이 지났어요', body: '선점된 재고는 자동으로 복원됩니다. 새 장바구니에서 주문을 다시 만들어주세요.' };
    }
    return null;
  }, [isBankTransfer, state]);

  return (
    <main className="wc-root wc-receipt checkout-page checkout-order-page">
      <header className="wc-receipt__head">
        <div className="wrap">
          <h1 className="wc-receipt__title">{statusCopy?.title ?? '결제수단을 선택하세요'}</h1>
          <p className="wc-receipt__subcopy">{statusCopy?.body ?? '주문 금액은 서버에서 다시 확인했습니다. 결제수단과 필수 약관을 선택해주세요.'}</p>
          <span className="checkout-order-ref mono">ORDER · {order.id}</span>
        </div>
      </header>

      <div className="wrap checkout-order-layout">
        <section className="checkout-order-main card">
          {state === 'payable' && isBankTransfer ? (
            <div className="checkout-deposit" role="status">
              <h2>안내된 계좌로 입금해주세요</h2>
              {bankTransferAccount ? (
                <>
                  <dl className="checkout-deposit-account">
                    <div><dt>입금 은행</dt><dd>{bankTransferAccount.bank}</dd></div>
                    <div><dt>계좌번호</dt><dd className="mono">{bankTransferAccount.accountNumber}</dd></div>
                    <div><dt>예금주</dt><dd>{bankTransferAccount.holder}</dd></div>
                    <div><dt>입금 금액</dt><dd className="mono">{krw(order.total)}</dd></div>
                    <div>
                      <dt>입금자명</dt>
                      <dd className="mono">
                        {bankTransferDepositName(order.address?.recipientName ?? '', order.id)}
                      </dd>
                    </div>
                  </dl>
                  <p className="checkout-deposit-deadline">
                    {/* now는 마운트 뒤에 채워진다. 서버 렌더에서 시각을 읽으면
                        하이드레이션마다 값이 갈라진다. */}
                    남은 시간{' '}
                    <strong>
                      {now === null ? '확인 중' : bankTransferDeadlineLabel(order.expiresAt, now)}
                    </strong>
                  </p>
                  <p className="money-caption">
                    입금자명 끝의 주문코드를 지우지 말아주세요. 이름만 보내면 동명이인과 구분되지 않아
                    확인이 늦어집니다. 기한 안에 입금이 확인되지 않으면 주문은 자동 취소되고 재고는
                    복원됩니다.
                  </p>
                </>
              ) : (
                <p className="checkout-error" role="alert">
                  입금 계좌 안내를 불러오지 못했어요. 고객센터로 문의해주세요.
                </p>
              )}
            </div>
          ) : state === 'payable' && now === null ? (
            <div className="checkout-state-panel" role="status">결제 가능 시간을 확인하고 있어요.</div>
          ) : state === 'payable' && prepareState.prepared && preparedUsable ? (
            <>
              <div className="checkout-deadline" role="timer">
                <span>재고 선점 남은 시간</span>
                <strong className="mono">{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</strong>
              </div>
              <PreparedCheckoutAction prepared={prepareState.prepared} />
            </>
          ) : state === 'payable' && preparedExpired ? (
            <div className="checkout-state-panel" role="alert">
              <h2>결제 준비 시간이 지났어요</h2>
              <p>이 결제 action은 더 이상 사용할 수 없습니다. 주문 상세에서 취소한 뒤 새 주문을 만들어주세요.</p>
            </div>
          ) : state === 'payable' ? (
            <div className="checkout-state-panel" role="alert">
              <h2>결제를 준비해주세요</h2>
              <p>버튼을 누르면 로그인·주문 소유권·금액·재고 예약을 서버에서 다시 확인합니다.</p>
              <form action={prepareAction}>
                <input name="orderId" type="hidden" value={order.id} />
                <button className="btn btn-holo checkout-submit" disabled={preparePending}>
                  {preparePending ? '결제 준비 중' : '결제 준비하기'}
                </button>
              </form>
              {prepareState.error && (
                <p className="checkout-error">{prepareErrorCopy[prepareState.error]}</p>
              )}
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
              {state === 'complete' && <Link className="btn btn-holo" href={`/orders/${order.id}`}>주문 상세 보기</Link>}
            </div>
          )}
          {state === 'payable' && (
            <p className="checkout-cancel-link">
              결제하지 않으려면 <Link href={`/orders/${order.id}`}>주문 상세에서 취소</Link>해주세요.
            </p>
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
            <div><dt>굿즈 금액</dt><dd>{krw(order.total - order.shippingFee)}</dd></div>
            <div><dt>배송비</dt><dd>{shippingFeeLabel(order.shippingFee)}</dd></div>
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
