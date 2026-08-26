import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketsPaymentResult } from '@/components/screens/Tickets';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  list: vi.fn(),
  onboarded: true,
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/ticketing.server', () => ({ listTicketOrders: mocks.list }));
vi.mock('@/components/screens/Tickets', () => ({
  Tickets: ({ orders, paymentResult }: { orders: unknown[]; paymentResult?: TicketsPaymentResult }) => (
    <div data-ticket-count={orders.length} data-payment-result={paymentResult ?? 'none'} />
  ),
}));

function render(payment?: string | string[]) {
  return Page({ searchParams: Promise.resolve({ payment }) });
}

beforeEach(() => {
  mocks.auth = {
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'fan@example.test' },
    profile: { onboarded_at: '2026-07-14T00:00:00.000Z' },
  };
  mocks.onboarded = true;
  mocks.list.mockReset();
  mocks.list.mockResolvedValue([{ id: 'ticket-order' }]);
});

describe('/tickets', () => {
  it('is private metadata and loads only the authenticated owner list', async () => {
    expect(metadata).toMatchObject({ robots: { index: false, follow: false } });
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('data-ticket-count="1"');
    expect(mocks.list).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('requires authentication and onboarding with the exact return path', async () => {
    mocks.auth = { user: null, profile: null };
    await expect(render()).rejects.toThrow('redirect:/login?next=%2Ftickets');
    expect(mocks.list).not.toHaveBeenCalled();

    mocks.auth = {
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'fan@example.test' },
      profile: null,
    };
    mocks.onboarded = false;
    await expect(render()).rejects.toThrow('redirect:/onboarding?next=%2Ftickets');
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('payment 쿼리의 결제 결과를 Tickets에 전달한다', async () => {
    for (const result of ['approved', 'checking', 'failed'] as const) {
      const html = renderToStaticMarkup(await render(result));
      expect(html).toContain(`data-payment-result="${result}"`);
    }
  });

  it('payment 쿼리가 없거나 콜백 계약 밖의 값이면 배너 없이 렌더한다', async () => {
    expect(renderToStaticMarkup(await render(undefined))).toContain('data-payment-result="none"');
    expect(renderToStaticMarkup(await render('paid'))).toContain('data-payment-result="none"');
  });

  it('payment 쿼리가 반복되면 첫 값만 읽는다', async () => {
    const html = renderToStaticMarkup(await render(['checking', 'approved']));
    expect(html).toContain('data-payment-result="checking"');
  });

  it('비로그인 리다이렉트의 next에 검증된 payment 쿼리를 보존한다', async () => {
    mocks.auth = { user: null, profile: null };
    await expect(render('approved'))
      .rejects.toThrow(`redirect:/login?next=${encodeURIComponent('/tickets?payment=approved')}`);
    await expect(render('paid'))
      .rejects.toThrow(`redirect:/login?next=${encodeURIComponent('/tickets')}`);
  });
});
