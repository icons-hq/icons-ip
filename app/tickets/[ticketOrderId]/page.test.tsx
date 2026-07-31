import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  detail: vi.fn(),
  onboarded: true,
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('not-found'); },
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/ticketing', async () => await import('../../../lib/ticketing'));
vi.mock('@/lib/ticketing.server', () => ({ loadTicketOrderDetail: mocks.detail }));
vi.mock('@/components/screens/TicketDetail', () => ({
  TicketDetail: ({ order }: { order: { id: string } }) => <div data-ticket-order={order.id} />,
}));

const ticketOrderId = '5cbcbfed-202d-4676-821a-7706398e57c0';

beforeEach(() => {
  mocks.auth = {
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'fan@example.test' },
    profile: { onboarded_at: '2026-07-14T00:00:00.000Z' },
  };
  mocks.onboarded = true;
  mocks.detail.mockReset();
  mocks.detail.mockResolvedValue({ id: ticketOrderId });
});

describe('/tickets/[ticketOrderId]', () => {
  it('uses async params, canonical UUID, owner scope, and private metadata', async () => {
    expect(metadata).toMatchObject({ robots: { index: false, follow: false } });
    const html = renderToStaticMarkup(await Page({
      params: Promise.resolve({ ticketOrderId: ticketOrderId.toUpperCase() }),
    }));

    expect(html).toContain(`data-ticket-order="${ticketOrderId}"`);
    expect(mocks.detail).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      ticketOrderId,
    );
  });

  it('uses the same 404 for malformed, missing, and foreign references', async () => {
    await expect(Page({ params: Promise.resolve({ ticketOrderId: 'not-a-uuid' }) }))
      .rejects.toThrow('not-found');
    expect(mocks.detail).not.toHaveBeenCalled();

    mocks.detail.mockResolvedValue(null);
    await expect(Page({ params: Promise.resolve({ ticketOrderId }) })).rejects.toThrow('not-found');
  });

  it('requires auth and onboarding before the owner detail query', async () => {
    mocks.auth = { user: null, profile: null };
    await expect(Page({ params: Promise.resolve({ ticketOrderId }) }))
      .rejects.toThrow(`redirect:/login?next=%2Ftickets%2F${ticketOrderId}`);
    expect(mocks.detail).not.toHaveBeenCalled();

    mocks.auth = {
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'fan@example.test' },
      profile: null,
    };
    mocks.onboarded = false;
    await expect(Page({ params: Promise.resolve({ ticketOrderId }) }))
      .rejects.toThrow(`redirect:/onboarding?next=%2Ftickets%2F${ticketOrderId}`);
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});
