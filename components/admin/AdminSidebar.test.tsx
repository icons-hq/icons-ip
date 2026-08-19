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

    expect(html).toContain('판매 관리');
    expect(html).toContain('카탈로그 관리');
    expect(html).toContain('주문 통합검색');
    expect(html).toContain('href="/admin/catalog/goods"');
  });

  /* 대분류 순서가 뒤집히면 운영자가 익힌 메뉴 위치가 매번 달라진다. */
  it('대분류를 정해진 순서로 세운다', () => {
    const html = render();

    expect(html.indexOf('판매 관리')).toBeLessThan(html.indexOf('카탈로그 관리'));
    expect(html.indexOf('카탈로그 관리')).toBeLessThan(html.indexOf('통계'));
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
