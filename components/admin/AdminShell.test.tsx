import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminShell } from './AdminShell';

const mocks = vi.hoisted(() => ({ pathname: '/admin', search: '' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useSearchParams: () => new URLSearchParams(mocks.search) }));

const admin = { id: 'admin-1', email: 'ops@example.test', role: 'staff', operatorAccess: legacyOperatorAccessFixture('staff') };

function render(children = <p>본문</p>) {
  return renderToStaticMarkup(<AdminShell admin={admin}>{children}</AdminShell>);
}

describe('AdminShell', () => {
  beforeEach(() => {
    mocks.pathname = '/admin';
    mocks.search = '';
  });

  /* editorial-admin.css 의 `#root:has(> .admin-shell)` 이 이 클래스를 보고
   * 어드민 캔버스를 덮어쓴다. 클래스가 사라지면 공개 화면 테마가 새어 들어온다. */
  it('셸 루트에 admin-shell 클래스를 남긴다', () => {
    expect(render()).toContain('class="admin-shell wc-root wc-admin"');
  });

  it('현재 화면 이름을 헤더 제목으로 쓴다', () => {
    mocks.pathname = '/admin/catalog/ticket-types';

    expect(render()).toContain('티켓 회차');
    expect(render()).toContain('class="wc-admin__page-context"');
  });

  it('홈에는 중복 제목 행 없이 접근성 제목을 남긴다', () => {
    const html = render();

    expect(html).toContain('<h1 class="sr-only">홈</h1>');
    expect(html).not.toContain('class="wc-admin__page-context"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it('상담 화면은 대화 영역을 넓게 쓰고 상담 자체의 상태를 표시한다', () => {
    mocks.pathname = '/admin/cs/chat';
    mocks.search = 'inquiry=case-a';
    const html = renderToStaticMarkup(<AdminShell admin={admin}><p>대화 영역</p></AdminShell>);

    expect(html).toContain('admin-shell--chat');
    expect(html).toContain('<h1 class="sr-only">상담하기</h1>');
    expect(html).not.toContain('class="wc-admin__page-context"');
    expect(html).toContain('대화 영역');
    expect(html).toMatch(/aria-current="page"[^>]*data-admin-nav-screen="inquiry-chat"/);
    expect(html).toContain('value="/admin/cs/chat?inquiry=case-a"');
  });

  it('콘텐츠 운영 권한이 있으면 상단에서 커머스와 콘텐츠 운영 콘솔을 전환한다', () => {
    const html = render();
    expect(html).toContain('aria-label="콘솔 전환"');
    expect(html).toContain('<a aria-current="page" data-admin-console-link="commerce" href="/admin">커머스</a>');
    expect(html).toContain('<a data-admin-console-link="content" href="/admin/catalog/ips">콘텐츠 운영</a>');
    expect(html).toContain('data-admin-console="commerce"');

    mocks.pathname = '/admin/catalog/cards';
    const content = renderToStaticMarkup(<AdminShell admin={admin} console="content"><p>카드</p></AdminShell>);
    expect(content).toContain('data-admin-console="content"');
    expect(content).toContain('<a aria-current="page" data-admin-console-link="content" href="/admin/catalog/ips">콘텐츠 운영</a>');
    expect(content).toContain('<a data-admin-console-link="commerce" href="/admin">커머스</a>');
    expect(content).toContain('aria-label="콘텐츠 운영 메뉴"');
    expect(content).toMatch(/aria-current="page"[^>]*data-admin-nav-screen="cards"/);
    expect(content).toContain('>콘텐츠 운영</a>');
  });

  it('현재 위치는 콘텐츠 콘솔에서 콘솔 이름을 메뉴 그룹으로 다시 적지 않고, 커머스는 메뉴 그룹을 적는다', () => {
    const crumbs = (html: string) => html.slice(html.indexOf('>', html.indexOf('aria-label="현재 위치"')) + 1, html.indexOf('</nav>', html.indexOf('aria-label="현재 위치"')))
      .replace(/<[^>]+>/g, '|').split('|').map((part) => part.trim()).filter((part) => part && part !== '›');

    mocks.pathname = '/admin/catalog/cards';
    const content = renderToStaticMarkup(<AdminShell admin={admin} console="content"><p>카드</p></AdminShell>);
    expect(crumbs(content)).toEqual(['콘텐츠 운영', '카드']);

    mocks.pathname = '/admin/sales/orders';
    expect(crumbs(render())).toEqual(['홈', '판매관리', '주문통합검색']);
  });

  it('콘텐츠 운영 화면을 볼 수 없는 역할에는 콘솔 전환을 만들지 않는다', () => {
    const limited = { ...admin, operatorAccess: { mode: 'configured' as const, managerRole: 'deputy' as const, capabilities: ['home', 'catalog.read', 'cs.manage'] as ('home' | 'catalog.read' | 'cs.manage')[], revision: 1, setupRequired: false } };
    const html = renderToStaticMarkup(<AdminShell admin={limited}><p>본문</p></AdminShell>);
    expect(html).not.toContain('aria-label="콘솔 전환"');
  });

  /* R1(D1①): 미답변 문의 배지는 고객문의 목록·상세 페이지가 그린다. 셸은 공통 배지 슬롯을 두지 않는다. */
  it('상품 등록·주문 화면 셸에는 미답변 문의 배지가 없다', () => {
    mocks.pathname = '/admin/catalog/goods';
    mocks.search = 'create=1';
    expect(render()).not.toContain('admin-shell-badge');
    mocks.pathname = '/admin/sales/orders';
    mocks.search = '';
    expect(render()).not.toContain('admin-shell-badge');
  });

  it('본문을 그대로 렌더한다', () => {
    expect(render(<p>주문 목록</p>)).toContain('주문 목록');
  });

  it('상품 등록과 수정 제목을 현재 검색조건에 맞추고 등록 메뉴를 선택한다', () => {
    mocks.pathname = '/admin/catalog/goods';
    mocks.search = 'status=draft&create=1';
    const creating = render();
    expect(creating).toContain('<h1 class="wc-admin__title">상품 등록</h1>');
    expect(creating).toMatch(/aria-current="page"[^>]*data-admin-nav-screen="goods-create"/);
    expect(creating).not.toMatch(/aria-current="page"[^>]*data-admin-nav-screen="goods"/);
    expect(creating).toContain('value="/admin/catalog/goods?status=draft&amp;create=1"');

    mocks.search = 'goodId=good-a';
    const editing = render();
    expect(editing).toContain('<h1 class="wc-admin__title">상품 수정</h1>');
    expect(editing).toMatch(/aria-current="page"[^>]*data-admin-nav-screen="goods"/);
  });

  it('홈의 조회기간이 바뀌어도 제목 행을 중복 표시하지 않는다', () => {
    mocks.search = 'period=7';
    const html = render();
    expect(html).toContain('<h1 class="sr-only">홈</h1>');
    expect(html).not.toContain('class="wc-admin__page-context"');
  });

  it('관리자 이메일과 역할을 헤더에 보여준다', () => {
    const html = render();

    expect(html).toContain('ops@example.test');
    expect(html).toContain('권한 · 운영자');
  });

  it('현재 관리자 경로를 로그아웃 복귀 값으로 전달한다', () => {
    mocks.pathname = '/admin/sales/orders';

    const html = render();

    expect(html).toContain('name="next"');
    expect(html).toContain('value="/admin/sales/orders"');
  });
});
