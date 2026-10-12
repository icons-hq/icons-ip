'use client';

import { ShipmentDetails } from '@/components/shop/ShipmentDetails';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import {
  prepareGoodsPaymentAction,
  type PrepareGoodsPaymentActionState,
} from '@/app/checkout/actions';
import { PreparedCheckoutAction } from '@/components/payments/PreparedCheckoutAction';
import {
  checkoutDeadlineTimeLabel,
  checkoutOrderState,
  checkoutPaymentClosure,
  type CheckoutPaymentClosure,
} from '@/lib/checkout';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import { krw } from '@/lib/format';
import {
  bankTransferDeadlineLabel,
  bankTransferDepositName,
  type BankTransferAccount,
} from '@/lib/payments/bank-transfer';
import { paymentFailNoticeCopy } from '@/lib/payments/checkout-fail-copy';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { shippingFeeLabel } from '@/lib/shipping';

interface CheckoutOrderProps {
  order: CheckoutOrderSnapshot;
  /** 무통장 주문에만 실린다. 서버 설정에 계좌가 없으면 null(#255). */
  bankTransferAccount?: BankTransferAccount | null;
  /** 토스 failUrl 쿼리에서 서버가 형식 검증까지 마친 실패 코드. */
  paymentFailCode?: string | null;
}

const emptyPrepareState: PrepareGoodsPaymentActionState = {};

const prepareErrorCopy: Record<NonNullable<PrepareGoodsPaymentActionState['error']>, string> = {
  auth_required: '로그인 상태를 다시 확인한 뒤 결제를 준비해주세요.',
  not_found: '이 주문을 확인할 수 없습니다.',
  not_payable: '이 주문은 더 이상 결제할 수 없습니다.',
  payment_closed: '이 주문으로는 다시 결제할 수 없어요. 주문 상태를 새로 불러오고 있어요.',
  payment_unavailable: '결제 환경을 준비 중입니다. 잠시 후 다시 시도해주세요.',
};

interface StatusCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * 같은 주문으로 결제를 다시 시작할 수 없는 주문의 안내. "잠시 후 다시 시도"처럼
 * 반복해도 풀리지 않는 약속을 하지 않고, 실제로 일어나는 다음 일을 말한다.
 */
function closedPaymentCopy(
  closure: CheckoutPaymentClosure,
  { orderExpiresAt, provider }: { orderExpiresAt: string | null; provider: string | null },
): StatusCopy {
  if (closure === 'not_approved') {
    return {
      title: '이 주문은 다시 결제할 수 없어요',
      body: '결제가 승인되지 않았어요. 같은 주문으로는 다시 결제할 수 없으니 이 주문을 취소하고 같은 굿즈로 다시 주문해주세요. 취소하면 재고와 사용한 쿠폰·적립금이 바로 돌아와요.',
    };
  }
  if (closure === 'cancellation_requested') {
    return {
      title: '취소 요청을 처리하고 있어요',
      body: '이 주문에는 처리 중인 취소 요청이 있어 결제를 진행할 수 없어요. 진행 상태는 주문 상세에서 확인할 수 있어요.',
    };
  }
  const deadline = checkoutDeadlineTimeLabel(orderExpiresAt);
  /* 토스는 인증 뒤 10분 안에 승인 API를 부르지 않으면 결제가 EXPIRED로 끝난다(문서
     127). 시간이 지난 시도는 콜백이 와도 claim이 거절해 승인 API를 부르지 않는다.
     다른 provider는 같은 근거를 확인하지 않았으므로 청구 여부를 단정하지 않는다. */
  const charge = provider === 'toss' ? ' 결제는 진행되지 않았고 청구된 금액은 없어요.' : '';
  return {
    title: '결제 가능 시간이 지났어요',
    body: `결제 준비 후 유효 시간이 지나 이 주문으로는 결제할 수 없어요.${charge} 주문은 결제 기한${deadline ? `(${deadline})` : ''}이 지나면 몇 분 안에 자동으로 취소되고, 재고와 사용한 쿠폰·적립금이 돌아와요. 그다음 다시 주문해주세요.`,
  };
}

