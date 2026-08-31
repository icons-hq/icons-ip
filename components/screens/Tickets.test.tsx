import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Tickets } from './Tickets';
import type { TicketOrderListItem } from '../../lib/ticketing';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => <span aria-hidden /> }));

const order: TicketOrderListItem = {
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
  ticketStatuses: ['valid', 'valid'],
  cancellationRequest: null,
  refund: null,
};

describe('Tickets', () => {
  it('renders grouped booking states and owner-detail links', () => {
    const html = renderToStaticMarkup(<Tickets now={Date.parse('2026-07-15T03:00:00.000Z')} orders={[
      order,
      { ...order, id: '6dc4cafe-313e-4787-9c10-2333c5e0fced', status: 'pending', paymentStatus: null },
      { ...order, id: '7ed5db0f-424f-4898-ad21-3444d6f100fe', ticketStatuses: ['used', 'used'] },
    ]} />);

    expect(html).toContain('사용 가능한 티켓');
    expect(html).toContain('진행 중인 예매');
    expect(html).toContain('지난 티켓');
    expect(html).toContain(`href="/tickets/${order.id}"`);
    expect(html).toContain('메이플 팝업');
    expect(html).toContain('7월 25일 오후 회차');
    expect(html).toContain('2매');
    expect(html).toContain('사용 가능');
    expect(html).toContain('결제 대기');
    expect(html).toContain('사용 완료');
  });

  it('shows a distinct empty state without inventing booking data', () => {
    const html = renderToStaticMarkup(<Tickets orders={[]} />);
    expect(html).toContain('아직 예매한 티켓이 없어요');
    expect(html).toContain('오프라인 팝업 둘러보기');
    expect(html).toContain('href="/offline-popups"');
  });

  it('payment 결과가 없으면 결제 배너를 렌더하지 않는다', () => {
    const html = renderToStaticMarkup(<Tickets orders={[order]} />);

    expect(html).not.toContain('tickets-payment-banner');
    expect(html).toContain('메이플 팝업');
  });

  it('approved면 결제 확인 안내를 status로 렌더한다', () => {
    const html = renderToStaticMarkup(<Tickets orders={[order]} paymentResult="approved" />);

    expect(html).toContain('tickets-payment-banner--approved');
    expect(html).toContain('role="status"');
    expect(html).toContain('결제가 확인됐어요');
  });

  it('checking이면 확인 중 안내와 고객센터 1:1 문의 링크를 렌더한다', () => {
    const html = renderToStaticMarkup(<Tickets orders={[order]} paymentResult="checking" />);

    expect(html).toContain('tickets-payment-banner--checking');
    expect(html).toContain('role="status"');
    expect(html).toContain('결제를 확인하고 있어요');
    expect(html).toContain('고객센터');
    expect(html).toContain('href="/my/inquiries"');
  });

  it('failed면 실패 안내를 alert로 렌더하고, 빈 예매 목록에서도 유지한다', () => {
    const html = renderToStaticMarkup(<Tickets orders={[]} paymentResult="failed" />);

    expect(html).toContain('tickets-payment-banner--failed');
    expect(html).toContain('role="alert"');
    expect(html).toContain('결제가 완료되지 않았어요');
    expect(html).toContain('아직 예매한 티켓이 없어요');
  });
});
