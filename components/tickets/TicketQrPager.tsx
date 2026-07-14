'use client';

import Image from 'next/image';
import { useState } from 'react';
import {
  isActiveTicketCancellation,
  ticketCanShowQr,
  type TicketCancellationStatus,
  type TicketOrderStatus,
  type TicketSummary,
} from '@/lib/ticketing';

export function TicketQrPager({
  cancellationStatus,
  orderStatus,
  tickets,
}: {
  cancellationStatus: TicketCancellationStatus | null;
  orderStatus: TicketOrderStatus;
  tickets: TicketSummary[];
}) {
  const usableTickets = tickets.filter((ticket) => (
    ticketCanShowQr(orderStatus, ticket.status, cancellationStatus)
  ));
  const [current, setCurrent] = useState(0);

  const ticket = usableTickets[current] ?? usableTickets[0];
  if (!ticket) {
    const message = isActiveTicketCancellation(cancellationStatus)
      ? '취소·환불 확인 중에는 QR을 사용할 수 없어요.'
      : orderStatus === 'pending'
        ? '결제 확인이 끝나면 이곳에 QR이 표시됩니다.'
        : '현재 사용할 수 있는 QR이 없습니다.';
    return (
      <div className="ticket-qr-empty" role="status">
        <span aria-hidden>QR</span>
        <h2>QR을 표시할 수 없어요</h2>
        <p>{message}</p>
      </div>
    );
  }

  const position = usableTickets.indexOf(ticket);
  return (
    <section className="ticket-qr-pager" aria-labelledby="ticket-qr-heading">
      <div className="ticket-qr-heading">
        <div>
          <span className="checkout-step mono">ENTRY QR</span>
          <h2 id="ticket-qr-heading">현장 입장 QR</h2>
        </div>
        <strong className="mono">{position + 1} / {usableTickets.length}</strong>
      </div>
      <div className="ticket-qr-frame">
        <Image
          alt={`티켓 ${position + 1} 입장 QR`}
          height={288}
          preload
          src={`/api/tickets/${ticket.id}/qr`}
          unoptimized
          width={288}
        />
      </div>
      <p className="ticket-qr-notice">QR은 입장 직전에 열고, 한 장씩 현장 스태프에게 제시해주세요.</p>
      {usableTickets.length > 1 && (
        <div className="ticket-qr-controls">
          <button
            className="btn btn-ghost"
            disabled={position === 0}
            onClick={() => setCurrent(Math.max(0, position - 1))}
            type="button"
          >
            이전 티켓
          </button>
          <button
            className="btn btn-ghost"
            disabled={position === usableTickets.length - 1}
            onClick={() => setCurrent(Math.min(usableTickets.length - 1, position + 1))}
            type="button"
          >
            다음 티켓
          </button>
        </div>
      )}
    </section>
  );
}
