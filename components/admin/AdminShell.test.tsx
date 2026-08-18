import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminShell } from './AdminShell';

const mocks = vi.hoisted(() => ({ pathname: '/admin' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

const admin = { id: 'admin-1', email: 'ops@example.test', role: 'staff' };

function render(children = <p>본문</p>) {
  return renderToStaticMarkup(<AdminShell admin={admin}>{children}</AdminShell>);
}

describe('AdminShell', () => {
  beforeEach(() => {
    mocks.pathname = '/admin';
  });

  /* editorial-admin.css 의 `#root:has(> .admin-shell)` 이 이 클래스를 보고
   * 어드민 캔버스를 덮어쓴다. 클래스가 사라지면 공개 화면 테마가 새어 들어온다. */
  it('셸 루트에 admin-shell 클래스를 남긴다', () => {
    expect(render()).toContain('class="admin-shell"');
  });

  it('현재 화면 이름을 헤더 제목으로 쓴다', () => {
    mocks.pathname = '/admin/catalog/ticket-types';

    expect(render()).toContain('티켓 회차');
  });

  it('본문을 그대로 렌더한다', () => {
    expect(render(<p>주문 목록</p>)).toContain('주문 목록');
  });

  it('관리자 이메일과 역할을 헤더에 보여준다', () => {
    const html = render();

    expect(html).toContain('ops@example.test');
    expect(html).toContain('staff');
  });
});
