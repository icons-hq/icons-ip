'use client';

import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { ShipmentDetails } from '@/components/shop/ShipmentDetails';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import {
  prepareGoodsPaymentAction,
  type PrepareGoodsPaymentActionState,
} from '@/app/checkout/actions';
import { ReorderAction } from '@/components/checkout/ReorderAction';
import { ListingReturnLink } from '@/components/shell/ListingReturn';
import { PreparedCheckoutAction } from '@/components/payments/PreparedCheckoutAction';
import {
  checkoutOrderState,
  checkoutPaymentClosure,
  checkoutReorderMode,
  type CheckoutPaymentClosure,
} from '@/lib/checkout';
import { checkoutStatusCopy, closedPaymentCopy } from '@/lib/checkout-status-copy';
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
import { GoodsTransactionSummary } from '@/components/checkout/GoodsTransactionSummary';
import { transactionReceiptNames } from '@/lib/checkout-transaction';

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
  goods_sale_not_open: '굿즈의 판매기간이 시작되지 않았거나 종료되어 결제할 수 없습니다.',
  payment_closed: '이 주문으로는 다시 결제할 수 없어요. 주문 상태를 새로 불러오고 있어요.',
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
  /* "이 주문 취소하고 다시 주문하기"가 주문 취소까지 마쳤는지. 다시 담은 결과를 남기려고
     서버 상태를 새로 읽지 않으므로, 취소 전 안내가 남지 않게 이 값으로 문구를 바꾼다. */
  const [reorderCanceled, setReorderCanceled] = useState(false);
  /* 그 취소가 즉시 끝나지 않고 취소 요청으로 접수됐는지. 서버 상태를 다시 읽으면 액션과
     결과 안내가 사라지므로, 장바구니에 담지 않았다는 사실을 위쪽 안내로 남긴다. */
  const [reorderRequested, setReorderRequested] = useState(false);
  /* now는 마운트 뒤에 채워진다. 그 전(서버 렌더)에는 시간에 기대는 판정(시도 만료)을
     하지 않고, 시간과 무관한 판정(승인 거절·취소 요청)만 반영한다. */
  const closure = order.status === 'pending' ? checkoutPaymentClosure(order, now ?? 0) : null;
  const state = checkoutOrderState(
    order.status,
    order.paymentStatus,
    order.expiresAt,
    now ?? 0,
    closure,
    order.hasActiveCancellationRequest,
  );
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
  /* 즉시 취소가 확실한 주문에만 "취소하고 다시 주문하기"를 연다. 승인 거절과, 서버가 읽은
     시도의 유효 시간(expires_at)이 지난 prepared 시도가 해당한다. 시각을 모르는 첫 렌더에서는
     시도 만료를 단정하지 않는다. */
  const reorderMode = order.giftId ? null : checkoutReorderMode(order, state, now ?? 0);
  const closedCopy = activeClosure
    ? closedPaymentCopy(activeClosure, {
        orderExpiresAt: order.expiresAt,
        provider: prepareState.prepared?.provider ?? order.paymentAttempt?.provider ?? null,
        reorderMode,
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

  /* 확인 중과 결제 취소 진행은 서버에서 곧 바뀌는 상태라 짧게 다시 읽는다. 문구는 이
     폴링에 기대지 않는다 — 끝나는 시점을 약속하지 않는다. */
  const pollsServerState = state === 'checking' || state === 'refund_in_progress';

  useEffect(() => {
    if (!pollsServerState || pollAttempts >= 15) return;
    const timer = window.setTimeout(() => {
      setPollAttempts((attempts) => attempts + 1);
      router.refresh();
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [order.paymentStatus, order.status, pollAttempts, pollsServerState, router]);

  /* 화면을 연 뒤 다른 탭·콜백이 결제를 닫았다면 prepare가 그 사실을 알려준다.
     서버 상태를 다시 읽어 닫힌 결제 안내로 바꾼다. */
  useEffect(() => {
    if (prepareState.error === 'payment_closed') router.refresh();
  }, [prepareState, router]);

  /* 이 화면에서 준비한 결제가 유효 시간을 넘겼는데 처음 읽은 주문에는 그 시도가 없다.
     "취소하고 다시 주문하기"는 서버가 읽은 시도의 유효 시간으로만 판정하므로, 한 번 다시
     읽어 시도 만료 주문의 정리 액션을 연다. 다시 읽은 뒤에는 닫힌 결제라 반복되지 않는다. */
  useEffect(() => {
    if (preparedExpired && state === 'payable') router.refresh();
  }, [preparedExpired, router, state]);

  const isBankTransfer = order.paymentMethod === 'bank_transfer';

  const baseStatusCopy = checkoutStatusCopy({
    state,
    closedCopy,
    isBankTransfer,
    orderStatus: order.status,
    reorderMode,
    reorderCanceled,
    reorderRequested,
  });
  const statusCopy = order.giftId && (activeClosure || state === 'closed') && baseStatusCopy
    ? { ...baseStatusCopy, body: '선물함에서 이 선물의 주문 상태와 취소 요청을 확인해주세요. 새 선물은 받는 분의 수락과 배송지 확인을 다시 거쳐야 합니다.' }
    : baseStatusCopy;
  const giftReturn = order.giftId ? <Link className="btn btn-holo" href={`/gifts/${encodeURIComponent(order.giftId)}`}>선물함에서 확인하기</Link> : null;
  const markReorderCanceled = () => setReorderCanceled(true);
  const markReorderRequested = () => setReorderRequested(true);

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
              {/* 이 분기의 statusCopy는 closedCopy이고, 이 화면에서 주문을 취소한 뒤에는 취소 안내다. */}
              <h2>{statusCopy?.title ?? closedCopy.title}</h2>
              <p>{statusCopy?.body ?? closedCopy.body}</p>
              {giftReturn}
              {reorderMode && (
                <ReorderAction
                  mode={reorderMode}
                  onCanceled={markReorderCanceled}
                  onRequested={markReorderRequested}
                  orderId={order.id}
                />
              )}
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
              <span className="checkout-state-mark" aria-hidden>{state === 'complete' ? '✓' : pollsServerState ? '···' : '×'}</span>
              <h2>{statusCopy?.title}</h2>
              <p>{statusCopy?.body}</p>
              {pollsServerState && pollAttempts >= 15 && (
                <button className="btn btn-ghost" type="button" onClick={() => router.refresh()}>상태 다시 확인</button>
              )}
              {state === 'refund_in_progress' && (
                <Link className="btn btn-holo" href={`/orders/${order.id}`}>주문 상세 보기</Link>
              )}
              {state === 'checking' && (
                <>
                  <Link className="btn btn-ghost" href={`/orders/${order.id}`}>주문 상세 보기</Link>
                  <Link className="btn btn-ghost" href="/my/inquiries">1:1 문의</Link>
                </>
              )}
              {state === 'closed' && giftReturn}
              {state === 'closed' && reorderMode && (
                <ReorderAction
                  mode={reorderMode}
                  onCanceled={markReorderCanceled}
                  onRequested={markReorderRequested}
                  orderId={order.id}
                />
              )}
              {state === 'closed' && !order.giftId && (
                <ListingReturnLink className={reorderMode ? 'btn btn-ghost' : 'btn btn-holo'}>
                  {reorderMode ? undefined : '굿즈 다시 담기'}
                </ListingReturnLink>
              )}
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
              <div className="checkout-item" key={item.id}>
                <div><span>{item.type}</span><strong>{item.name}</strong>{item.variantName ? <span>{item.variantName}</span> : null}<GoodsCustomInputsSummary selection={item.customInputs} /></div>
                <span className="mono">{item.qty} × {krw(item.unitPrice)}</span>
              </div>
            ))}
          </div>
          {order.transaction ? <GoodsTransactionSummary display={order.transaction} names={transactionReceiptNames(order.transaction, order.items)} /> : <dl className="checkout-totals">
            {/* total 은 할인·배송비가 이미 반영된 청구액이다 — 굿즈 금액은 둘을 되돌려 복원한다. */}
            <div><dt>굿즈 금액</dt><dd>{krw(order.total - order.shippingFee + order.discountTotal + order.storeCreditTotal)}</dd></div>
            {order.discountTotal > 0 && (
              <div><dt>쿠폰 할인</dt><dd>−{krw(order.discountTotal)}</dd></div>
            )}
            {order.storeCreditTotal > 0 && <div><dt>적립금 사용</dt><dd>−{krw(order.storeCreditTotal)}</dd></div>}
            <div><dt>배송비</dt><dd>{shippingFeeLabel(order.shippingFee)}</dd></div>
            <div className="checkout-total"><dt>결제 금액</dt><dd>{krw(order.total)}</dd></div>
          </dl>}
          <ShipmentDetails shipments={order.shipments} items={order.items} transactionShipping={order.transaction?.shipping} />
          {order.address && (
            <div className="checkout-address-preview">
              <span>배송지</span>
              <strong>{order.address.recipientName} · {order.address.phone}</strong>
              <p>[{order.address.postalCode}] {order.address.address1} {order.address.address2}</p>
              {order.address.deliveryNote && <small>{order.address.deliveryNote}</small>}
            </div>
          )}
          {order.giftId && !order.address && <p>선물 받는 분이 입력한 주소로 배송됩니다. 주소와 연락처는 받는 분만 확인할 수 있어요.</p>}
        </aside>
      </div>
    </main>
  );
}