function checkoutStatusCopy({
  state,
  closedCopy,
  isBankTransfer,
  orderStatus,
  closedAwaitsSweep,
}: {
  state: ReturnType<typeof checkoutOrderState>;
  closedCopy: StatusCopy | null;
  isBankTransfer: boolean;
  orderStatus: string;
  closedAwaitsSweep: boolean;
}): StatusCopy | null {
  if (state === 'complete') return { title: '결제가 확인됐어요', body: '주문이 안전하게 접수됐습니다. 배송 진행은 주문 내역에서 이어서 확인할 수 있어요.' };
  /* 웹훅·재정합 설정과 무관하게 지킬 수 있는 말만 한다 — "닫아도 확인은 계속된다"는
     자동 재정합 경로가 열려 있을 때만 참이다. */
  if (state === 'checking') return { title: '결제를 확인하고 있어요', body: '결제사 승인 결과를 아직 확정하지 못했어요. 확인이 늦어지거나 결제 금액이 빠져나갔다면 고객센터 1:1 문의로 알려주세요.' };
  if (closedCopy) return closedCopy;
  if (state === 'closed') {
    if (isBankTransfer) {
      return { title: '입금 기한이 지났어요', body: '선점된 재고는 자동으로 복원됩니다. 기한이 지난 뒤 입금하셨다면 고객센터 문의로 알려주세요 — 주문은 되살아나지 않고 입금액을 반환해 드립니다.' };
    }
    if (orderStatus === 'canceled') {
      return { title: '취소된 주문이에요', body: '이 주문은 취소됐어요. 같은 굿즈를 다시 담아 새로 주문할 수 있어요.' };
    }
    return closedAwaitsSweep
      ? { title: '결제 가능한 시간이 지났어요', body: '이 주문으로는 더 이상 결제할 수 없어요. 주문은 몇 분 안에 자동으로 취소되고, 재고와 사용한 쿠폰·적립금이 돌아와요. 그다음 다시 주문해주세요.' }
      : { title: '결제 가능한 시간이 지났어요', body: '이 주문으로는 더 이상 결제할 수 없어요. 주문을 취소하면 재고와 사용한 쿠폰·적립금이 바로 돌아와요. 같은 굿즈로 다시 주문해주세요.' };
  }
  if (isBankTransfer) return { title: '입금 정보를 확인하세요', body: '주문 금액과 입금자명을 확인하고 안내된 계좌로 기한 안에 입금해주세요.' };
  return null;
}

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

