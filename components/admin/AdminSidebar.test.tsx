import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSidebar } from './AdminSidebar';

const mocks = vi.hoisted(() => ({
  pathname: '/admin',
  store: {} as Record<string, string>,
  write: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
/* 보기 상태는 브라우저 저장소에서 온다 — SSR 렌더에서는 항상 빈 값이라 여기서 끼워 넣는다. */
vi.mock('@/components/admin/catalog/browser-store', () => ({
  useBrowserStoredValue: (key: string) => mocks.store[key] ?? '',
  writeBrowserStoredValue: mocks.write,
}));

function render(role = 'staff') {
  return renderToStaticMarkup(
    <AdminSidebar collapsed={false} onCollapsedChange={() => {}} role={role} />,
  );
}

describe('AdminSidebar 2단 메뉴', () => {
  beforeEach(() => {
    mocks.pathname = '/admin';
    mocks.store = {};
    mocks.write.mockClear();
  });

  it('대분류 헤딩과 소분류 항목을 함께 보여준다', () => {
    const html = render();

    expect(html).toContain('주문');
    expect(html).toContain('주문 통합검색');
    expect(html).toContain('href="/admin/catalog/goods"');
  });

  /* 대분류 순서가 뒤집히면 운영자가 익힌 메뉴 위치가 매번 달라진다. */
  it('대분류를 정해진 순서로 세운다', () => {
    mocks.store = { 'admin:nav:tier': 'all' };
    const html = render();

    /* 편성(온라인 팝업) → 원장(상품) → 거래(주문) → 통계 → 매일 안 쓰는 셋 */
    expect(html.indexOf('온라인 팝업')).toBeLessThan(html.indexOf('굿즈'));
    expect(html.indexOf('굿즈')).toBeLessThan(html.indexOf('주문 통합검색'));
    expect(html.indexOf('주문 통합검색')).toBeLessThan(html.indexOf('팬덤 콘텐츠'));
    expect(html.indexOf('팬덤 콘텐츠')).toBeLessThan(html.indexOf('이벤트·티켓'));
  });

  it('기본 메뉴에서는 매일 쓰지 않는 그룹을 접어 둔다', () => {
    const html = render();

    expect(html).toContain('기본 메뉴');
    expect(html).not.toContain('팬덤 콘텐츠');
    expect(html).not.toContain('이벤트·티켓');
    /* 감춘 게 아니라 순서다 — 켜면 그대로 이어 붙는다. */
    expect(render()).not.toContain('href="/admin/catalog/cards"');
  });

  it('전체 메뉴를 켜면 나머지가 아래로 이어 붙는다', () => {
    mocks.store = { 'admin:nav:tier': 'all' };
    const html = render();

    expect(html).toContain('전체 메뉴');
    expect(html).toContain('팬덤 콘텐츠');
    expect(html).toContain('href="/admin/catalog/cards"');
    expect(html).toContain('href="/admin/settings/exports"');
  });

  it('기본 메뉴여도 지금 보고 있는 그룹은 남는다 — 왼쪽에서 현재 위치가 사라지면 안 된다', () => {
    mocks.pathname = '/admin/catalog/cards';
    const html = render();

    expect(html).toContain('팬덤 콘텐츠');
    expect(html).toContain('aria-current="page"');
    /* 다른 확장 그룹까지 딸려 오지는 않는다. */
    expect(html).not.toContain('이벤트·티켓');
  });

  it('그룹을 접으면 머리만 남고 화면 목록은 DOM 에서 빠진다', () => {
    mocks.store = { 'admin:nav:collapsed-groups': '["sales"]' };
    const html = render();

    expect(html).toContain('주문');
    expect(html).not.toContain('href="/admin/sales/orders"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('지금 보고 있는 그룹은 접는 단추를 주지 않는다', () => {
    mocks.pathname = '/admin/sales/orders';
    mocks.store = { 'admin:nav:collapsed-groups': '["sales"]' };
    const html = render();

    /* 접기 표시가 저장돼 있어도 현재 그룹은 펼쳐진 채로, 단추 없이 라벨만 그린다. */
    expect(html).toContain('href="/admin/sales/orders"');
    expect(html).not.toContain('주문 접기');
  });

  it('현재 화면만 aria-current를 단다', () => {
    mocks.pathname = '/admin/catalog/pools';
    const html = render();

    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  /* /admin 은 모든 경로의 접두다. 접두 일치만 쓰면 개요가 항상 켜져 보인다. */
  it('하위 화면에 있을 때 개요를 활성으로 표시하지 않는다', () => {
    mocks.pathname = '/admin/sales/orders';
    const html = render();
    const overviewLink = html.slice(html.indexOf('href="/admin"', html.indexOf('admin-nav')));

    expect(overviewLink.startsWith('href="/admin" aria-current')).toBe(false);
  });

  it('staff에게는 역할 관리를 감춘다', () => {
    expect(render('staff')).not.toContain('href="/admin/community/roles"');
    expect(render('admin')).toContain('href="/admin/community/roles"');
  });

  /*
   * 준비 중 자리 표시는 설계서 v2 모듈(프로모션·자동 알림·이력 허브·IP별 매출) 4개뿐이다
   * (옵션·재고·출고지 D-1 · 분류 D-9 · 엑셀 양식 D-4 · 팝업 목록/편성 팝업 객체로 열렸다).
   * 라우트 없는 메뉴가 늘면 여기서 깨진다.
   */
  it('준비 중 자리 표시는 설계서 v2 모듈 4개이고 링크가 아니다', () => {
    mocks.store = { 'admin:nav:tier': 'all' };
    const html = render();

    /* 라벨과 title 속성에 한 번씩 — 항목당 2회. */
    expect(html.match(/ · 준비 중/g)).toHaveLength(4);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(4);
    expect(html).toContain('href="/admin/settings/exports"');
    expect(html).toContain('href="/admin/catalog/inventory"');
    expect(html).toContain('href="/admin/catalog/categories"');
    expect(html).toContain('href="/admin/popups"');
    expect(html).toContain('href="/admin/popups/schedule"');
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
