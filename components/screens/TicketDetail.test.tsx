import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TicketDetail } from './TicketDetail';
import type { TicketOrderDetail } from '../../lib/ticketing';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => <span aria-hidden /> }));
vi.mock('@/components/tickets/TicketQrPager', () => ({
  TicketQrPager: (props: Record<string, unknown>) => <div data-qr-pager={JSON.stringify(props)} />,
}));
vi.mock('@/components/tickets/TicketCancellation', () => ({
  TicketCancellation: ({ order }: { order: TicketOrderDetail }) => <div data-cancellation-order={order.id} />,
}));

const order: TicketOrderDetail = {
  id: '5cbcbfed-202d-4676-821a-7706398e57c0',
  eventId: 'maple-popup',
  eventTitle: '메이플 팝업',
  ticketTypeId: '7ad4c967-3d48-44da-a665-64731ac33f62',
  ticketTypeName: '7월 25일 오후 회차',
  qty: 2,
  total: 44000,
  status: 'paid',
  paymentStatus: 'paid',
  createdAt: '2026-07-14T02:00:00.000Z',
  startsAt: '2026-07-25T05:00:00.000Z',
  endsAt: '2026-07-25T08:00:00.000Z',
  location: '성수 ICONS 팝업',
  tickets: [
    { id: '19b0d848-7192-4b40-a675-f508822f99c9', status: 'valid' },
    { id: '2ab1e959-8203-4c51-b786-0619933a00da', status: 'used' },
  ],
  cancellationRequest: null,
  refund: null,
};

describe('TicketDetail', () => {
  it('renders event, session, amount, payment, cancellation, and per-ticket state without secrets', () => {
    const html = renderToStaticMarkup(
      <TicketDetail now={Date.parse('2026-07-15T03:00:00.000Z')} order={order} />,
    );

    expect(html).toContain('메이플 팝업');
    expect(html).toContain('7월 25일 오후 회차');
    expect(html).toContain('성수 ICONS 팝업');
    expect(html).toContain('₩44,000');
    expect(html).toContain('결제 완료');
    expect(html).toContain('티켓 1');
    expect(html).toContain('사용 가능');
    expect(html).toContain('티켓 2');
    expect(html).toContain('사용 완료');
    expect(html).toContain(`data-cancellation-order="${order.id}"`);
    expect(html).not.toMatch(/qr_token|payment_key|raw|attempt_token/i);
  });

  it('uses the paid booking ledger as truth when a different payment attempt failed', () => {
    const html = renderToStaticMarkup(
      <TicketDetail order={{ ...order, paymentStatus: 'failed' }} />,
    );

    expect(html).toContain('결제 완료');
    expect(html).not.toContain('결제 실패');
  });
});
