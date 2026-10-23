import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ListingWishHeart } from './ListingWishHeart';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

/* 목록 하트의 공개 계약(LFS 패리티 2차 L4 · CL-01) — 마이 위시 그리드(L6)가 같은 props 로 재사용한다.
   props 는 굿즈 ID · 초기 상태 · 뷰어(서버가 판정한 로그인 회원 ID — 게스트는 null) · 라벨 네 개다. */

function render(props: Partial<Parameters<typeof ListingWishHeart>[0]> = {}) {
  return renderToStaticMarkup(
    <ListingWishHeart goodId="g1" initialWished={false} label="홍실 키링" viewerId="viewer-1" {...props} />,
  );
}

describe('ListingWishHeart', () => {
  it('names the good in its accessible label so many hearts on one list stay distinguishable', () => {
    const html = render();

    expect(html).toContain('aria-label="홍실 키링 위시리스트에 담기"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('type="button"');
  });

  it('starts pressed and filled when the listing wish set holds the good', () => {
    const html = render({ initialWished: true });

    expect(html).toContain('aria-label="홍실 키링 위시리스트에서 빼기"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('class="wc-list-heart is-active"');
    expect(html).toContain('fill="currentColor"');
  });

  /* 게스트에게는 저장된 위시가 없다 — 로그인 벽으로 보낼 하트는 늘 빈 하트다. */
  it('never renders a guest heart as wished', () => {
    const html = render({ initialWished: true, viewerId: null });

    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('is-active');
    expect(html).toContain('fill="none"');
  });

  /* 36px 원은 장식이고 버튼이 44px 히트 영역이다(DESIGN §10). 아이콘은 접근성 트리에서 뺀다. */
  it('keeps the drawn disc and icon out of the accessibility tree', () => {
    const html = render({ className: 'wc-band__heart' });

    expect(html).toContain('class="wc-list-heart wc-band__heart"');
    expect(html).toMatch(/<span aria-hidden="true" class="wc-list-heart__disc">/);
    expect(html).toMatch(/<svg aria-hidden="true"/);
  });
});
