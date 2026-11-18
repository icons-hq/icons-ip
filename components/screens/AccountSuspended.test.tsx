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

  /* 정지 회원도 계정 문의로 탈퇴를 요청하고 그 답변을 확인한다(원장 CUS-035). */
  it('계정 문의 작성과 내 문의 목록으로 잇는다', () => {
    const html = renderToStaticMarkup(<AccountSuspended />);

    expect(html).toContain('href="/my/inquiries/new?category=account"');
    expect(html).toContain('계정 문의하기');
    expect(html).toContain('href="/my/inquiries"');
    expect(html).toContain('내 문의 보기');
    expect(html).toContain('회원 탈퇴를 원하면');
  });
});
