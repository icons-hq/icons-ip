import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PublicShoppingStoryGood, PublicShoppingStorySection } from '@/lib/shopping-stories';
import { ShoppingStoryContent } from './ShoppingStoryContent';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

const good = (id: string, overrides: Partial<PublicShoppingStoryGood> = {}): PublicShoppingStoryGood => ({
  id, name: `스토리 ${id}`, price: 9000, priceMax: 9000, compareAtPrice: null, showDiscountRate: true, imageBackground: '', badge: null, soldOut: false, ...overrides,
});
const sections: PublicShoppingStorySection[] = [{ id: '11111111-1111-4111-8111-111111111111', title: '함께 보면 좋은 굿즈', imageShape: 'portrait',
  goods: [good('s1', { reviewSummary: { count: 5, average: 4.4 } }), good('s2')] }];

function render(wishlist?: Parameters<typeof ShoppingStoryContent>[0]['wishlist']) {
  return renderToStaticMarkup(<ShoppingStoryContent bodyHtml="<p>본문</p>" sections={sections} title="가을 스토리" wishlist={wishlist} />);
}

/* L4b · CL-01·CL-02 — 쇼핑스토리 상품 카드도 목록 카드처럼 하트(링크 밖 형제)와 리뷰가 있을 때만 별점을 단다. */
describe('ShoppingStoryContent listing cards', () => {
  it('공개 화면이 넘긴 위시 상태로 하트를, 로더가 실은 별점을 카드에 단다', () => {
    const html = render({ viewerId: 'viewer-1', goodIds: ['s2'] });

    expect(html.match(/class="wc-product-card__action"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="스토리 s1 위시리스트에 담기"');
    expect(html).toContain('aria-label="스토리 s2 위시리스트에서 빼기"');
    expect(html.match(/class="wc-product-card__rating"/g)).toHaveLength(1);
    expect(html).toContain('평점 5점 만점에 4.4점, 리뷰 5개');
    /* 섹션이 정한 이미지 비율 계약은 그대로다. */
    expect(html).toContain('data-list-shape="portrait"');
  });

  /* 에디터 미리보기는 위시 상태를 넘기지 않는다 — 저장하면 안 되는 자리라 하트가 없다. */
  it('위시 상태를 받지 않은 렌더(에디터 미리보기)에는 하트가 없다', () => {
    expect(render()).not.toContain('wc-list-heart');
    expect(render(null)).not.toContain('wc-list-heart');
  });
});
