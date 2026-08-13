import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import type { TicketOrderSnapshot } from '@/lib/ticketing.server';
import {
  TicketCheckout,
  effectiveTicketCheckoutExpiry,
  preparedTicketCheckoutUsable,
} from './TicketCheckout';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/components/payments/PreparedCheckoutAction', () => ({
  PreparedCheckoutAction: (props: Record<string, unknown>) => (
    <div data-prepared-checkout={JSON.stringify(props)} />
  ),
}));

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

const prepared = {
  attemptId: '44444444-4444-4444-8444-444444444444',
  provider: 'korpay' as const,
  callbackNonce: 'opaque-callback-nonce-for-ticket',
  action: { kind: 'redirect' as const, url: 'https://payments.example.test' },
  expiresAt: order.expiresAt as string,
};

function render(overrides: Partial<TicketOrderSnapshot> = {}) {
  return renderToStaticMarkup(
    <TicketCheckout
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
    expect(html).toContain(`href="/tickets/${order.id}"`);
    expect(html).toContain('전자티켓 보기');
  });

  it('shows a closed state and never renders payment before client time initialization', () => {
    const closed = render({ status: 'canceled', expiresAt: null });
    const unavailable = render();

    expect(closed).toContain('예매가 종료됐어요');
    expect(unavailable).toContain('결제 가능 시간을 확인하고 있어요');
    expect(unavailable).not.toContain('data-prepared-checkout');
  });

  it('예매와 provider 준비 만료 중 더 이른 시각만 결제 action에 사용한다', () => {
    expect(effectiveTicketCheckoutExpiry(
      '2099-08-13T10:15:00.000Z',
      '2099-08-13T10:10:00.000Z',
    )).toBe(Date.parse('2099-08-13T10:10:00.000Z'));
    expect(preparedTicketCheckoutUsable(
      prepared,
      prepared.expiresAt,
      Date.parse(prepared.expiresAt) + 1,
    )).toBe(false);
  });
});
