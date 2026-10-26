import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { SUGGESTED_SEARCH_TERMS, searchPlaceholder } from '@/lib/search-terms';
import type { StorefrontNavigation } from '@/lib/store-navigation';
import type { StorefrontMegaMenus } from '@/lib/storefront-mega-menu';
import { BottomTabBar } from './BottomTabBar';
import { Nav } from './Nav';
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
  search: '',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));
vi.mock('./CartProvider', () => ({ useCart: () => ({ count: mocks.count, resetForSignOut: vi.fn() }) }));
vi.mock('./AuthPresenceProvider', () => ({ useAuthPresence: () => mocks.presence }));
vi.mock('./CardRewardAvailability', () => ({ useCardRewardsEnabled: () => mocks.cardRewardsEnabled }));
vi.mock('@/app/login/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('@/lib/auth/onboarding', () => ({ nextPathWithSearch: () => '/' }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: vi.fn() }) }));

/* 메가 패널(div#wc-mega-category · div#wc-mega-online-popup)만 잘라 낸다 — 안에는 div가 더 없어 첫 닫는 div가 패널의 끝이다. */
function megaMarkup(html: string, panelId = 'wc-mega-category') {
  const start = html.indexOf(`id="${panelId}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</div>', start));
}

const nodeId = (n: number) => `94932000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/* 공개 전시 트리가 있는 셸(L5) — 고객 카테고리 공개 스위치 ON + 공개 전시 3개, 진행 중 기획전 1개, 피처드 IP 3개. */
const LIVE_MENUS: StorefrontMegaMenus = {
  categories: [
    { id: nodeId(1), parentId: null, name: '토이', depth: 1, imageUrl: null, navigable: false },
    { id: nodeId(2), parentId: nodeId(1), name: '피규어', depth: 2, imageUrl: 'https://cdn.example/icon.png', navigable: true },
    { id: nodeId(3), parentId: nodeId(1), name: '라이프', depth: 2, imageUrl: null, navigable: false },
    { id: nodeId(4), parentId: nodeId(3), name: '머그', depth: 3, imageUrl: null, navigable: true },
    { id: nodeId(5), parentId: null, name: '시즌', depth: 1, imageUrl: null, navigable: true },
  ],
  campaigns: [{ id: 'fall-drop', title: '가을 기획전', imageUrl: null }],
  featuredIps: [
    { id: 'maple', name: 'MapleStory', href: '/ip/maple', imageBg: 'url("https://cdn.example/maple.webp") center / cover no-repeat' },
    { id: 'hongsil', name: 'Hong Sil', href: '/ip/hongsil', imageBg: null },
    { id: 'third', name: 'Third IP', href: '/ip/third', imageBg: null },
  ],
};

beforeEach(() => {
  mocks.cardRewardsEnabled = true;
  mocks.count = 4;
  mocks.pathname = '/shop';
  mocks.presence = 'signed-in';
  mocks.search = '';
});

describe('White Catalog 전역 셸', () => {
  /* 초대·비밀번호 변경·정지 안내는 집중형 셸, 게임은 자기완결 번들, 어드민은 자체 작업대다.
   * 공용 크롬이 새어 들어가면 각 표면이 헤더를 두 개 갖는다. */
  it('집중형 인증·게임·어드민에서는 크롬과 푸터를 모두 비운다', () => {
    for (const pathname of ['/update-password', '/account-suspended', '/manager-invitation', '/games/roulette', '/admin', '/ip/aouad']) {
      mocks.pathname = pathname;

      expect(renderToStaticMarkup(<Nav />), pathname).toBe('');
      expect(renderToStaticMarkup(<SiteFooter />), pathname).toBe('');
    }
  });

  /* CH-13: 로그인(가입·재설정 모드 포함)은 레퍼런스처럼 전역 헤더·푸터·모바일 탭바 안에서 연다. */
  it('로그인 화면에서도 전역 헤더·푸터·하단 탭바를 렌더한다', () => {
    mocks.pathname = '/login';
    mocks.presence = 'signed-out';

    const html = renderToStaticMarkup(<Nav />);

    expect(html).toContain('wc-header');
    expect(html).toContain('wc-gnb');
    expect(html).toContain('wc-tabbar');
    expect(renderToStaticMarkup(<SiteFooter />)).toContain('wc-footer');
  });

  /* S3에서 홈이 자체 헤더를 버리고 공용 크롬 위로 올라왔다 — 홈만 예외로 비우면 헤더가 통째로 사라진다. */
  it('홈에서도 전역 크롬과 푸터를 렌더한다', () => {
    mocks.pathname = '/';

    expect(renderToStaticMarkup(<Nav />)).toContain('wc-gnb');
    expect(renderToStaticMarkup(<SiteFooter />)).toContain('wc-footer');
  });

  /* 공지 스트립은 이미지 링크 배너다(R-01 §1). 데이터가 없으면 자리도 차지하지 않고,
     PC 비율 아트웍이 모바일 폭에서 붕괴하지 않도록 모바일 소스는 picture 로 분기한다.
     텍스트 공지 바(11 §3 Δ1)는 그 위에 쌓인다 — 세부 렌더 계약은 ShellNotices.test.tsx. */
  it('공지 스트립 데이터가 있으면 헤더 위 링크 스트립을 그린다', () => {
    mocks.pathname = '/';
    const html = renderToStaticMarkup(
      <Nav
        notices={{ bars: [], strips: [{
          id: 'n1',
          title: '배송 공지',
          imageUrl: 'https://cdn.example/notice.webp',
          mobileImageUrl: 'https://cdn.example/notice-mobile.webp',
          href: '/events',
          pageTypes: null,
          endsAt: null,
        }] }}
      />,
    );

    expect(html).toContain('class="wc-notice"');
    expect(html).toContain('href="/events"');
    expect(html).toContain('alt="배송 공지"');
    expect(html).toContain('<source media="(max-width: 749px)" srcSet="https://cdn.example/notice-mobile.webp"/>');

    expect(renderToStaticMarkup(<Nav />)).not.toContain('wc-notice');

    /* 게이트가 꺼진 배포에서 /packs 스트립은 packs GNB 항목과 같은 규칙으로 숨는다. */
    mocks.cardRewardsEnabled = false;
    expect(
      renderToStaticMarkup(
        <Nav
          notices={{ bars: [], strips: [{
            id: 'n2',
            title: '카드팩 공지',
            imageUrl: 'https://cdn.example/packs.webp',
            mobileImageUrl: null,
            href: '/packs',
            pageTypes: null,
            endsAt: null,
          }] }}
        />,
      ),
    ).not.toContain('class="wc-notice"');

    /* 커뮤니티 임시 비공개도 같은 규칙이다 — 배너만 살아 404 로 떨어지지 않게 한다. */
    mocks.cardRewardsEnabled = true;
    expect(
      renderToStaticMarkup(
        <Nav
          notices={{ bars: [], strips: [{
            id: 'n3',
            title: '커뮤니티 공지',
            imageUrl: 'https://cdn.example/community.webp',
            mobileImageUrl: null,
            href: '/community',
            pageTypes: null,
            endsAt: null,
          }] }}
        />,
      ).includes('class="wc-notice"'),
    ).toBe(COMMUNITY_ENABLED);
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
    /* 커뮤니티는 임시 비공개 스위치 대상이라 노출 기대를 분기한다. */
    expect(html.includes('href="/community"')).toBe(COMMUNITY_ENABLED);
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

  /* CH-12: 굿즈 상세는 카테고리 목록이 아니다 — GNB·모바일 탭·메가 링크 어디에도 현재 위치를 켜지 않는다. */
  it('굿즈 상세에서는 GNB와 메가메뉴에 현재 위치를 표시하지 않는다', () => {
    mocks.pathname = '/shop/g1';

    const html = renderToStaticMarkup(<Nav />);

    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toContain('is-active');
  });

  /* 메가 링크도 GNB와 같은 최장 매칭 하나만 켠다 — '/shop/new'에서 '전체 굿즈'(/shop)까지 현재로 읽히면 안 된다. */
  it('메가메뉴는 가장 특정한 링크 하나만 현재 위치로 표시한다', () => {
    mocks.pathname = '/shop/new';

    const mega = megaMarkup(renderToStaticMarkup(<Nav />));

    expect(mega.match(/aria-current="page"/g)).toHaveLength(1);
    expect(mega).toMatch(/aria-current="page" class="wc-mega__link" href="\/shop\/new"/);
  });

  /* CH-06: 메가메뉴 안의 /shop 링크는 '전체 굿즈'다 — GNB 트리거 이름('카테고리')으로 덮이면 메뉴가 자기 이름을 링크로 반복한다. */
  it('메가메뉴의 전체 굿즈 링크는 GNB 트리거 이름으로 덮이지 않는다', () => {
    const mega = megaMarkup(renderToStaticMarkup(<Nav />));

    expect(mega).toMatch(/class="wc-mega__link" href="\/shop">전체 굿즈</);
    expect(mega).not.toContain('>카테고리<');
  });

  /* 화면 하단에 고정된 바가 결제 CTA를 덮으면 결제가 그대로 막힌다 — 이 저장소가 한 번 겪은 사고다. */
  it('결제 흐름에서는 헤더를 남기고 바텀 탭바만 접는다', () => {
    mocks.pathname = '/checkout';

    const html = renderToStaticMarkup(<Nav />);

    expect(html).not.toContain('wc-tabbar');
    expect(html).toContain('wc-header');
  });

  /* 모바일 PDP 는 72px 구매바가 최하단을 차지한다(R-04 §7.2). 탭바를 남기면
     z-index 로 가려진 채 포커스 순서에만 존재하는 유령 내비가 된다. */
  it('굿즈 상세에서는 탭바를 접고, NEW·BEST 컬렉션에서는 유지한다', () => {
    mocks.pathname = '/shop/g1';
    expect(renderToStaticMarkup(<Nav />)).not.toContain('wc-tabbar');

    mocks.pathname = '/shop/new';
    expect(renderToStaticMarkup(<Nav />)).toContain('wc-tabbar');

    mocks.pathname = '/shop/best';
    expect(renderToStaticMarkup(<Nav />)).toContain('wc-tabbar');

    mocks.pathname = '/shop';
    expect(renderToStaticMarkup(<Nav />)).toContain('wc-tabbar');
  });

  /* B3·MC-03: 탭바 숨김 여부는 셸(스크롤 판정·검색 오버레이)이 정하고, 탭바는 data-hidden 하나로만 표현한다.
   * SSR은 항상 노출로 시작해야 첫 페인트에 탭바가 없다가 튀어나오지 않는다. */
  it('하단 탭바는 SSR에서 노출로 시작하고 숨김 신호를 data-hidden으로 표현한다', () => {
    expect(renderToStaticMarkup(<Nav />)).toMatch(/class="wc-tabbar"[^>]*data-hidden="false"/);
    expect(renderToStaticMarkup(<BottomTabBar hidden menuOpen={false} onMenuOpen={vi.fn()} />)).toMatch(/class="wc-tabbar"[^>]*data-hidden="true"/);
    expect(renderToStaticMarkup(<BottomTabBar menuOpen={false} onMenuOpen={vi.fn()} />)).toMatch(/class="wc-tabbar"[^>]*data-hidden="false"/);
  });

  /* 축약 판정(B1, chrome-scroll.ts)은 유틸바의 문서상 위치를 공지 높이로 읽어 두 기준에 더한다.
   * 공지가 유틸바 아래로 내려가면 그 보정이 사라져 스트립이 보이는 동안 GNB부터 접힌다 — 순서가 계약이다. */
  it('공지를 유틸바 위에 두고 SSR에서는 항상 펼친 상태로 시작한다', () => {
    mocks.pathname = '/';
    const html = renderToStaticMarkup(
      <Nav notices={{
        bars: [{ id: 'b1', key: 'b1:abc123abc123', message: '배송 일정 안내', cta: null, pageTypes: ['home'], endsAt: null }],
        strips: [{ id: 'n1', title: '공지', imageUrl: 'https://cdn.example/n.webp', mobileImageUrl: null, href: '/events', pageTypes: null, endsAt: null }],
      }} />,
    );

    expect(html).toContain('data-condensed="false"');
    /* 텍스트 공지 바 → 이미지 스트립 → 유틸바 → 헤더. 스킵 링크는 여전히 셸의 첫 포커스 대상이다. */
    expect(html.indexOf('class="wc-skip-link"')).toBeLessThan(html.indexOf('class="wc-notice-bar"'));
    expect(html.indexOf('class="wc-notice-bar"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="wc-notice-bar"')).toBeLessThan(html.indexOf('class="wc-notice"'));
    expect(html.indexOf('class="wc-notice"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="wc-notice"')).toBeLessThan(html.indexOf('class="wc-utilbar"'));
    expect(html.indexOf('class="wc-utilbar"')).toBeLessThan(html.indexOf('<header'));
  });

  it('전체 메뉴 시트가 스토어·내 활동·거래 그룹과 인증 액션을 담는다', () => {
    const html = renderToStaticMarkup(<MenuSheet cardRewardsEnabled onClose={vi.fn()} open />);

    expect(html).toContain('aria-label="전체 메뉴"');
    expect(html).toContain('스토어');
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

  it('설정된 메뉴 순서와 이름을 PC·모바일·메뉴시트에서 공유하고 기능 게이트를 우선한다', () => {
    const navigation: StorefrontNavigation = [
      { id: 'events', label: '합성 행사' }, { id: 'best', label: '합성 인기' },
      { id: 'shop', label: '합성 분류' }, { id: 'packs', label: '숨길 카드' }, { id: 'community', label: '숨길 커뮤니티' },
    ];
    mocks.cardRewardsEnabled = false;
    const html = renderToStaticMarkup(<Nav navigation={navigation} />);
    for (const label of ['주요 메뉴', '주요 메뉴 탭']) {
      const section = html.slice(html.indexOf(`aria-label="${label}"`));
      expect(section.indexOf('합성 행사')).toBeLessThan(section.indexOf('합성 인기'));
      expect(section.indexOf('합성 인기')).toBeLessThan(section.indexOf('합성 분류'));
    }
    expect(html).not.toContain('href="/shop/new"');
    expect(html).not.toContain('숨길 카드');
    expect(html.includes('숨길 커뮤니티')).toBe(COMMUNITY_ENABLED);
    const sheet = renderToStaticMarkup(<MenuSheet navigation={navigation} cardRewardsEnabled={false} onClose={vi.fn()} open />);
    expect(sheet.indexOf('합성 행사')).toBeLessThan(sheet.indexOf('합성 인기'));
    expect(sheet.indexOf('합성 인기')).toBeLessThan(sheet.indexOf('합성 분류'));
    expect(sheet).not.toContain('href="/shop/new"');
    expect(sheet).not.toContain('숨길 카드');
    expect(sheet.includes('숨길 커뮤니티')).toBe(COMMUNITY_ENABLED);
    expect(sheet).toContain('href="/orders"');
  });

  it('검색 오버레이는 열렸을 때만 통합 검색 다이얼로그를 세운다', () => {
    const html = renderToStaticMarkup(<SearchOverlay onClose={vi.fn()} open />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="검색"');
    expect(html).toContain('role="search"');
    expect(html).toContain('action="/search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('enterKeyHint="search"');

    expect(renderToStaticMarkup(<SearchOverlay onClose={vi.fn()} open={false} />)).toBe('');
  });

  /* CH-11: 커뮤니티가 닫힌 배포에서 입력 안내가 '포스트'를 약속하면 결과에 없는 종류를 광고하는 셈이다.
   * /search 화면과 같은 규칙(searchPlaceholder)을 쓴다. */
  it('검색 안내는 커뮤니티 노출 스위치를 따른다', () => {
    const html = renderToStaticMarkup(<SearchOverlay onClose={vi.fn()} open />);

    expect(html).toContain(`placeholder="${searchPlaceholder()}"`);
    expect(html.includes('포스트')).toBe(COMMUNITY_ENABLED);
    expect(searchPlaceholder(true)).toBe('IP · 굿즈 · 카드 · 포스트 통합 검색');
    expect(searchPlaceholder(false)).toBe('IP · 굿즈 · 카드 통합 검색');
  });

  /* CH-09: 데스크톱은 회색 칸 하나(돋보기는 칸 안 장식)로 보이지만, 뒤로·제출 버튼은 접근 이름을 가진 채
   * DOM과 키보드 순서에 남는다 — 감춤은 CSS(.wc-search__aux)가 하고 마크업에서 지우지 않는다. */
  it('뒤로·제출 버튼은 이름을 유지한 채 감춤 훅을 달고, 돋보기 장식은 숨긴다', () => {
    const html = renderToStaticMarkup(<SearchOverlay onClose={vi.fn()} open />);

    expect(html).toMatch(/<button aria-label="검색 닫기" class="wc-icon-btn wc-search__aux" type="button">/);
    expect(html).toMatch(/<button aria-label="검색" class="wc-icon-btn wc-search__aux" type="submit">/);
    expect(html).toMatch(/<span aria-hidden="true" class="wc-search__field-icon">/);
    /* 순서: 뒤로 → 입력 → 제출(모바일 한 줄 배치와 포커스 순서가 같다). */
    expect(html.indexOf('검색 닫기')).toBeLessThan(html.indexOf('name="q"'));
    expect(html.indexOf('name="q"')).toBeLessThan(html.indexOf('type="submit"'));
  });

  /* 최근 검색어도 자동완성도 없는 패널이라, 빈 인풋 앞에서 다음 행동을 주는 건 추천 칩뿐이다.
   * 칩은 링크여야 JS 없이도 결과로 갈 수 있고, 질의어는 인코딩돼야 한글·공백이 살아 남는다. */
  it('검색 오버레이가 추천 검색어 칩을 결과 링크로 세운다', () => {
    const html = renderToStaticMarkup(<SearchOverlay onClose={vi.fn()} open />);

    expect(html).toContain('<p class="wc-search__chips-label">추천</p>');
    expect(html).toContain('class="wc-search__chip"');
    for (const term of SUGGESTED_SEARCH_TERMS) {
      expect(html).toContain(`href="/search?q=${encodeURIComponent(term)}"`);
    }

    /* 닫힌 패널이 칩만 남겨 두면 헤더 아래에 죽은 링크 행이 붙는다. */
    expect(renderToStaticMarkup(<SearchOverlay onClose={vi.fn()} open={false} />)).not.toContain(
      'wc-search__chip',
    );
  });

  /* MY-13: 데스크톱 위시 진입은 회원에게만 보이는 유틸바 링크다(헤더 아이콘 3개 문법은 그대로).
   * 탭바에도 같은 목적지가 있으므로 유틸바 구간만 잘라 본다. */
  it('유틸바 위시리스트 링크는 로그인 회원에게만 보인다', () => {
    const utilbar = (html: string) => html.slice(html.indexOf('class="wc-utilbar"'), html.indexOf('<header'));

    const member = utilbar(renderToStaticMarkup(<Nav />));
    expect(member).toContain('<a class="wc-utilbar__link" href="/my/wishlist">위시리스트</a>');
    /* 오른쪽 정렬 줄의 맨 앞이라 나타나도 다른 항목 자리가 움직이지 않는다. */
    expect(member.indexOf('위시리스트')).toBeLessThan(member.indexOf('주문조회'));
    expect(renderToStaticMarkup(<Nav />).match(/class="wc-icon-btn[^"]*"/g)).toHaveLength(3);

    for (const presence of ['signed-out', 'unknown'] as const) {
      mocks.presence = presence;
      expect(utilbar(renderToStaticMarkup(<Nav />)), presence).not.toContain('/my/wishlist');
    }
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

/* LFS 패리티 2차 L5 — 카테고리·온라인 팝업 메가메뉴(CH-05·CH-07)와 모바일 카테고리 탭 진입(MC-05). */
describe('카테고리 내비게이션 (L5)', () => {
  it('공개 전시 트리가 있으면 메가메뉴가 굿즈샵 바로가기 · 기획전 | 세로선 | 전시분류 그룹이 된다', () => {
    const mega = megaMarkup(renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />));

    expect(mega).toContain('wc-mega__list--catalog');
    expect(mega).not.toContain('wc-mega__list--compact');
    /* 순서: 굿즈샵 → 기획전 → (세로선 칸) 전시분류. */
    expect(mega.indexOf('>굿즈샵<')).toBeLessThan(mega.indexOf('>기획전<'));
    expect(mega.indexOf('>기획전<')).toBeLessThan(mega.indexOf('class="wc-mega__catalog"'));
    expect(mega).toContain('href="/events/fall-drop">가을 기획전</a>');
    /* 자기 전시가 없는 그룹 제목·2단계는 링크 없는 이름표, 전시가 있는 노드만 /shop?displayCategory 링크다. */
    expect(mega).toContain('<p class="wc-mega__heading">토이</p>');
    expect(mega).toContain(`class="wc-mega__link" href="/shop?displayCategory=${nodeId(2)}">피규어</a>`);
    expect(mega).toContain('<span class="wc-mega__label">라이프</span>');
    expect(mega).toContain(`class="wc-mega__link wc-mega__link--nested" href="/shop?displayCategory=${nodeId(4)}">머그</a>`);
    expect(mega).toContain(`class="wc-mega__heading wc-mega__heading-link" href="/shop?displayCategory=${nodeId(5)}">시즌</a>`);
    /* 실제 분류가 생기면 비(非)분류 그룹(수집·거래)은 메가메뉴에서 빠진다 — 진입점은 GNB·메뉴 시트·푸터에 남는다. */
    expect(mega).not.toContain('>수집<');
    expect(mega).not.toContain('>거래<');
    expect(mega).toMatch(/class="wc-mega__link" href="\/shop">전체 굿즈</);
  });

  /* 리뷰 l5-ui-2 — 카테고리 전시(/shop?displayCategory=)는 경로가 '전체 굿즈'와 같아 쿼리로만 가려진다. 전시 페이지에서 '전체 굿즈'가
   * 현재 위치로 읽히고 실제 전시분류 링크는 표시가 없었다. 기획전 상세(/events/<id>)에서는 기획전 링크에 표시가 없었다. */
  it('전시 페이지에서는 그 전시분류 링크만 현재 위치이고 전체 굿즈는 아니다', () => {
    mocks.search = `displayCategory=${nodeId(2)}&sort=newest`;
    const item = megaMarkup(renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />));
    expect(item.match(/aria-current="page"/g)).toHaveLength(1);
    expect(item).toContain(`aria-current="page" class="wc-mega__link" href="/shop?displayCategory=${nodeId(2)}">피규어</a>`);
    expect(item).toMatch(/[^"] class="wc-mega__link" href="\/shop">전체 굿즈</);

    /* 그룹 제목이 전시인 분류(시즌)는 제목 링크가 현재 위치다. 대문자 UUID 쿼리도 같은 분류다. */
    mocks.search = `displayCategory=${nodeId(5).toUpperCase()}`;
    const heading = megaMarkup(renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />));
    expect(heading.match(/aria-current="page"/g)).toHaveLength(1);
    expect(heading).toContain(`aria-current="page" class="wc-mega__heading wc-mega__heading-link" href="/shop?displayCategory=${nodeId(5)}">시즌</a>`);

    /* 메뉴에 없는 전시(숨김·잘못된 값)에서도 전체 굿즈를 켜지 않는다. GNB 트리거는 카테고리 구역이라 그대로 켜진다. */
    mocks.search = 'displayCategory=not-a-uuid';
    const unknown = renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />);
    expect(megaMarkup(unknown)).not.toContain('aria-current="page"');
    expect(unknown).toMatch(/aria-controls="wc-mega-category"[^>]*aria-current="page"|aria-current="page"[^>]*aria-controls="wc-mega-category"/);

    /* 전시 트리가 없어 기존 3그룹 메가로 돌아가도 전시 페이지에서 전체 굿즈를 켜지 않는다. */
    mocks.search = `displayCategory=${nodeId(2)}`;
    expect(megaMarkup(renderToStaticMarkup(<Nav megaMenus={{ ...LIVE_MENUS, categories: [] }} />))).not.toContain('aria-current="page"');

    /* 쿼리가 없는 /shop 은 그대로 전체 굿즈다. */
    mocks.search = '';
    const all = megaMarkup(renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />));
    expect(all.match(/aria-current="page"/g)).toHaveLength(1);
    expect(all).toContain('aria-current="page" class="wc-mega__link" href="/shop">전체 굿즈</a>');
  });

  it('기획전 상세에서는 그 기획전 링크가 메가메뉴의 현재 위치다', () => {
    mocks.pathname = '/events/fall-drop';
    const mega = megaMarkup(renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />));
    expect(mega.match(/aria-current="page"/g)).toHaveLength(1);
    expect(mega).toContain('aria-current="page" class="wc-mega__link" href="/events/fall-drop">가을 기획전</a>');

    mocks.pathname = '/events/other-drop';
    expect(megaMarkup(renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />))).not.toContain('aria-current="page"');
  });

  it('진행 중 기획전이 없으면 기획전 칸을 접고, 전시 트리가 비면 기존 3그룹 메뉴로 돌아간다', () => {
    const compact = megaMarkup(renderToStaticMarkup(<Nav megaMenus={{ ...LIVE_MENUS, campaigns: [] }} />));
    expect(compact).toContain('wc-mega__list--catalog wc-mega__list--compact');
    expect(compact).not.toContain('>기획전<');

    /* 공개 스위치 OFF·전시 없음 — 운영 화면이 머지만으로 바뀌지 않는다. */
    const fallback = megaMarkup(renderToStaticMarkup(<Nav megaMenus={{ ...LIVE_MENUS, categories: [] }} />));
    expect(fallback).not.toContain('wc-mega__list--catalog');
    for (const heading of ['굿즈샵', '수집', '거래']) expect(fallback).toContain(`<p class="wc-mega__heading">${heading}</p>`);
    expect(fallback).not.toContain('가을 기획전');
  });

  it('온라인 팝업 메가메뉴는 피처드 IP 목록 + 전체보기 + 상위 2개 이미지 타일이고, 피처드가 없으면 링크로 남는다', () => {
    mocks.pathname = '/ip/maple';
    const html = renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />);
    const trigger = html.match(/<a[^>]*aria-controls="wc-mega-online-popup"[^>]*>/)?.[0] ?? '';
    expect(trigger).toContain('href="/ip"');
    expect(trigger).toContain('aria-current="page"');
    expect(trigger).toContain('aria-expanded="false"');

    const mega = megaMarkup(html, 'wc-mega-online-popup');
    expect(mega).toContain('<p class="wc-mega__heading">추천 IP</p>');
    expect(mega).toContain('aria-current="page" class="wc-mega__link" href="/ip/maple">MapleStory</a>');
    expect(mega).toContain('aria-label="온라인 팝업 전체보기" class="wc-mega__heading wc-mega__heading-link" href="/ip">전체보기</a>');
    expect(mega.match(/class="wc-mega__tile"/g)).toHaveLength(2);
    expect(mega).toContain('style="background:url(&quot;https://cdn.example/maple.webp&quot;) center / cover no-repeat"');
    /* 키아트가 없는 IP 타일은 이름 첫 글자로 선다. */
    expect(mega).toContain('<span aria-hidden="true" class="wc-mega__tile-image wc-mega__tile-image--text">H</span>');
    expect(mega).not.toContain('Third IP</span>');

    const noFeatured = renderToStaticMarkup(<Nav megaMenus={{ ...LIVE_MENUS, featuredIps: [] }} />);
    expect(noFeatured).not.toContain('wc-mega-online-popup');
    expect(noFeatured).toMatch(/<li class="wc-gnb__item"><a aria-current="page" class="wc-gnb__link is-active" title="온라인 팝업" href="\/ip">/);
  });

  it('메가메뉴는 SSR 에서 닫힌 채 목차를 DOM 에 두고 트리거가 aria-expanded·aria-controls 로 패널을 가리킨다', () => {
    const html = renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />);
    for (const panelId of ['wc-mega-category', 'wc-mega-online-popup']) {
      expect(html).toContain(`class="wc-mega" data-open="false" id="${panelId}"`);
      expect(html).toMatch(new RegExp(`<a[^>]*aria-controls="${panelId}"[^>]*aria-expanded="false"`));
    }
  });

  it('모바일 카테고리 탭은 시트 트리거 버튼이고 바텀바 메뉴 탭과 따로 열린다(SSR 은 둘 다 닫힘)', () => {
    const html = renderToStaticMarkup(<Nav megaMenus={LIVE_MENUS} />);
    const tabs = html.slice(html.indexOf('aria-label="주요 메뉴 탭"'));
    expect(tabs).toMatch(/<button aria-expanded="false" aria-haspopup="dialog" class="wc-mob-gnb__link is-active" type="button">카테고리<\/button>/);
    /* 카테고리 시트는 닫힌 동안 마운트하지 않는다(호출부 포털). */
    expect(html).not.toContain('wc-catsheet');
    expect(html).not.toContain('aria-label="카테고리"');
  });
});
