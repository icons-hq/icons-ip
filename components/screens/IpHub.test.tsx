import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogIpDetail } from '@/lib/catalog';
import type { IpFollowState } from '@/lib/ip-follow';
import { IpHub } from './IpHub';

const actions = vi.hoisted(() => ({
  setPreferences: vi.fn(),
  toggleFollow: vi.fn(),
}));

vi.mock('@/app/ip/actions', () => ({
  setIpNotificationPreferencesAction: actions.setPreferences,
  toggleIpFollowAction: actions.toggleFollow,
}));
vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({
    add: vi.fn(),
    error: null,
    getQuantity: () => 0,
    pending: false,
    ready: true,
  }),
}));
vi.mock('@/components/ui/motion', () => ({
  useHeroParallax: () => ({ artRef: { current: null }, onMouseLeave: vi.fn(), onMouseMove: vi.fn() }),
  useTilt: () => ({
    cardRef: { current: null },
    glareRef: { current: null },
    onMouseLeave: vi.fn(),
    onMouseMove: vi.fn(),
  }),
}));

const ip = {
  id: 'ip-1',
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

const detail: CatalogIpDetail = {
  source: 'mock',
  ip,
  goods: [],
  cards: [],
  events: [],
  posts: [],
};

function render(
  followState: IpFollowState,
  notificationError = false,
  notificationSaved = false,
) {
  return renderToStaticMarkup(
    <IpHub
      detail={detail}
      followError={false}
      followState={followState}
      ips={[ip]}
      notificationError={notificationError}
      notificationSaved={notificationSaved}
    />,
  );
}

describe('IpHub notification preferences', () => {
  it('turns the non-followed placeholder into an explicit auto-follow notification action', () => {
    const html = render({ isFollowed: false, notifyDrops: false, notifyEvents: false });

    expect(html).toContain('팔로우하고 알림 받기');
    expect(html).toContain('name="autoFollow" value="1"');
    expect(html).toContain('name="setBoth" value="1"');
    expect(html).toContain('name="notifyDrops" value="1"');
    expect(html).toContain('name="notifyEvents" value="1"');
  });

  it('shows followed users two switch checkboxes with their saved values', () => {
    const html = render({ isFollowed: true, notifyDrops: true, notifyEvents: false });
    const drops = html.match(/<input[^>]*name="notifyDrops"[^>]*>/)?.[0];
    const events = html.match(/<input[^>]*name="notifyEvents"[^>]*>/)?.[0];

    expect(html).toContain('새 굿즈·드롭');
    expect(html).toContain('팝업·이벤트');
    expect(html).toContain('알림 설정 저장');
    expect(html).toContain('name="setBoth" value="1"');
    expect(drops).toContain('role="switch"');
    expect(drops).toContain('checked=""');
    expect(events).toContain('role="switch"');
    expect(events).not.toContain('checked=""');
  });

  it('shows a generic preference failure without exposing provider details', () => {
    const html = render({ isFollowed: true, notifyDrops: true, notifyEvents: true }, true);

    expect(html).toContain('알림 설정을 저장하지 못했습니다');
  });

  it('announces a successful preference update', () => {
    const html = render({ isFollowed: true, notifyDrops: true, notifyEvents: true }, false, true);

    expect(html).toContain('role="status"');
    expect(html).toContain('알림 설정을 저장했습니다');
  });
});
