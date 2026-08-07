import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteFooter } from './SiteFooter';

const mocks = vi.hoisted(() => ({ pathname: '/shop' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

function render() {
  return renderToStaticMarkup(<SiteFooter />);
}

describe('SiteFooter 법정 고지 링크', () => {
  beforeEach(() => {
    mocks.pathname = '/shop';
  });

  it('이용약관·개인정보처리방침을 실제 링크로 건다', () => {
    const html = render();

    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('이용약관');
    expect(html).toContain('개인정보처리방침');
  });

  it('배송·반품 정책 링크를 추가한다', () => {
    const html = render();

    expect(html).toContain('href="/legal/shipping"');
    expect(html).toContain('배송·반품 정책');
  });

  it('약관 문구를 링크 없는 span으로 남기지 않는다', () => {
    const html = render();

    expect(html).not.toContain('<span>이용약관</span>');
    expect(html).not.toContain('<span>개인정보처리방침</span>');
  });

  it('법정 고지 화면 자체에서도 푸터가 유지된다', () => {
    mocks.pathname = '/legal/privacy';

    expect(render()).toContain('href="/legal/terms"');
  });

  it('홈과 인증 셸에서는 푸터를 렌더하지 않는다', () => {
    for (const pathname of ['/', '/login', '/update-password', '/account-suspended', '/admin', '/games/roulette']) {
      mocks.pathname = pathname;
      expect(render(), pathname).toBe('');
    }
  });
});
