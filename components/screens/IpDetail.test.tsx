import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogIpDetail } from '@/lib/catalog';
import type { IpFollowState } from '@/lib/ip-follow';
import { IpDetail } from './IpDetail';

/* R-03 §1.9 개별 관 행동 단언 — 팔로우·알림 폼의 hidden 필드 계약(app/ip/actions.ts),
 * 해시태그 실데이터 파생, 품절 포함 굿즈 카운트 행, 연결 밴드 경로. */

const actions = vi.hoisted(() => ({
  setPreferences: vi.fn(),
  toggleFollow: vi.fn(),
}));

vi.mock('@/app/ip/actions', () => ({
  setIpNotificationPreferencesAction: actions.setPreferences,
  toggleIpFollowAction: actions.toggleFollow,
}));

const ip = {
  id: 'maplestory', // ip-display META 등재 → ipEn = MAPLESTORY
  title: '메이플스토리',
  sub: 'GAME IP',
  v: { key: 'game', label: '게임', color: '#38F0C0' },
  glyph: '楓',
  tagline: '작은 용사들의 큰 모험',
  synopsis: '메이플 월드의 이야기',
  bg: 'linear-gradient(#111, #222)',
  fans: 100,
  goods: 3,
  cards: 2,
  featured: true,
};

const detail: CatalogIpDetail = {
  source: 'mock',
  ip,
  goods: [
    { id: 'g1', name: '단풍 키링', ip: ip.id, type: '키링', price: 12000, badge: 'NEW', stock: 'ok', stockQty: 10, img: 'linear-gradient(#333, #444)' },
    { id: 'g2', name: '슬라임 인형', ip: ip.id, type: '인형', price: 29000, badge: null, stock: 'soldout', stockQty: 0, img: 'linear-gradient(#333, #444)' },
    { id: 'g3', name: '버섯 키링', ip: ip.id, type: '키링', price: 9000, badge: null, stock: 'ok', stockQty: 4, img: 'linear-gradient(#333, #444)' },
  ],
  cards: [
    { id: 'c1', ip: ip.id, name: '단풍잎 용사', no: '001', rarity: 'SSR', owned: false, bg: 'linear-gradient(#111, #222)' },
    { id: 'c2', ip: ip.id, name: '슬라임', no: '002', rarity: 'N', owned: true, bg: 'linear-gradient(#111, #222)' },
  ],
  events: [],
  posts: [],
};

const notFollowed: IpFollowState = { isFollowed: false, notifyDrops: false, notifyEvents: false };

function render(overrides: {
  detail?: CatalogIpDetail;
  followState?: IpFollowState;
  followError?: boolean;
  notificationError?: boolean;
  notificationSaved?: boolean;
} = {}) {
  return renderToStaticMarkup(
    <IpDetail
      detail={overrides.detail ?? detail}
      followError={overrides.followError ?? false}
      followState={overrides.followState ?? notFollowed}
      notificationError={overrides.notificationError ?? false}
      notificationSaved={overrides.notificationSaved ?? false}
    />,
  );
}

function inputNamed(html: string, name: string) {
  return html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
}

function text(html: string) {
  return html.replace(/<[^>]+>/g, '');
}

describe('IpDetail follow form', () => {
  it('keeps the immutable follow form fields and offers a free join for non-followers', () => {
    const html = render();

    expect(inputNamed(html, 'ipId')).toContain('value="maplestory"');
    expect(inputNamed(html, 'intent')).toContain('value="follow"');
    expect(inputNamed(html, 'next')).toContain('value="/ip/maplestory"');
    expect(html).toContain('팬덤 가입 — 무료');
  });

  it('flips the intent to unfollow for followers and marks the joined state', () => {
    const html = render({ followState: { isFollowed: true, notifyDrops: false, notifyEvents: false } });

    expect(inputNamed(html, 'intent')).toContain('value="unfollow"');
    expect(html).toContain('팬덤 가입됨 ✓');
    expect(html).toContain('is-followed');
  });

  it('shows the fan count in the follow row', () => {
    const html = render();

    expect(html).toContain('wc-iphall__follow-count');
    expect(html).toContain('팬 </span>100');
    expect(html).not.toContain('is-followed');
  });
});

