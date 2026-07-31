import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  Tickets: ({ orders }: { orders: unknown[] }) => <div data-ticket-count={orders.length} />,
}));

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
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('data-ticket-count="1"');
    expect(mocks.list).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('requires authentication and onboarding with the exact return path', async () => {
    mocks.auth = { user: null, profile: null };
    await expect(Page()).rejects.toThrow('redirect:/login?next=%2Ftickets');
    expect(mocks.list).not.toHaveBeenCalled();

    mocks.auth = {
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'fan@example.test' },
      profile: null,
    };
    mocks.onboarded = false;
    await expect(Page()).rejects.toThrow('redirect:/onboarding?next=%2Ftickets');
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
