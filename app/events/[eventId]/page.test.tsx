import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { FandomEvent } from '@/lib/data';
import Page from './page';

const mocks = vi.hoisted(() => ({
  catalog: null as CatalogSnapshot | null,
  loadSessions: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); } }));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: () => mocks.catalog,
  getCatalogSource: () => mocks.catalog?.source ?? 'mock',
}));
vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => ({ isConfigured: false, user: null, profile: null, isStaff: false }),
}));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => false,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/payments/checkout-availability', () => ({ checkoutPaymentsEnabled: () => false }));
vi.mock('@/lib/ticketing.server', () => ({ loadPublicTicketTypes: mocks.loadSessions }));
vi.mock('@/components/screens/EventDetail', () => ({
  EventDetail: ({ sessions }: { sessions: unknown[] }) => <div data-session-count={sessions.length} />,
}));

const event: FandomEvent = {
  id: 'e100',
  title: '테스트 이벤트',
  ip: 'ip100',
  mode: '오프라인',
  status: '예매중',
  date: '7.25',
  loc: '성수',
  accent: '#38F0C0',
  img: 'linear-gradient(#111, #222)',
};

function snapshot(source: CatalogSnapshot['source']): CatalogSnapshot {
  return { source, verticals: [], ips: [], goods: [], cards: [], events: [event] };
}

describe('/events/[eventId]', () => {
  beforeEach(() => {
    mocks.loadSessions.mockReset();
    mocks.loadSessions.mockResolvedValue([{ id: 'session-1' }]);
  });

  it('keeps explicit mock catalog mode independent from Supabase ticket queries', async () => {
    mocks.catalog = snapshot('mock');

    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: event.id }) }));

    expect(html).toContain('data-session-count="0"');
    expect(mocks.loadSessions).not.toHaveBeenCalled();
  });

  it('loads public ticket sessions for the Supabase catalog source', async () => {
    mocks.catalog = snapshot('supabase');

    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: event.id }) }));

    expect(html).toContain('data-session-count="1"');
    expect(mocks.loadSessions).toHaveBeenCalledWith(event.id);
  });
});