describe('IpDetail notification forms', () => {
  it('sends the one-click auto-follow payload for non-followers', () => {
    const html = render();

    expect(html).toContain('팔로우하고 알림 받기');
    expect(inputNamed(html, 'autoFollow')).toContain('value="1"');
    expect(inputNamed(html, 'setBoth')).toContain('value="1"');
    expect(inputNamed(html, 'notifyDrops')).toContain('value="1"');
    expect(inputNamed(html, 'notifyEvents')).toContain('value="1"');
  });

  it('shows followers two switch checkboxes with their saved values', () => {
    const html = render({ followState: { isFollowed: true, notifyDrops: true, notifyEvents: false } });
    const drops = inputNamed(html, 'notifyDrops');
    const events = inputNamed(html, 'notifyEvents');

    expect(html).toContain('새 굿즈·드롭');
    expect(html).toContain('팝업·이벤트');
    expect(html).toContain('알림 설정 저장');
    expect(inputNamed(html, 'setBoth')).toContain('value="1"');
    expect(drops).toContain('role="switch"');
    expect(drops).toContain('checked=""');
    expect(events).toContain('role="switch"');
    expect(events).not.toContain('checked=""');
  });

  it('announces follow and notification failures as alerts', () => {
    const html = render({ followError: true, notificationError: true });

    expect(html).toContain('role="alert"');
    expect(html).toContain('팔로우 상태를 저장하지 못했습니다');
    expect(html).toContain('알림 설정을 저장하지 못했습니다');
  });

  it('announces a successful preference save, but never alongside an error', () => {
    const saved = render({ notificationSaved: true });
    expect(saved).toContain('role="status"');
    expect(saved).toContain('알림 설정을 저장했습니다');

    const conflicted = render({ notificationError: true, notificationSaved: true });
    expect(conflicted).not.toContain('알림 설정을 저장했습니다');
  });
});

describe('IpDetail banner', () => {
  it('derives the hashtags from real catalog data only', () => {
    const html = render();
    const hashtagList = html.match(/wc-iphall__hashtags[\s\S]*?<\/ul>/)?.[0] ?? '';

    expect(hashtagList).toContain('#MAPLESTORY');
    expect(hashtagList).toContain('#게임');
    expect(hashtagList.match(/<li>/g)).toHaveLength(2);
  });

  it('renders the ip name as the page heading with its description', () => {
    const html = render();

    expect(html.match(/<h1[^>]*>메이플스토리<\/h1>/)).toBeTruthy();
    expect(html).toContain('작은 용사들의 큰 모험 메이플 월드의 이야기');
  });
});

describe('IpDetail goods section', () => {
  it('counts every good including sold-out ones and keeps the sold-out band', () => {
    const html = render();

    expect(text(html)).toContain('전체 3개 굿즈');
    expect(html).toContain('SOLD OUT');
    expect(html).toContain('href="/shop/g1"');
  });

  it('links to the shop scoped to this ip', () => {
    const html = render();

    expect(html).toContain('굿즈샵에서 전체 보기');
    expect(html).toContain('href="/shop?ip=maplestory"');
  });

  it('renders a single-axis type chip row with 전체 pressed by default', () => {
    const html = render();
    const allChip = html.match(/<button[^>]*aria-pressed="true"[^>]*>전체<\/button>/)?.[0];

    expect(allChip).toContain('wc-iphall__filter-chip');
    expect(html).toContain('>키링</button>');
    expect(html).toContain('>인형</button>');
  });

  it('hides the chip row when a hall has a single type, and shows the empty state without goods', () => {
    const single = render({
      detail: { ...detail, goods: detail.goods.filter((good) => good.type === '키링') },
    });
    expect(single).not.toContain('wc-iphall__filter-chip');

    const empty = render({ detail: { ...detail, goods: [] } });
    expect(empty).toContain('등록된 굿즈가 아직 없습니다');
    expect(text(empty)).toContain('전체 0개 굿즈');
  });
});

describe('IpDetail link band', () => {
  it('links the card binder with the lineup size, offline pop-ups, and the fandom channel', () => {
    const html = render();

    expect(html).toContain('카드 도감 2종');
    expect(html).toContain('href="/binder"');
    expect(html).toContain('href="/offline-popups"');
    expect(html).toContain('href="/community?ip=maplestory"');
  });
});
