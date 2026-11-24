import Link from 'next/link';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { ListingReturnLink } from '@/components/shell/ListingReturn';
import { BankTransferDeadlineGate } from '@/components/checkout/BankTransferDeadline';
import { BANK_TRANSFER_EXPIRED_COPY } from '@/lib/checkout-status-copy';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import { krw } from '@/lib/format';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { CopyAccountButton } from '@/components/checkout/CopyAccountButton';
import { tossBankLabel } from '@/lib/payments/toss-bank-codes';
import { VIRTUAL_ACCOUNT_COPY, type OrderVirtualAccount } from '@/lib/payments/virtual-account';
import { bankTransferDeadlinePassed, bankTransferDepositName, bankTransferDepositNameWithCode, type BankTransferAccount } from '@/lib/payments/bank-transfer';

/**
 * 완료 화면을 그릴지, 어디로 보낼지. 결제 콜백·무통장 접수 뒤에 오는 화면이지만 주소는 누구나
 * 다시 열 수 있으므로 주문 원장으로 판정한다.
 * - 선물: 결제자에게 원 주문 행을 보이지 않는 선물 주문은 선물함이 정본이다.
 * - 카드 결제 완료(결제 원장 paid, 주문이 결제 완료 이후 단계): 완료 화면.
 * - 무통장 입금 대기(접수 = 주문 완료): 완료 화면 + 입금 안내. 입금 확인 뒤에는 결제 완료와 같다.
 * - 토스 가상계좌 입금 대기(카드 주문인데 결제 시도가 awaiting_deposit): 완료 화면 + 입금 안내(ADR-0049). 입금 확인 뒤에는 결제 완료와 같다.
 * - 그 밖(결제 전 카드 주문·결제 취소 진행·취소·기한 경과): 주문 상세.
 */
export type OrderCompleteDestination =
  | { readonly kind: 'paid' }
  /** `deadlinePassed`: 기한이 지났지만 아직 자동 취소 전이라 pending인 무통장 주문. 계좌를 안내하지 않는다. */
  | { readonly kind: 'deposit'; readonly deadlinePassed: boolean }
  /** 토스 가상계좌 입금 대기. `checking`은 기한이 지났거나 결제사 확인 중이라 계좌를 다시 약속하지 않는다. */
  | { readonly kind: 'virtual_account'; readonly state: 'awaiting' | 'checking' }
  | { readonly kind: 'redirect'; readonly href: string };

export function orderCompleteDestination(
  order: Pick<CheckoutOrderSnapshot, 'id' | 'giftId' | 'status' | 'paymentMethod' | 'paymentStatus' | 'expiresAt'>,
  now: number = Date.now(),
  virtualAccount: Pick<OrderVirtualAccount, 'state'> | null = null,
): OrderCompleteDestination {
  if (order.giftId) return { kind: 'redirect', href: `/gifts/${encodeURIComponent(order.giftId)}` };
  const detail = { kind: 'redirect', href: `/orders/${order.id}` } as const;
  if (order.status === 'canceled') return detail;
  if (order.status === 'pending') {
    if (order.paymentMethod === 'card' && virtualAccount && (virtualAccount.state === 'awaiting' || virtualAccount.state === 'checking')) {
      return { kind: 'virtual_account', state: virtualAccount.state };
    }
    return order.paymentMethod === 'bank_transfer' && order.paymentStatus === null
      ? { kind: 'deposit', deadlinePassed: bankTransferDeadlinePassed(order.expiresAt, now) }
      : detail;
  }
  return order.paymentStatus === 'paid' ? { kind: 'paid' } : detail;
}

interface OrderCompleteProps {
  order: CheckoutOrderSnapshot;
  /** 무통장 입금 대기 주문에만 실린다. 서버 설정에 계좌가 없으면 null. */
  bankTransferAccount: BankTransferAccount | null;
  /** 서버가 그릴 때 이미 입금 기한이 지났는지(orderCompleteDestination). 첫 렌더 판정에 쓴다. */
  depositDeadlinePassed?: boolean;
  /** 토스 가상계좌 입금 대기 주문에만 실린다(orderCompleteDestination이 virtual_account일 때). */
  virtualAccount?: OrderVirtualAccount | null;
}

