import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { businessInfoRows } from '@/lib/legal/business-info';
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

  it('사업자 정보를 푸터에 표기한다', () => {
    const html = render();

    expect(html).toContain('aria-label="사업자 정보"');
    for (const row of businessInfoRows()) {
      expect(html).toContain(row.label);
      expect(html).toContain(row.value);
    }
  });

  it('결제 확정 원칙을 legacy provider 이름 없이 안내한다', () => {
    const html = render();

    expect(html).toContain('결제사 승인 확인 후 주문 확정');
    expect(html).not.toContain('토스페이먼츠 안전 결제');
  });

  it('홈과 인증 셸에서는 푸터를 렌더하지 않는다', () => {
    for (const pathname of ['/', '/login', '/update-password', '/account-suspended', '/admin', '/games/roulette', '/experiences/all-of-us-are-dead/last-bell']) {
      mocks.pathname = pathname;
      expect(render(), pathname).toBe('');
    }
  });
});

describe('SiteFooter 도메인 용어', () => {
  beforeEach(() => {
    mocks.pathname = '/shop';
  });

  /* 굿즈 클레임 유형 "교환"(회수 후 재출고)이 생기면서 카드 C2C는 "트레이드"로 개명됐다.
   * 푸터에 옛 표기가 남으면 두 개념이 같은 이름으로 보인다. */
  it('카드 C2C 링크를 트레이드로 부른다', () => {
    const html = render();

    expect(html).toContain('카드 트레이드');
    expect(html).not.toContain('카드 교환');
  });
});
