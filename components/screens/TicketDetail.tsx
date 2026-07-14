import Link from 'next/link';
import { TicketCancellation } from '@/components/tickets/TicketCancellation';
import { TicketQrPager } from '@/components/tickets/TicketQrPager';
import { Icon } from '@/components/ui/Icon';
import {
  ticketOrderDisplayMeta,
  type TicketOrderDetail as TicketOrderDetailData,
  type TicketOrderListItem,
  type TicketStatus,
} from '@/lib/ticketing';

const krw = (value: number) => `₩${value.toLocaleString('ko-KR')}`;

function formatDateTime(value: string | null) {
  if (!value) return '일정 미정';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '일정 미정';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function ticketStatusLabel(status: TicketStatus) {
  return { valid: '사용 가능', used: '사용 완료', refunded: '환불 완료' }[status];
}

function paymentStatusLabel(
  status: string | null,
  orderStatus: TicketOrderDetailData['status'],
  refundStatus: string | null,
) {
  if (orderStatus === 'paid') return '결제 완료';
  if (orderStatus === 'canceled' && (refundStatus === 'done' || status === 'refunded')) return '환불 완료';
  if (orderStatus === 'canceled' && status) return '결제 취소 확인 중';
  if (status === 'paid') return '결제 완료';
  if (status === 'refunded') return '환불 완료';
  if (status === 'pending') return '결제 확인 중';
  if (status === 'failed') return '결제 실패';
  return '결제 내역 없음';
}

function asListItem(order: TicketOrderDetailData): TicketOrderListItem {
  return { ...order, ticketStatuses: order.tickets.map((ticket) => ticket.status) };
}

export function TicketDetail({
  now,
  order,
}: {
  now?: number;
  order: TicketOrderDetailData;
}) {
  const meta = ticketOrderDisplayMeta(asListItem(order), now);

  return (
    <main className="screen ticket-detail-page">
      <header className="ticket-detail-header">
        <div className="wrap">
          <Link className="ticket-detail-back" href="/tickets">
            <Icon name="chevronLeft" size={17} /> 내 티켓
          </Link>
          <span className={`ticket-status ticket-status--${meta.tone}`}>{meta.label}</span>
          <h1 className="h-xl">{order.eventTitle}</h1>
          <p>{meta.title} {meta.body}</p>
          <div className="ticket-detail-meta mono">
            <span>{order.ticketTypeName}</span>
            <span aria-hidden>·</span>
            <span>{order.qty}매</span>
          </div>
        </div>
      </header>

      <div className="wrap ticket-detail-layout">
        <section className="ticket-detail-main card">
          <TicketQrPager
            cancellationStatus={order.cancellationRequest?.status ?? null}
            orderStatus={order.status}
            tickets={order.tickets}
          />

          <section className="ticket-state-list" aria-labelledby="ticket-state-heading">
            <div className="checkout-section-heading checkout-section-heading--compact">
              <span className="checkout-step mono">TICKETS</span>
              <h2 id="ticket-state-heading">티켓별 상태</h2>
            </div>
            <ol>
              {order.tickets.map((ticket, index) => (
                <li key={ticket.id}>
                  <span>티켓 {index + 1}</span>
                  <strong className={`ticket-unit-status ticket-unit-status--${ticket.status}`}>
                    {ticketStatusLabel(ticket.status)}
                  </strong>
                </li>
              ))}
            </ol>
          </section>

          <TicketCancellation now={now} order={order} />
        </section>

        <aside className="ticket-detail-receipt card" aria-label="예매 정보">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">BOOKING</span>
            <h2>예매 정보</h2>
          </div>
          <dl className="ticket-booking-summary">
            <div><dt>이벤트</dt><dd>{order.eventTitle}</dd></div>
            <div><dt>회차</dt><dd>{order.ticketTypeName}</dd></div>
            <div><dt>시작</dt><dd><time dateTime={order.startsAt ?? undefined}>{formatDateTime(order.startsAt)}</time></dd></div>
            {order.endsAt && <div><dt>종료</dt><dd><time dateTime={order.endsAt}>{formatDateTime(order.endsAt)}</time></dd></div>}
            <div><dt>장소</dt><dd>{order.location ?? '장소 미정'}</dd></div>
            <div><dt>수량</dt><dd>{order.qty}매</dd></div>
            <div><dt>결제 상태</dt><dd>{paymentStatusLabel(order.paymentStatus, order.status, order.refund?.status ?? null)}</dd></div>
            <div className="ticket-booking-total"><dt>결제 금액</dt><dd>{krw(order.total)}</dd></div>
          </dl>
          {order.refund && (
            <section className="ticket-refund-summary" aria-labelledby="ticket-refund-heading">
              <h3 id="ticket-refund-heading">환불 상태</h3>
              <dl>
                <div><dt>상태</dt><dd>{order.refund.status === 'done' ? '환불 완료' : '환불 확인 중'}</dd></div>
                <div><dt>금액</dt><dd>{krw(order.refund.amount)}</dd></div>
              </dl>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
