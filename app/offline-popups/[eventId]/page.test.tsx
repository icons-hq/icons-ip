import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { FandomEvent } from '@/lib/data';
import Page from './page';

const mocks = vi.hoisted(() => ({
  catalog: null as CatalogSnapshot | null,
  eventDetail: vi.fn(),
  followState: { isFollowed: false, notifyDrops: false, notifyEvents: false },
  getIpFollowState: vi.fn(),
  loadSessions: vi.fn(),
}));

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
vi.mock('@/lib/payments/ticket-checkout-availability', () => ({
  ticketCheckoutPaymentsEnabled: () => false,
}));
vi.mock('@/lib/ticketing.server', () => ({ loadPublicTicketTypes: mocks.loadSessions }));
vi.mock('@/lib/ip-follow.server', () => ({ getIpFollowState: mocks.getIpFollowState }));
vi.mock('@/components/screens/EventDetail', () => ({
  EventDetail: (props: {
    authHref: string;
    notificationError: boolean;
    notificationSaved: boolean;
    notificationState: unknown;
    sessions: unknown[];
  }) => {
    mocks.eventDetail(props);
    return <div data-session-count={props.sessions.length} />;
  },
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

const ip = {
  id: 'ip100',
  title: '화산강림',
  sub: 'ORIGINAL IP',
  v: { key: 'webtoon', label: '웹툰', color: '#38F0C0' },
  glyph: '火',
  tagline: '불꽃처럼 피어나는 이야기',
  synopsis: '화산강림 세계관',
  bg: 'linear-gradient(#111, #222)',
  fans: 100,
  goods: 0,
  cards: 0,
  featured: true,
};

function snapshot(source: CatalogSnapshot['source']): CatalogSnapshot {
  return { source, verticals: [], ips: [], goods: [], cards: [], events: [event] };
}

describe('/offline-popups/[eventId]', () => {
  beforeEach(() => {
    mocks.eventDetail.mockReset();
    mocks.getIpFollowState.mockReset();
    mocks.getIpFollowState.mockResolvedValue(mocks.followState);
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
    expect(mocks.loadSessions).toHaveBeenCalledWith(event.id, undefined);
  });

  it('loads IP preferences only for a scheduled event with an IP', async () => {
    mocks.catalog = {
      ...snapshot('mock'),
      ips: [ip],
      events: [{ ...event, status: '예정' }],
    };

    renderToStaticMarkup(await Page({
      params: Promise.resolve({ eventId: event.id }),
      searchParams: Promise.resolve({ notification_error: '1', notification_saved: '1' }),
    }));

    expect(mocks.getIpFollowState).toHaveBeenCalledWith(ip.id);
    expect(mocks.eventDetail.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      notificationError: true,
      notificationSaved: true,
      notificationState: mocks.followState,
    }));
  });

  /* 로그인 복귀 경로가 옛 /events를 가리키면 로그인 뒤 브리지 리다이렉트를 한 번 더 타고,
     캠페인 허브가 /events/<id> 앞에 끼어드는 순간(S8 W2) 예매로 못 돌아온다. */
  it('returns a signed-out visitor to this booking surface after login', async () => {
    mocks.catalog = snapshot('mock');

    renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: event.id }) }));

    expect(mocks.eventDetail.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      authHref: `/login?next=${encodeURIComponent(`/offline-popups/${event.id}`)}`,
    }));
  });

  it('does not load IP preferences for booking or joint scheduled events', async () => {
    mocks.catalog = { ...snapshot('mock'), ips: [ip] };
    renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: event.id }) }));

    mocks.catalog = {
      ...snapshot('mock'),
      events: [{ ...event, ip: null, status: '예정' }],
    };
    renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: event.id }) }));

    expect(mocks.getIpFollowState).not.toHaveBeenCalled();
  });
});