export function CheckoutOrder({
  order,
  bankTransferAccount = null,
  paymentFailCode = null,
}: CheckoutOrderProps) {
  const router = useRouter();
  const [prepareState, prepareAction, preparePending] = useActionState(
    prepareGoodsPaymentAction,
    emptyPrepareState,
  );
  const [pollAttempts, setPollAttempts] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  /* now는 마운트 뒤에 채워진다. 그 전(서버 렌더)에는 시간에 기대는 판정(시도 만료)을
     하지 않고, 시간과 무관한 판정(승인 거절·취소 요청)만 반영한다. */
  const closure = order.status === 'pending' ? checkoutPaymentClosure(order, now ?? 0) : null;
  const state = checkoutOrderState(order.status, order.paymentStatus, order.expiresAt, now ?? 0, closure);
  const effectiveExpiry = order.expiresAt
    ? effectiveGoodsCheckoutExpiry(order.expiresAt, prepareState.prepared?.expiresAt)
    : 0;
  const preparedUsable = now !== null && preparedGoodsCheckoutUsable(
    prepareState.prepared,
    order.expiresAt,
    now,
  );
  const preparedExpired = Boolean(prepareState.prepared && now !== null && !preparedUsable);
  /* 이 화면에서 준비한 결제가 시간을 넘기면 서버 스냅샷에는 아직 시도가 없을 수 있다.
     그래도 사실은 같다 — 시도 유효 시간이 지났다. */
  const activeClosure: CheckoutPaymentClosure | null = state === 'payment_closed'
    ? closure
    : state === 'payable' && preparedExpired ? 'attempt_expired' : null;
  const closedCopy = activeClosure
    ? closedPaymentCopy(activeClosure, {
        orderExpiresAt: order.expiresAt,
        provider: prepareState.prepared?.provider ?? order.paymentAttempt?.provider ?? null,
      })
    : null;
  /* 같은 주문으로 결제를 다시 준비할 수 있을 때만 failUrl 안내가 재시도를 약속한다.
     시각을 모르는 첫 렌더에서는 약속하지 않는다. */
  const sameOrderRetry = now !== null && state === 'payable' && !preparedExpired;
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

  /* 화면을 연 뒤 다른 탭·콜백이 결제를 닫았다면 prepare가 그 사실을 알려준다.
     서버 상태를 다시 읽어 닫힌 결제 안내로 바꾼다. */
  useEffect(() => {
    if (prepareState.error === 'payment_closed') router.refresh();
  }, [prepareState, router]);

  const isBankTransfer = order.paymentMethod === 'bank_transfer';
  /* 결제 기한이 지난 카드 주문에 시도가 남아 있으면(prepared) 고객 취소도 담당자 확인으로
     넘어가므로, 만료 sweep이 닫을 때까지 기다리라고 안내한다. */
  const closedAwaitsSweep = order.status === 'pending' && order.paymentAttempt?.state === 'prepared';

  const statusCopy = checkoutStatusCopy({
    state,
    closedCopy,
    isBankTransfer,
    orderStatus: order.status,
    closedAwaitsSweep,
  });

  return (
    <main className="wc-root wc-receipt checkout-page checkout-order-page">
      <header className="wc-receipt__head">
        <div className="wrap">
          <h1 className="wc-receipt__title">{statusCopy?.title ?? '결제수단을 선택하세요'}</h1>
          <p className="wc-receipt__subcopy">{statusCopy?.body ?? '주문 금액은 서버에서 다시 확인했습니다. 결제수단과 필수 약관을 선택해주세요.'}</p>
          {/* 토스 failUrl은 이 주문 화면으로 돌아온다 — 안내가 가리키는 "같은
              주문"이 지금 보고 있는 주문이라 재시도 경로가 어긋나지 않는다. */}
          {paymentFailCode && (
            <p className="checkout-error" role="alert">
              {paymentFailNoticeCopy(paymentFailCode, { sameOrderRetry })}
            </p>
          )}
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
              {/* 남은 시간은 주문 선점 기한과 이 결제 준비의 유효 시간 중 이른 쪽이다. */}
              <div className="checkout-deadline" role="timer">
                <span>결제 가능 남은 시간</span>
                <strong className="mono">{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</strong>
              </div>
              {/* 판매 제한(19금) 상품 포함 주문은 전용 PG로 파생된다(#392).
                  서버 prepare의 파생 결과가 진실원이라 provider로 판별한다. */}
              {prepareState.prepared.provider === 'korpay' && (
                <p className="money-caption" role="status">
                  19금 굿즈가 포함된 주문은 결제수단이 신용카드로 제한됩니다.
                </p>
              )}
              <PreparedCheckoutAction prepared={prepareState.prepared} />
            </>
          ) : activeClosure && closedCopy ? (
            <div className="checkout-state-panel checkout-state-panel--payment-closed" role="alert">
              <h2>{closedCopy.title}</h2>
              <p>{closedCopy.body}</p>
              <Link className="btn btn-ghost" href={`/orders/${order.id}`}>주문 상세 보기</Link>
            </div>
          ) : state === 'payable' ? (
            <div className="checkout-state-panel" role="alert">
              <h2>결제를 준비해주세요</h2>
              <p>버튼을 누르면 로그인·주문 소유권·금액·재고 예약을 서버에서 다시 확인합니다. 결제 준비 후 10분 안에 결제를 마쳐주세요.</p>
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
              {state === 'checking' && (
                <>
                  <Link className="btn btn-ghost" href={`/orders/${order.id}`}>주문 상세 보기</Link>
                  <Link className="btn btn-ghost" href="/my/inquiries">1:1 문의</Link>
                </>
              )}
              {state === 'closed' && <Link className="btn btn-holo" href="/shop">굿즈 다시 담기</Link>}
              {state === 'closed' && !isBankTransfer && (
                <Link className="btn btn-ghost" href={`/orders/${order.id}`}>주문 상세 보기</Link>
              )}
              {state === 'complete' && <Link className="btn btn-holo" href={`/orders/${order.id}`}>주문 상세 보기</Link>}
            </div>
          )}
          {state === 'payable' && !activeClosure && (
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
              <div className="checkout-item" key={`${item.goodId}:${item.variantId ?? "default"}`}>
                <div><span>{item.type}</span><strong>{item.name}</strong>{item.variantName ? <span>{item.variantName}</span> : null}</div>
                <span className="mono">{item.qty} × {krw(item.unitPrice)}</span>
              </div>
            ))}
          </div>
          <dl className="checkout-totals">
            {/* total 은 할인·배송비가 이미 반영된 청구액이다 — 굿즈 금액은 둘을 되돌려 복원한다. */}
            <div><dt>굿즈 금액</dt><dd>{krw(order.total - order.shippingFee + order.discountTotal + order.storeCreditTotal)}</dd></div>
            {order.discountTotal > 0 && (
              <div><dt>쿠폰 할인</dt><dd>−{krw(order.discountTotal)}</dd></div>
            )}
            {order.storeCreditTotal > 0 && <div><dt>적립금 사용</dt><dd>−{krw(order.storeCreditTotal)}</dd></div>}
            <div><dt>배송비</dt><dd>{shippingFeeLabel(order.shippingFee)}</dd></div>
            <div className="checkout-total"><dt>결제 금액</dt><dd>{krw(order.total)}</dd></div>
          </dl>
          <ShipmentDetails shipments={order.shipments} items={order.items} />
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
