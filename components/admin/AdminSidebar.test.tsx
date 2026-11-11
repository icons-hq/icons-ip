import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedAdminNavigation } from '@/lib/admin/navigation-preferences';
import { SidebarProvider } from '@/components/admin/kit/ui/sidebar';
import { AdminSidebar } from './AdminSidebar';

const mocks = vi.hoisted(() => ({ pathname: '/admin' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

function render(role = 'staff', consoleId: 'commerce' | 'content' = 'commerce') {
  return renderToStaticMarkup(
    <SidebarProvider><AdminSidebar role={role} console={consoleId} /></SidebarProvider>,
  );
}

function renderSaved(initialNavigation: SavedAdminNavigation | null, { open = true }: { open?: boolean } = {}) {
  return renderToStaticMarkup(
    <SidebarProvider defaultOpen={open}><AdminSidebar accountId="operator-a" initialNavigation={initialNavigation} role="admin" /></SidebarProvider>,
  );
}

const groupState = (html: string, groupId: string) => html.match(new RegExp(`data-admin-nav-group="${groupId}"[^>]*data-state="(open|closed)"`))?.[1];
const panelTag = (html: string, groupId: string) => html.match(new RegExp(`<div[^>]*id="admin-nav-group-${groupId}"[^>]*>`))?.[0] ?? '';

describe('AdminSidebar 2단 메뉴', () => {
  beforeEach(() => {
    mocks.pathname = '/admin';
  });

  it('대분류 헤딩과 소분류 항목을 함께 보여준다', () => {
    const html = render();

    expect(html).toContain('주문관리');
    expect(html).toContain('상품관리');
    expect(html).toContain('주문통합검색');
    expect(html).toContain('href="/admin/catalog/goods"');
  });

  /* 대분류 순서가 뒤집히면 운영자가 익힌 메뉴 위치가 매번 달라진다. 2026-11-05 IA 재정의: 매일 쓰는 업무가 위, 설정 구역이 아래. */
  it('대분류를 정해진 순서로 세운다', () => {
    const html = render('admin');
    const order = ['주문관리', '취소·반품·교환', '상품관리', '문의/리뷰관리', '고객관리', '스토어 전시관리', '혜택/마케팅', '데이터분석',
      '정산관리', '배송관리', '템플릿 관리', '판매자 정보'].map((label) => html.indexOf(`>${label}<`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('현재 화면만 aria-current를 단다', () => {
    mocks.pathname = '/admin/catalog/pools';
    const html = render('staff', 'content');

    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  /* D9: 콘텐츠 운영은 커머스 사이드바에 숨기지 않고 별도 콘솔의 사이드바로 둔다. */
  it('커머스와 콘텐츠 운영 콘솔은 서로의 메뉴를 섞지 않는다', () => {
    const commerce = render();
    expect(commerce).toContain('href="/admin/catalog/goods"');
    expect(commerce).not.toContain('href="/admin/catalog/cards"');
    expect(commerce).not.toContain('IP·콘텐츠 운영');
    const content = render('staff', 'content');
    for (const href of ['/admin/catalog/ips', '/admin/catalog/cards', '/admin/catalog/pools', '/admin/catalog/policies', '/admin/catalog/grants',
      '/admin/catalog/games', '/admin/catalog/events', '/admin/catalog/ticket-types', '/admin/community/moderation', '/admin/check-in', '/admin/guide'])
      expect(content).toContain(`href="${href}"`);
    expect(content).not.toContain('href="/admin/catalog/goods"');
    expect(content).not.toContain('data-admin-nav-screen="overview"');
    expect(content).toContain('aria-label="콘텐츠 운영 메뉴"');
  });

  it('홈 링크와 즐겨찾기를 메뉴 그룹 위 바로가기에 유지한다', () => {
    const html = render();

    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*data-admin-nav-screen="overview"/);
    expect(html).toContain('aria-label="홈 즐겨찾기 추가"');
    /* 메뉴 검색은 사이드바 머리(브랜드 아래)에 있고, 홈은 메뉴 맨 위 — 어느 그룹보다 먼저 선다. */
    expect(html.indexOf('aria-label="어드민 메뉴 검색"')).toBeLessThan(html.indexOf('data-admin-nav-screen="overview"'));
    expect(html.indexOf('data-admin-nav-screen="overview"')).toBeLessThan(html.indexOf('data-admin-nav-group="sales"'));
    expect(html).not.toContain('id="admin-nav-group-home"');
  });

  it('접기 제어는 메뉴 스크롤 영역 밖(가장자리 레일)에 있고, 메뉴는 헤더 버튼이 가리키는 id를 가진다', () => {
    const html = render();

    expect(html.indexOf('data-sidebar="rail"')).toBeGreaterThan(html.indexOf('</nav>'));
    expect(html).toContain('id="admin-navigation"');
  });

  it('상품 일괄등록에서는 상위 상품 조회 메뉴를 동시에 활성화하지 않는다', () => {
    mocks.pathname = '/admin/catalog/goods/import';
    const html = render();

    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*data-admin-nav-screen="goods-import"/);
  });

  /* /admin 은 모든 경로의 접두다. 접두 일치만 쓰면 개요가 항상 켜져 보인다. */
  it('하위 화면에 있을 때 개요를 활성으로 표시하지 않는다', () => {
    mocks.pathname = '/admin/sales/orders';
    const html = render();
    const overviewLink = html.slice(html.indexOf('href="/admin"', html.indexOf('admin-nav')));

    expect(overviewLink.startsWith('href="/admin" aria-current')).toBe(false);
  });

  describe('그룹 펼침 규칙(자동으로는 열기만, 닫기는 사용자만)', () => {
    it('첫 방문은 현재 그룹만 연다', () => {
      mocks.pathname = '/admin/catalog/goods';
      const html = renderSaved(null);
      expect(groupState(html, 'catalog')).toBe('open');
      expect(groupState(html, 'sales')).toBe('closed');
      expect(groupState(html, 'cs')).toBe('closed');
    });

    it('다른 그룹에서 왔으면 첫 HTML부터 저장값 ∪ {현재 그룹}으로 그린다(깜빡임 없음)', () => {
      mocks.pathname = '/admin/catalog/goods';
      const html = renderSaved({ openGroupIds: ['sales'], favoriteScreenIds: ['dispatch'], currentGroupId: 'sales' });
      expect(groupState(html, 'sales')).toBe('open');
      expect(groupState(html, 'catalog')).toBe('open');
      expect(groupState(html, 'cs')).toBe('closed');
      expect(html).toContain('data-admin-nav-group="favorites"');
      expect(html).toMatch(/data-admin-nav-group="favorites"[\s\S]*data-admin-nav-screen="dispatch"/);
    });

    it('현재 그룹을 접어 둔 채 새로고침하면 접힌 채로 그리고 머리글에 위치를 표시한다', () => {
      mocks.pathname = '/admin/catalog/goods';
      const html = renderSaved({ openGroupIds: ['sales'], favoriteScreenIds: [], currentGroupId: 'catalog' });
      expect(groupState(html, 'catalog')).toBe('closed');
      expect(groupState(html, 'sales')).toBe('open');
      const header = html.match(/<button[^>]*aria-controls="admin-nav-group-catalog"[^>]*>/)?.[0] ?? '';
      expect(header).toContain(' data-active=""');
      expect(header).toContain('aria-label="상품관리, 현재 위치 상품 조회/수정"');
    });

    it('모두 접기 뒤 새로고침해도 전부 접힌 채다', () => {
      mocks.pathname = '/admin/catalog/goods';
      const html = renderSaved({ openGroupIds: [], favoriteScreenIds: [], currentGroupId: 'catalog' });
      expect(html.match(/data-state="open"/g)).toBeNull();
    });

    it('접힌 패널의 링크는 hidden이라 Tab 순서에서 빠진다', () => {
      const html = renderSaved(null);
      expect(panelTag(html, 'sales')).toContain('hidden=""');
      mocks.pathname = '/admin/sales/orders';
      const open = renderSaved(null);
      expect(panelTag(open, 'sales')).not.toContain('hidden=""');
      expect(open).toContain('href="/admin/catalog/goods"');
    });

    it('머리글은 펼침 상태와 패널을 가리킨다', () => {
      mocks.pathname = '/admin/sales/orders';
      const html = renderSaved(null);
      expect(html).toMatch(/<button[^>]*aria-controls="admin-nav-group-sales"[^>]*aria-expanded="true"/);
      expect(html).toMatch(/<button[^>]*aria-controls="admin-nav-group-catalog"[^>]*aria-expanded="false"/);
      expect(html).not.toContain('role="menu"');
    });

    it('펼쳐진 현재 그룹의 머리글에는 활성 표시를 주지 않고 글자색만 남긴다', () => {
      mocks.pathname = '/admin/sales/orders';
      const header = renderSaved(null).match(/<button[^>]*aria-controls="admin-nav-group-sales"[^>]*>/)?.[0] ?? '';
      expect(header).toContain('text-primary-soft-foreground');
      expect(header).not.toContain(' data-active=""');
    });

    it('판매자센터 줄에 모두 접기 버튼이 있고, 하나도 열려 있지 않으면 비활성이다', () => {
      mocks.pathname = '/admin/sales/orders';
      const open = renderSaved(null);
      expect(open).toMatch(/data-admin-nav-collapse-all=""[^>]*>모두 접기</);
      expect(open.match(/<button[^>]*data-admin-nav-collapse-all[^>]*>/)?.[0]).not.toContain(' disabled=""');
      mocks.pathname = '/admin';
      expect(renderSaved(null).match(/<button[^>]*data-admin-nav-collapse-all[^>]*>/)?.[0]).toContain(' disabled=""');
    });
  });

  describe('아이콘 막대', () => {
    it('그룹 패널 대신 버튼만 그리고, 현재 그룹 아이콘에 활성 표시와 현재 위치 이름을 준다', () => {
      mocks.pathname = '/admin/cs/inquiries';
      const html = renderSaved({ openGroupIds: ['sales'], favoriteScreenIds: [], currentGroupId: 'cs' }, { open: false });
      expect(html).not.toContain('id="admin-nav-group-sales"');
      expect(html).not.toContain('aria-haspopup');
      expect(html).toMatch(/<button[^>]*aria-label="문의\/리뷰관리, 현재 위치 고객문의 관리"/);
      expect(html.match(/<button[^>]*aria-label="문의\/리뷰관리, 현재 위치 고객문의 관리"[^>]*>/)?.[0]).toContain(' data-active=""');
      expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>/);
    });

    it('즐겨찾기는 별 대신 그룹 아이콘으로 구분한다(펼친 상태는 별 유지)', () => {
      mocks.pathname = '/admin/cs/inquiries';
      const saved = { openGroupIds: [], favoriteScreenIds: ['dispatch'], currentGroupId: 'cs' };
      const iconOf = (html: string) => {
        const favorites = html.slice(html.indexOf('data-admin-nav-group="favorites"'));
        return favorites.match(/data-admin-nav-screen="dispatch"[^>]*>\s*<svg[^>]*class="([^"]*)"/)?.[1] ?? '';
      };
      expect(iconOf(renderSaved(saved, { open: false }))).not.toContain('lucide-star');
      expect(iconOf(renderSaved(saved))).toContain('lucide-star');
    });

    /* 그룹 라벨은 투명한 채 -mt-8로 올라가 바로 위 항목(홈·맨 아래 즐겨찾기)의 아래 24px를 덮었다. 위쪽 8px만 눌렸다. */
    it('그룹 라벨이 바로 위 아이콘을 덮어도 포인터를 받지 않는다', () => {
      mocks.pathname = '/admin/cs/inquiries';
      const html = renderSaved({ openGroupIds: [], favoriteScreenIds: ['dispatch', 'orders'], currentGroupId: 'cs' }, { open: false });
      const labels = html.match(/<div[^>]*data-slot="sidebar-group-label"[^>]*>/g) ?? [];
      expect(labels.length).toBeGreaterThanOrEqual(2);
      for (const label of labels) expect(label).toContain('group-data-[collapsible=icon]:pointer-events-none');
    });

    it('즐겨찾기 별은 아이콘 막대에서 자리를 차지하지 않는다', () => {
      mocks.pathname = '/admin/cs/inquiries';
      const html = renderSaved({ openGroupIds: [], favoriteScreenIds: ['dispatch'], currentGroupId: 'cs' }, { open: false });
      const stars = html.match(/<button[^>]*data-admin-nav-favorite="[^"]*"[^>]*>/g) ?? [];
      expect(stars.length).toBeGreaterThanOrEqual(2);
      for (const star of stars) expect(star).toContain('group-data-[collapsible=icon]:hidden');
    });

    it('모두 접기 줄을 위에 붙이는 것은 펼친 상태에서만이다', () => {
      mocks.pathname = '/admin/cs/inquiries';
      expect(renderSaved(null, { open: false })).not.toContain('data-admin-nav-sticky-label');
    });

    it('모두 접기는 아이콘 막대에서 보이지 않는다', () => {
      mocks.pathname = '/admin/cs/inquiries';
      expect(renderSaved(null, { open: false }).match(/<button[^>]*data-admin-nav-collapse-all[^>]*>/)?.[0]).toContain('group-data-[collapsible=icon]:hidden');
    });
  });

  describe('메뉴 스크롤 영역', () => {
    it('모두 접기 줄은 목록과 함께 사라지지 않게 위에 붙는다', () => {
      mocks.pathname = '/admin/sales/orders';
      const label = renderSaved(null).match(/<div[^>]*data-admin-nav-sticky-label=""[^>]*>/)?.[0] ?? '';
      expect(label).toContain('sticky');
      expect(label).toContain('top-0');
      expect(label).toContain('bg-sidebar');
    });

    it('스크롤바가 생겨도 줄이 밀리지 않게 자리를 잡고, 스크롤이 없는 아이콘 막대는 비운다', () => {
      const content = renderSaved(null).match(/<div[^>]*data-slot="sidebar-content"[^>]*>/)?.[0] ?? '';
      expect(content).toContain('[scrollbar-gutter:stable]');
      expect(content).toContain('group-data-[collapsible=icon]:[scrollbar-gutter:auto]');
      expect(content).toContain('scroll-pt-8');
    });
  });

  describe('메뉴 검색칸과 펼침 전환', () => {
    it('브라우저 기본 지우기(X)를 숨겨 지우기 버튼이 하나만 보인다', () => {
      expect(renderSaved(null)).toContain('[&amp;::-webkit-search-cancel-button]:hidden');
    });

    it('펼치는 동안 내용 폭을 고정하고 바깥에서 잘라 글자가 세로로 쌓이지 않는다', () => {
      const html = renderSaved(null);
      expect(html).toContain('group-data-[state=expanded]:w-[calc(var(--sidebar-width)-1rem)]');
      expect(html.indexOf('flex min-h-0 flex-1 flex-col overflow-hidden')).toBeGreaterThan(-1);
      expect(html.indexOf('flex min-h-0 flex-1 flex-col overflow-hidden')).toBeLessThan(html.indexOf('group-data-[state=expanded]:w-[calc'));
    });
  });

  it('staff에게는 역할 관리를 감춘다', () => {
    expect(render('staff')).not.toContain('href="/admin/community/roles"');
    expect(render('admin')).toContain('href="/admin/community/roles"');
  });

  /*
   * 에픽 #248이 끝나면서 셸의 `planned` 자리 표시가 전부 소진됐다. 새 화면을
   * `planned`로 추가하면 이 단언이 먼저 깨져 "메뉴에는 있는데 라우트가 없는"
   * 상태를 알려 준다.
   */
  it('메뉴에 준비 중 자리 표시가 남아 있지 않다', () => {
    const html = render();

    expect(html).not.toContain('준비 중');
    expect(html).not.toContain('aria-disabled="true"');
  });

  it('에픽 #248이 연 화면들이 모두 링크로 붙어 있다', () => {
    const html = render();

    expect(html).toContain('href="/admin/cs/inquiries"');
    expect(html).toContain('href="/admin/cs/reviews"');
    expect(html).toContain('href="/admin/sales/unpaid"');
    expect(html).toContain('href="/admin/stats/sales"');
    expect(html).toContain('href="/admin/stats/claims"');
    expect(html).toContain('href="/admin/stats/customers"');
  });
});
