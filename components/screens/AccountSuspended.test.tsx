import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountSuspended } from './AccountSuspended';

vi.mock('@/app/login/actions', () => ({ signOutAction: vi.fn() }));

describe('AccountSuspended', () => {
  it('내부 제재 정보 없이 generic 안내와 로그아웃만 표시한다', () => {
    const html = renderToStaticMarkup(<AccountSuspended />);

    expect(html).toContain('계정 이용이 제한되어 있어요');
    expect(html).toContain('로그아웃');
    expect(html).not.toContain('suspension_reason');
    expect(html).not.toContain('정지 사유');
  });
});
