import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { OperationsDock } from './OperationsDock';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/cs/chat' }));

describe('OperationsDock 상담 진입', () => {
  it('CS 매니저에게 현재 상담 화면 링크를 보여준다', () => {
    const access = { ...configuredOperatorAccessFixture('primary'), capabilities: ['cs.manage'] as const };
    const html = renderToStaticMarkup(<OperationsDock accountId="operator" access={{ ...access, capabilities: [...access.capabilities] }} />);
    expect(html).toContain('href="/admin/cs/chat"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('상담하기');
  });

  /* 넓은 화면에서 배지(99+)가 늦게 들어와도 옆 버튼이 밀리지 않게 칸을 먼저 잡는다. */
  it('알림 건수가 오기 전에도 배지 칸을 미리 잡는다', () => {
    const html = renderToStaticMarkup(<OperationsDock accountId="operator" access={configuredOperatorAccessFixture('primary')} />);
    expect(html).toMatch(/<span class="[^"]*xl:w-7[^"]*" data-admin-alert-badge-slot=""><\/span>/);
  });

  it('문의 권한이 없는 계정에는 상담 링크를 노출하지 않는다', () => {
    const html = renderToStaticMarkup(<OperationsDock accountId="logistics" access={configuredOperatorAccessFixture('logistics')} />);
    expect(html).not.toContain('href="/admin/cs/chat"');
  });
});
