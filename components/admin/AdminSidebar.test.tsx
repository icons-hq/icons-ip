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

  /* 준비 중 화면은 라우트가 없다 — 링크로 걸면 404가 난다. */
  it('준비 중 화면은 자리만 두고 링크를 걸지 않는다', () => {
    const html = render();

    expect(html).toContain('준비 중');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href="/admin/sales/unpaid"');
    expect(html).not.toContain('href="/admin/stats/sales"');
    /* 1:1 문의는 #253, 리뷰 관리는 #254로 열렸다 — ready 화면은 링크로 남아야 한다. */
    expect(html).toContain('href="/admin/cs/inquiries"');
    expect(html).toContain('href="/admin/cs/reviews"');
  });
});
