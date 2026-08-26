import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Nav, shouldCondenseWcHeader } from './Nav';
import { MenuSheet } from './MenuSheet';
import { SearchOverlay } from './SearchOverlay';
import { SiteFooter } from './SiteFooter';

/* White Catalog 전역 셸(S2)의 행동 계약. 마크업 세부가 아니라 "어떤 진입점이 어느 표면에 남는가"를 잠근다.
 * renderToStaticMarkup이라 effect는 돌지 않는다 — 알림 수·스크롤 축약은 항상 초기 상태로 관찰된다. */

const mocks = vi.hoisted(() => ({
  cardRewardsEnabled: true,
  count: 4,
  pathname: '/shop',
  presence: 'signed-in' as 'unknown' | 'signed-in' | 'signed-out',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));
vi.mock('./CartProvider', () => ({ useCart: () => ({ count: mocks.count, resetForSignOut: vi.fn() }) }));
vi.mock('./AuthPresenceProvider', () => ({ useAuthPresence: () => mocks.presence }));
vi.mock('./CardRewardAvailability', () => ({ useCardRewardsEnabled: () => mocks.cardRewardsEnabled }));
vi.mock('@/app/login/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('@/lib/auth/onboarding', () => ({ nextPathWithSearch: () => '/' }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: vi.fn() }) }));

beforeEach(() => {
  mocks.cardRewardsEnabled = true;
  mocks.count = 4;
  mocks.pathname = '/shop';
  mocks.presence = 'signed-in';
});

describe('White Catalog 전역 셸', () => {
  /* 홈은 자체 헤더, 인증은 집중형 셸, 게임은 자기완결 번들, 어드민은 자체 작업대다.
   * 공용 크롬이 새어 들어가면 각 표면이 헤더를 두 개 갖는다. */
  it('홈·인증·게임·어드민에서는 크롬과 푸터를 모두 비운다', () => {
    for (const pathname of ['/', '/login', '/update-password', '/account-suspended', '/games/roulette', '/admin']) {
      mocks.pathname = pathname;

      expect(renderToStaticMarkup(<Nav />), pathname).toBe('');
      expect(renderToStaticMarkup(<SiteFooter />), pathname).toBe('');
    }
  });

  it('공개 표면에서 유틸바·헤더 아이콘·GNB·메가메뉴·바텀바 진입점을 한 번에 세운다', () => {
    const html = renderToStaticMarkup(<Nav />);

    expect(html).toContain('wc-chrome');
    expect(html).toContain('wc-utilbar');
    expect(html).toContain('href="/orders"');
    expect(html).toContain('href="/notifications"');
    expect(html).toContain('aria-label="검색"');
    expect(html).toContain('aria-label="장바구니, 4개"');
    expect(html).toContain('aria-label="마이페이지"');
    expect(html).toContain('href="/shop/new"');
    expect(html).toContain('href="/shop/best"');
    expect(html).toContain('href="/ip"');
    expect(html).toContain('href="/packs"');
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="/community"');
    expect(html).toContain('id="wc-mega-category"');
    expect(html).toContain('href="/binder"');
    expect(html).toContain('href="/market"');
    expect(html).toContain('href="/exchange"');
    expect(html).toContain('wc-tabbar');
    expect(html).toContain('href="/my/wishlist"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('본문으로 건너뛰기');
  });

  /* 빈 장바구니에 '0'을 띄우면 담긴 것처럼 읽힌다 — 뱃지와 개수 라벨 둘 다 사라져야 한다. */
  it('장바구니가 비면 개수 뱃지와 개수 라벨을 함께 감춘다', () => {
    mocks.count = 0;

    const html = renderToStaticMarkup(<Nav />);

    expect(html).not.toContain('wc-cartcount');
    expect(html).toContain('aria-label="장바구니"');
  });

  it('카드 리워드 게이트가 닫히면 GNB와 메가메뉴 양쪽에서 카드팩을 지운다', () => {
    mocks.cardRewardsEnabled = false;

    expect(renderToStaticMarkup(<Nav />)).not.toContain('href="/packs"');
  });

  /* '/shop/new'에서 상위 경로인 카테고리(/shop)까지 현재로 표시되면 위치 감각이 무너진다.
   * activeNavId의 최장 경로 우선 규칙이 GNB 마크업까지 실제로 전달되는지 본다. */
  it('하위 경로에서 최장 매칭 항목 하나만 현재 페이지로 표시한다', () => {
    mocks.pathname = '/shop/new';

    const html = renderToStaticMarkup(<Nav />);

    expect(html).toMatch(/aria-current="page"[^>]*class="wc-gnb__link[^"]*"[^>]*href="\/shop\/new"/);
    expect(html).not.toContain('aria-current="page" class="wc-gnb__link" href="/shop"');
    /* 메가 트리거는 aria-expanded가 항상 사이에 끼어 위 문자열 단언만으로는 잡히지 않는다 — 태그 자체를 본다. */
    const megaTrigger = html.match(/<a[^>]*aria-controls="wc-mega-category"[^>]*>/)?.[0] ?? '';
    expect(megaTrigger).toContain('href="/shop"');
    expect(megaTrigger).not.toContain('aria-current');
  });

  /* 결제 화면에서 고정 바텀바가 결제 CTA를 덮는 사고를 구 MobNav에서 이미 겪었다. */
  it('결제 흐름에서는 헤더를 남기고 바텀 탭바만 접는다', () => {
    mocks.pathname = '/checkout';

    const html = renderToStaticMarkup(<Nav />);

    expect(html).not.toContain('wc-tabbar');
    expect(html).toContain('wc-header');
  });

  /* 최상단 미세 스크롤(터치 바운스·앵커 점프)에서 GNB가 깜빡이지 않도록 임계값을 잠근다. */
  it('맨 위 미세 스크롤에서는 헤더를 축약하지 않는다', () => {
    expect(shouldCondenseWcHeader(0)).toBe(false);
    expect(shouldCondenseWcHeader(2)).toBe(false);
    expect(shouldCondenseWcHeader(3)).toBe(true);
  });

  it('전체 메뉴 시트가 쇼핑·세계·내 활동·거래 그룹과 인증 액션을 담는다', () => {
    const html = renderToStaticMarkup(<MenuSheet cardRewardsEnabled onClose={vi.fn()} open />);

    expect(html).toContain('aria-label="전체 메뉴"');
    expect(html).toContain('쇼핑');
    expect(html).toContain('세계');
    expect(html).toContain('내 활동');
    expect(html).toContain('거래');
    expect(html).toContain('href="/orders"');
    expect(html).toContain('href="/my"');
    expect(html).toContain('로그아웃');

    mocks.presence = 'signed-out';
    expect(renderToStaticMarkup(<MenuSheet cardRewardsEnabled onClose={vi.fn()} open />)).toContain('로그인');

    expect(
      renderToStaticMarkup(<MenuSheet cardRewardsEnabled={false} onClose={vi.fn()} open />),
    ).not.toContain('href="/packs"');
  });

  it('검색 오버레이는 열렸을 때만 통합 검색 다이얼로그를 세운다', () => {
    const html = renderToStaticMarkup(<SearchOverlay onClose={vi.fn()} open />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="검색"');
    expect(html).toContain('placeholder="IP · 굿즈 · 카드 · 포스트 통합 검색"');
    expect(html).toContain('name="q"');

    expect(renderToStaticMarkup(<SearchOverlay onClose={vi.fn()} open={false} />)).toBe('');
  });

  /* 로그인 상태가 확정되기 전에 로그인/로그아웃 중 하나를 먼저 그리면 절반이 틀린 채로 깜빡인다. */
  it('로그인 상태가 미확정이면 자리만 잡고 인증 액션을 그리지 않는다', () => {
    mocks.presence = 'unknown';

    const html = renderToStaticMarkup(<Nav />);

    expect(html).toContain('wc-icon-btn-placeholder');
    expect(html).toContain('wc-utilbar__placeholder');
    expect(html).not.toContain('로그인');
    expect(html).not.toContain('로그아웃');
  });
});
