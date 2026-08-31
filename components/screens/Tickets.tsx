import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import {
  groupTicketOrders,
  ticketOrderDisplayMeta,
  type TicketOrderGroup,
  type TicketOrderListItem,
} from '@/lib/ticketing';

const groupCopy: Record<TicketOrderGroup, { title: string; description: string }> = {
  usable: { title: '사용 가능한 티켓', description: '현장에서 QR로 입장할 수 있어요.' },
  current: { title: '진행 중인 예매', description: '결제 또는 취소·환불 상태를 확인하세요.' },
  past: { title: '지난 티켓', description: '사용 또는 취소가 끝난 예매입니다.' },
};

/** Korpay confirm 콜백(/api/payments/tickets/confirm)이 /tickets?payment=…로 붙이는 결과값. */
export type TicketsPaymentResult = 'approved' | 'checking' | 'failed';

const paymentResultCopy: Record<TicketsPaymentResult, { title: string; body: string }> = {
  approved: {
    title: '결제가 확인됐어요',
    body: '예매가 안전하게 접수됐습니다. 사용 가능한 티켓에서 전자티켓 QR을 열 수 있어요.',
  },
  checking: {
    title: '결제를 확인하고 있어요',
    body: '결제사 확인 결과와 서버 원장을 대조하고 있습니다. 잠시 후 이 페이지를 새로고침하면 최신 상태가 반영돼요.',
  },
  failed: {
    title: '결제가 완료되지 않았어요',
    body: '결제가 승인되지 않아 예매가 확정되지 않았습니다. 이벤트 페이지에서 다시 예매할 수 있어요.',
  },
};

function eventSchedule(startsAt: string | null) {
  if (!startsAt) return '일정 미정';
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return '일정 미정';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function Tickets({
  orders,
  now,
  paymentResult,
}: {
  orders: TicketOrderListItem[];
  now?: number;
  paymentResult?: TicketsPaymentResult;
}) {
  const groups = groupTicketOrders(orders, now);

  return (
    <main className="wc-root wc-receipt tickets-page">
      <header className="wc-receipt__head">
        <div className="wrap">
          <h1 className="wc-receipt__title">내 티켓</h1>
          <p className="wc-receipt__subcopy">예매 상태를 확인하고, 사용 가능한 전자티켓 QR을 열어보세요.</p>
        </div>
      </header>

      <div className="wrap tickets-content">
        {paymentResult && (
          <div
            className={`tickets-payment-banner tickets-payment-banner--${paymentResult}`}
            role={paymentResult === 'failed' ? 'alert' : 'status'}
          >
            <strong>{paymentResultCopy[paymentResult].title}</strong>
            <p>{paymentResultCopy[paymentResult].body}</p>
            {paymentResult === 'checking' && (
              <p>
                시간이 지나도 예매에 반영되지 않으면 고객센터{' '}
                <Link href="/my/inquiries">1:1 문의</Link>로 알려주세요.
              </p>
            )}
          </div>
        )}
        {orders.length === 0 ? (
          <div className="tickets-empty card">
            <div className="tickets-empty-icon" aria-hidden><Icon name="event" size={30} /></div>
            <h2>아직 예매한 티켓이 없어요</h2>
            <p>다가오는 오프라인 팝업과 예매 가능한 회차를 확인해보세요.</p>
            <Link className="btn btn-holo" href="/offline-popups">오프라인 팝업 둘러보기</Link>
          </div>
        ) : (
          (Object.keys(groupCopy) as TicketOrderGroup[]).map((group) => {
            const items = groups[group];
            if (items.length === 0) return null;
            const copy = groupCopy[group];
            return (
              <section className="tickets-group" key={group} aria-labelledby={`tickets-${group}-heading`}>
                <div className="tickets-group-heading">
                  <div>
                    <h2 id={`tickets-${group}-heading`}>{copy.title}</h2>
                    <p>{copy.description}</p>
                  </div>
                  <span className="mono">{items.length}건</span>
                </div>
                <ol className="tickets-list">
                  {items.map((order) => {
                    const meta = ticketOrderDisplayMeta(order, now);
                    return (
                      <li key={order.id}>
                        <Link className="ticket-list-link card" href={`/tickets/${order.id}`}>
                          <div className="ticket-list-event">
                            <span className="mono">{eventSchedule(order.startsAt)}</span>
                            <strong>{order.eventTitle}</strong>
                            <small>{order.ticketTypeName} · {order.qty}매</small>
                          </div>
                          <span className={`ticket-status ticket-status--${meta.tone}`}>{meta.label}</span>
                          <span className="ticket-list-location">{order.location ?? '장소 미정'}</span>
                          <span className="ticket-list-arrow" aria-hidden><Icon name="chevronRight" size={18} /></span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })
        )}
      </div>
    </main>
  );
}
