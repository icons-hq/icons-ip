import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Tickets } from './Tickets';
import type { TicketOrderListItem } from '../../lib/ticketing';

vi.mock('@/lib/ticketing', async () => await import('../../lib/ticketing'));
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
    expect(html).toContain('이벤트 둘러보기');
    expect(html).toContain('href="/events"');
  });
});
