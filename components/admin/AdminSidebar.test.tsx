import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSidebar } from './AdminSidebar';

const mocks = vi.hoisted(() => ({ pathname: '/admin' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

function render(role = 'staff') {
  return renderToStaticMarkup(
    <AdminSidebar collapsed={false} onCollapsedChange={() => {}} role={role} />,
  );
}

describe('AdminSidebar 2단 메뉴', () => {
  beforeEach(() => {
    mocks.pathname = '/admin';
  });

  it('대분류 헤딩과 소분류 항목을 함께 보여준다', () => {
    const html = render();

    expect(html).toContain('주문');
    expect(html).toContain('팬덤 콘텐츠');
    expect(html).toContain('주문 통합검색');
    expect(html).toContain('href="/admin/catalog/goods"');
  });

  /* 대분류 순서가 뒤집히면 운영자가 익힌 메뉴 위치가 매번 달라진다. */
  it('대분류를 정해진 순서로 세운다', () => {
    const html = render();

    /* 편성(온라인 팝업) → 원장(팬덤 콘텐츠) → 거래(주문 통합검색) → 통계 */
    expect(html.indexOf('온라인 팝업')).toBeLessThan(html.indexOf('팬덤 콘텐츠'));
    expect(html.indexOf('팬덤 콘텐츠')).toBeLessThan(html.indexOf('주문 통합검색'));
    expect(html.indexOf('주문 통합검색')).toBeLessThan(html.indexOf('통계'));
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
   * 준비 중 자리 표시는 설계서 v2 모듈(팝업·프로모션·자동 알림·이력 허브·IP별 매출)
   * 6개뿐이다(옵션·재고·출고지 D-1 · 분류 D-9 · 엑셀 양식 D-4 로 열렸다). 라우트 없는 메뉴가 늘면 여기서 깨진다.
   */
  it('준비 중 자리 표시는 설계서 v2 모듈 6개이고 링크가 아니다', () => {
    const html = render();

    /* 라벨과 title 속성에 한 번씩 — 항목당 2회. */
    expect(html.match(/ · 준비 중/g)).toHaveLength(6);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(6);
    expect(html).toContain('href="/admin/settings/exports"');
    expect(html).toContain('href="/admin/catalog/inventory"');
    expect(html).toContain('href="/admin/catalog/categories"');
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
