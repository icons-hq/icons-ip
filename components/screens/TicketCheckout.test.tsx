import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TicketOrderSnapshot } from '@/lib/ticketing.server';
import { TicketCheckout } from './TicketCheckout';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/components/payments/TossPaymentWidget', () => ({
  TossPaymentWidget: (props: Record<string, unknown>) => (
    <div data-payment-widget={JSON.stringify(props)} />
  ),
}));
vi.mock('@/lib/ticketing', async () => await import('../../lib/ticketing'));

const order: TicketOrderSnapshot = {
  id: '33333333-3333-4333-8333-333333333333',
  eventId: 'e100',
  eventTitle: '화산강림 여름 팝업',
  ticketTypeId: '11111111-1111-4111-8111-111111111111',
  ticketTypeName: '7월 25일 1회차',
  qty: 2,
  total: 50000,
  status: 'pending',
  paymentStatus: null,
  expiresAt: '2099-07-14T12:30:00.000Z',
};

function render(overrides: Partial<TicketOrderSnapshot> = {}, clientKey: string | null = 'test-client-key') {
  return renderToStaticMarkup(
    <TicketCheckout
      clientKey={clientKey}
      customer={{ id: 'user-1', email: 'fan@example.test', name: '아이콘즈 팬' }}
      order={{ ...order, ...overrides }}
    />,
  );
}

describe('TicketCheckout', () => {
  it('renders a server-derived receipt before the client initializes payment', () => {
    const html = render();

    expect(html).toContain('결제 가능 시간을 확인하고 있어요');
    expect(html).toContain('화산강림 여름 팝업');
    expect(html).toContain('7월 25일 1회차');
    expect(html).toContain('2매');
    expect(html).toContain('₩50,000');
  });

  it('does not report completion while provider approval is awaiting the webhook', () => {
    const html = render({ paymentStatus: 'pending' });

    expect(html).toContain('결제를 확인하고 있어요');
    expect(html).not.toContain('전자티켓 2장이 발급됐어요');
  });

  it('shows completion only from paid order truth without exposing QR tokens', () => {
    const html = render({ status: 'paid', paymentStatus: 'paid', expiresAt: null });

    expect(html).toContain('예매가 완료됐어요');
    expect(html).toContain('전자티켓 2장이 발급됐어요');
    expect(html).not.toContain('qr_token');
    expect(html).not.toContain('/tickets');
  });

  it('shows a closed state and never renders payment before client time initialization', () => {
    const closed = render({ status: 'canceled', expiresAt: null });
    const unavailable = render({}, null);

    expect(closed).toContain('예매가 종료됐어요');
    expect(unavailable).toContain('결제 가능 시간을 확인하고 있어요');
    expect(unavailable).not.toContain('data-payment-widget');
  });
});
