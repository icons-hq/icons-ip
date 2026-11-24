import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuSheet } from './MenuSheet';
import { Nav } from './Nav';
import { SiteFooter } from './SiteFooter';

/* 관리자 페이지 바로가기 — 어드민 콘솔 운영자에게는 데스크톱 유틸 메뉴(클릭 1번)·모바일 전체 메뉴 시트(메뉴 탭 → 1번)·
 * 푸터 스태프 블록에 선다. 노출은 운영 권한 readback(StaffPreviewAvailability)을 흉내 내 켠다. 서버 HTML·readback 전에
 * 링크가 없다는 계약은 provider 를 목으로 바꾸지 않은 WcShell.test 가 잠근다. */

const mocks = vi.hoisted(() => ({
  adminConsoleVisible: true,
  pathname: '/shop',
  presence: 'signed-in' as 'unknown' | 'signed-in' | 'signed-out',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));
vi.mock('./CartProvider', () => ({ useCart: () => ({ count: 0, resetForSignOut: vi.fn() }) }));
vi.mock('./AuthPresenceProvider', () => ({ useAuthPresence: () => mocks.presence }));
vi.mock('./StaffPreviewAvailability', () => ({
  useAdminConsoleVisible: () => mocks.adminConsoleVisible,
  useCommunityStaffPreviewVisible: () => false,
}));
vi.mock('@/app/login/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('@/lib/auth/onboarding', () => ({ nextPathWithSearch: () => '/' }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: vi.fn() }) }));

const ADMIN_LINK = /<a[^>]*href="\/admin"[^>]*>관리자 페이지<\/a>/g;

function utilbarOf(html: string) {
  return html.slice(html.indexOf('class="wc-utilbar"'), html.indexOf('<header'));
}

beforeEach(() => {
  mocks.adminConsoleVisible = true;
  mocks.pathname = '/shop';
  mocks.presence = 'signed-in';
});

describe('관리자 페이지 바로가기', () => {
  it('데스크톱 유틸 메뉴 맨 앞에 서고, 고객 회원 링크·고객센터의 자리를 바꾸지 않는다', () => {
    const utilbar = utilbarOf(renderToStaticMarkup(<Nav />));

    expect(utilbar.match(ADMIN_LINK)).toEqual(['<a class="wc-utilbar__link" href="/admin">관리자 페이지</a>']);
    /* 오른쪽 정렬 줄의 맨 앞 — readback 뒤에 나타나도 위시리스트부터 고객센터까지의 자리가 움직이지 않는다. */
    const order = ['관리자 페이지', '위시리스트', '주문조회', '알림함', '로그아웃', '고객센터'].map((label) => utilbar.indexOf(label));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('헤더 행의 아이콘·GNB 에는 더하지 않는다 — 유틸 메뉴 한 곳이다', () => {
    const html = renderToStaticMarkup(<Nav />);

    expect(html.match(ADMIN_LINK)).toHaveLength(1);
    expect(html.match(/class="wc-icon-btn[^"]*"/g)).toHaveLength(3);
  });

  it('모바일 전체 메뉴 시트 맨 위에 스태프 전용 섹션으로 선다', () => {
    const html = renderToStaticMarkup(<MenuSheet onClose={vi.fn()} open />);

    expect(html.match(ADMIN_LINK)).toEqual(['<a class="wc-sheet__link" href="/admin">관리자 페이지</a>']);
    expect(html).toContain('<h2 class="wc-sheet__title">스태프 전용</h2>');
    /* 메뉴 탭을 누르면 바로 보이도록 스토어 그룹보다 앞이다. */
    expect(html.indexOf('스태프 전용')).toBeLessThan(html.indexOf('<h2 class="wc-sheet__title">스토어</h2>'));
  });

  it('푸터 스태프 블록 맨 앞에 서서 탭바·유틸 메뉴가 없는 화면에서도 닿는다', () => {
    for (const pathname of ['/shop', '/goods/7f0c2d1e-1111-4111-8111-111111111111', '/cart', '/games/roulette', '/ip/aouad']) {
      mocks.pathname = pathname;
      const html = renderToStaticMarkup(<SiteFooter copyrightYear={2026} />);

      expect(html.match(ADMIN_LINK), pathname).toEqual(['<a href="/admin">관리자 페이지</a>']);
      expect(html, pathname).toContain('aria-label="관리자 바로가기"');
      expect(html, pathname).toContain('관리자 · 스태프 전용');
    }
  });

  it('운영 권한 readback 이 닫혀 있으면 세 표면 어디에도 마크업이 없다', () => {
    mocks.adminConsoleVisible = false;
    const surfaces = [
      renderToStaticMarkup(<Nav />),
      renderToStaticMarkup(<MenuSheet onClose={vi.fn()} open />),
      renderToStaticMarkup(<SiteFooter copyrightYear={2026} />),
    ];

    for (const html of surfaces) {
      expect(html).not.toContain('href="/admin"');
      expect(html).not.toContain('관리자 페이지');
      expect(html).not.toContain('스태프 전용');
    }
  });

  it('공용 크롬이 없는 어드민 자체에서는 그리지 않는다', () => {
    mocks.pathname = '/admin';

    expect(renderToStaticMarkup(<Nav />)).toBe('');
    expect(renderToStaticMarkup(<SiteFooter copyrightYear={2026} />)).toBe('');
  });
});
