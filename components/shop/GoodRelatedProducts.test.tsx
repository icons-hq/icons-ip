import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodRelatedProducts } from './GoodRelatedProducts';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));
describe('연관상품 공개 목록', () => {
  it('지정 제목·가격·상세 링크를 보여주며 구매 입력을 만들지 않는다', () => {
    const html = renderToStaticMarkup(<GoodRelatedProducts data={{ nextChangeAt: null, groups: [{ id: 'group-a', kind: 'similar', title: '유사한 굿즈', goods: [{ id: 'good-b', name: '연관 굿즈', ip: 'ip', type: '문구', price: 3000, priceMax: 5000, badge: null, img: '', stock: 'ok', stockQty: 5 }] }] }} />);
    expect(html).toContain('유사한 굿즈'); expect(html).toContain('href="/shop/good-b"'); expect(html).toContain('₩3,000 ~ ₩5,000');
    expect(html).not.toContain('<form'); expect(html).not.toContain('장바구니');
  });
  /* L4b · CL-01·CL-02 — 연관 굿즈 카드도 목록 카드처럼 하트(링크 밖 형제)와 리뷰가 있을 때만 별점을 단다. */
  it('상세가 내려 준 위시 상태와 별점으로 카드마다 하트·별점을 그린다', () => {
    const goods = ['good-b', 'good-c'].map(id => ({ id, name: `연관 ${id}`, ip: 'ip', type: '문구', price: 3000, badge: null, img: '', stock: 'ok' as const, stockQty: 5 }));
    const data = { nextChangeAt: null, groups: [{ id: 'group-a', kind: 'similar' as const, title: '유사한 굿즈', goods }] };
    const html = renderToStaticMarkup(<GoodRelatedProducts data={data} reviewSummaries={{ 'good-b': { count: 7, average: 4.6 } }} wishlist={{ viewerId: 'viewer-1', goodIds: ['good-c'] }} />);

    expect(html.match(/class="wc-product-card__action"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="연관 good-b 위시리스트에 담기"');
    expect(html).toContain('aria-label="연관 good-c 위시리스트에서 빼기"');
    expect(html.match(/class="wc-product-card__rating"/g)).toHaveLength(1);
    expect(html).toContain('평점 5점 만점에 4.6점, 리뷰 7개');
    /* 위시 상태를 받지 않은 자리(어드민 미리보기)는 하트가 없다. */
    expect(renderToStaticMarkup(<GoodRelatedProducts data={data} />)).not.toContain('wc-list-heart');
  });
  it('비어 있으면 영역을 숨기고 읽기 실패는 별도로 알린다', () => {
    expect(renderToStaticMarkup(<GoodRelatedProducts data={{ groups: [], nextChangeAt: null }} />)).toBe('');
    expect(renderToStaticMarkup(<GoodRelatedProducts data={{ groups: [], nextChangeAt: null, unavailable: true }} />)).toContain('불러오지 못했습니다');
  });
});