export function OrderComplete({ order, bankTransferAccount, depositDeadlinePassed = false, virtualAccount = null }: OrderCompleteProps) {
  const awaitingDeposit = order.status === 'pending' && order.paymentMethod === 'bank_transfer';
  const vaDeposit = order.status === 'pending' && order.paymentMethod === 'card'
    && virtualAccount && (virtualAccount.state === 'awaiting' || virtualAccount.state === 'checking')
    ? virtualAccount : null;
  const vaDue = vaDeposit ? formatOrderDateTime(vaDeposit.dueAt) : '';
  /* 기한이 지났지만 아직 정리(자동 취소) 전인 무통장 주문은 계좌를 안내하지 않는다. 화면을 연 채
     기한이 지나도 클라이언트가 안내를 닫는다(BankTransferDeadlineGate). */
  const deadline = order.expiresAt ? formatOrderDateTime(order.expiresAt) : '';
  const total = order.transaction?.totals.onlineTotal ?? order.total;
  const collectShipping = order.transaction?.totals.collectShippingTotal ?? 0;

  return (
    <main className="wc-root wc-receipt checkout-page checkout-order-page order-complete-page">
      <header className="wc-receipt__head">
        <div className="wrap">
          {vaDeposit ? (
            vaDeposit.state === 'awaiting' ? (
              <>
                <h1 className="wc-receipt__title">주문이 접수됐어요</h1>
                <p className="wc-receipt__subcopy">아래 계좌로 기한 안에 입금하면 결제가 완료돼요.</p>
              </>
            ) : (
              <>
                <h1 className="wc-receipt__title">입금을 확인하고 있어요</h1>
                <p className="wc-receipt__subcopy" role="status">입금 기한이 지났거나 결제사에서 상태를 확인하는 중이에요. 이미 입금하셨다면 확인되는 대로 자동으로 반영돼요.</p>
              </>
            )
          ) : awaitingDeposit ? (
            <BankTransferDeadlineGate
              expiresAt={order.expiresAt}
              initiallyPassed={depositDeadlinePassed}
              expired={(
                <>
                  <h1 className="wc-receipt__title">{BANK_TRANSFER_EXPIRED_COPY.title}</h1>
                  <p className="wc-receipt__subcopy" role="alert">{BANK_TRANSFER_EXPIRED_COPY.body}</p>
                </>
              )}
            >
              <h1 className="wc-receipt__title">주문이 접수됐어요</h1>
              <p className="wc-receipt__subcopy">아래 계좌로 기한 안에 입금하면 확인 후 주문이 확정돼요.</p>
            </BankTransferDeadlineGate>
          ) : (
            <>
              <h1 className="wc-receipt__title">주문이 완료됐어요</h1>
              <p className="wc-receipt__subcopy">결제가 확인됐어요. 배송 진행은 주문 상세에서 확인할 수 있어요.</p>
            </>
          )}
          <span className="checkout-order-ref mono">주문번호 {orderReferenceLabel(order.id, order.orderNumber)}</span>
        </div>
      </header>

      <div className="wrap checkout-order-layout">
        <section className="checkout-order-main card" aria-labelledby="order-complete-summary">
          <h2 id="order-complete-summary">주문 요약</h2>
          <dl className="checkout-totals">
            <div><dt>주문번호</dt><dd className="mono">{orderReferenceLabel(order.id, order.orderNumber)}</dd></div>
            <div className="checkout-total"><dt>{vaDeposit ? '입금할 금액' : awaitingDeposit ? (depositDeadlinePassed ? '주문 금액' : '입금할 금액') : '최종 결제 금액'}</dt><dd>{krw(vaDeposit ? vaDeposit.amount : total)}</dd></div>
            {collectShipping > 0 && <div><dt>착불 배송비(받을 때 결제)</dt><dd>{krw(collectShipping)}</dd></div>}
            <div>
              <dt>{vaDeposit || awaitingDeposit ? '입금 기한' : '결제 일시'}</dt>
              <dd>{vaDeposit ? vaDue || '기한 정보 없음' : awaitingDeposit ? deadline || '기한 정보 없음' : order.paidAt ? formatOrderDateTime(order.paidAt) : '확인 중'}</dd>
            </div>
          </dl>

          {vaDeposit && (
            <div className="checkout-deposit" role="status">
              {vaDeposit.state === 'awaiting' ? (
                <BankTransferDeadlineGate
                  expiresAt={vaDeposit.dueAt}
                  initiallyPassed={false}
                  expired={<p className="money-caption" role="alert">입금 기한이 지났어요. 이미 입금하셨다면 확인되는 대로 자동으로 반영돼요.</p>}
                >
                  <h2>안내된 계좌로 입금해주세요</h2>
                  <dl className="checkout-deposit-account">
                    <div><dt>입금 은행</dt><dd>{tossBankLabel(vaDeposit.bankCode)}</dd></div>
                    <div>
                      <dt>계좌번호</dt>
                      <dd><span className="mono">{vaDeposit.accountNumber}</span> <CopyAccountButton value={vaDeposit.accountNumber} /></dd>
                    </div>
                    <div><dt>입금 금액</dt><dd className="mono">{krw(vaDeposit.amount)}</dd></div>
                    <div><dt>입금 기한</dt><dd>{vaDue || '기한 정보 없음'}</dd></div>
                  </dl>
                  <p className="money-caption">{VIRTUAL_ACCOUNT_COPY.depositNote}</p>
                  <p className="money-caption">{VIRTUAL_ACCOUNT_COPY.deadlineNote}</p>
                  <p className="money-caption">{VIRTUAL_ACCOUNT_COPY.autoCheckNote}</p>
                  {vaDeposit.useEscrow && <p className="money-caption">{VIRTUAL_ACCOUNT_COPY.escrowNote}</p>}
                </BankTransferDeadlineGate>
              ) : (
                <>
                  <h2>입금 상태를 확인하고 있어요</h2>
                  <p className="money-caption">{VIRTUAL_ACCOUNT_COPY.autoCheckNote}</p>
                  <p className="money-caption">기한 안에 입금되지 않았다면 주문은 자동으로 취소돼요.</p>
                </>
              )}
            </div>
          )}

          {awaitingDeposit && (
            <BankTransferDeadlineGate expiresAt={order.expiresAt} initiallyPassed={depositDeadlinePassed} expired={null}>
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
                      <dd className="mono">{order.depositCode ? bankTransferDepositNameWithCode(order.address?.recipientName ?? '', order.depositCode) : bankTransferDepositName(order.address?.recipientName ?? '', order.orderNumber ?? order.id)}</dd>
                    </div>
                  </dl>
                  <p className="money-caption">
                    입금자명 끝의 주문코드를 지우지 말아주세요. 기한{deadline ? `(${deadline})` : ''} 안에 입금이 확인되지 않으면 주문은 자동 취소돼요.
                  </p>
                </>
              ) : (
                <p className="checkout-error" role="alert">입금 계좌 안내를 불러오지 못했어요. 고객센터로 문의해주세요.</p>
              )}
            </div>
            </BankTransferDeadlineGate>
          )}

          <div className="order-complete-actions">
            <Link className="btn btn-holo" href={`/orders/${order.id}`}>주문 상세</Link>
            <ListingReturnLink className="btn btn-ghost">쇼핑 계속</ListingReturnLink>
          </div>
        </section>

        <aside className="checkout-receipt card" aria-label="주문한 상품">
          <h2>주문한 상품</h2>
          <div className="checkout-items">
            {order.items.map((item) => (
              <div className="checkout-item" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  {item.variantName ? <span>{item.variantName}</span> : null}
                  <GoodsCustomInputsSummary selection={item.customInputs} />
                </div>
                <span className="mono">{item.qty}개</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
