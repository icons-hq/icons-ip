import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Good } from '@/lib/data';
import type { ProductCardProps } from '@/components/wc/ProductCard';
import type { PublicGoodOtherCompositions } from '@/lib/good-other-compositions';
import { GoodOtherCompositions } from './GoodOtherCompositions';

const mocks = vi.hoisted(() => ({ card: vi.fn() }));
vi.mock('@/components/wc/ProductCard', () => ({ ProductCard: (props: ProductCardProps) => {
  mocks.card(props);
  return <a href={props.href}>{props.name}</a>;
} }));
const good: Good = { id: 'good-b', name: '라벤더 세트', ip: 'public-ip', type: '굿즈', price: 3000, priceMax: 5000, compareAtPrice: 6000,
  showDiscountRate: false, stock: 'soldout', stockQty: 0, badge: null, img: '#fff' };
const data: PublicGoodOtherCompositions = { groups: [{ id: '99000000-0000-4000-8000-000000000301', title: '다른 구성도 살펴보세요',
  goods: [{ good, compositionLabel: '2개 세트' }, { good: { ...good, id: 'good-c' }, compositionLabel: null }] }], nextChangeAt: null };
beforeEach(() => { vi.clearAllMocks(); });

describe('다른 구성 공개 표시', () => {
  it('기존 상품 카드에 가격·품절·담기·이미지 계약을 전달하고 선택적 구성 문구만 더한다', () => {
    const html = renderToStaticMarkup(<GoodOtherCompositions data={data} />);
    expect(mocks.card.mock.calls[0][0]).toMatchObject({ href: '/shop/good-b', price: 3000, priceMax: 5000, compareAtPrice: 6000,
      showDiscountRate: false, soldOut: true, cartGood: good, imageBackground: '#fff', listSurface: 'standard' });
    expect(html).toContain('2개 세트');
    expect(html.match(/class="wc-pdp-other-compositions__label"/g)).toHaveLength(1);
    expect(html).toContain('aria-labelledby="good-other-composition-99000000-0000-4000-8000-000000000301"');
    expect(html).toContain('aria-label="다른 구성도 살펴보세요 목록" tabindex="0"');
  });

  it('여러 편성의 같은 상품을 유지하고 제목·문구를 HTML로 실행하지 않는다', () => {
    const second = { ...data.groups[0], id: '99000000-0000-4000-8000-000000000302', title: '<b>다른 구성</b>', goods: [{ good, compositionLabel: '<script>구성</script>' }] };
    const html = renderToStaticMarkup(<GoodOtherCompositions data={{ ...data, groups: [...data.groups, second] }} />);
    expect(html.match(/href="\/shop\/good-b"/g)).toHaveLength(2);
    expect(html).toContain('&lt;b&gt;다른 구성&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;구성&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  /* L4b · CL-01·CL-02 — 다른 구성 카드도 상세가 내려 준 위시 상태·별점으로 하트와 별점을 단다. */
  it('카드 action 슬롯에 목록 하트를, 별점은 리뷰가 있는 굿즈에만 넘긴다', () => {
    renderToStaticMarkup(<GoodOtherCompositions data={data} reviewSummaries={{ 'good-c': { count: 2, average: 4.5 } }} wishlist={{ viewerId: 'viewer-1', goodIds: ['good-b'] }} />);
    const [first, second] = mocks.card.mock.calls.map(([props]) => props as ProductCardProps);

    expect(first.reviewSummary).toBeUndefined();
    expect(second.reviewSummary).toEqual({ count: 2, average: 4.5 });
    expect(first.action).toMatchObject({ props: { goodId: 'good-b', initialWished: true, label: '라벤더 세트', viewerId: 'viewer-1' } });
    expect(second.action).toMatchObject({ props: { goodId: 'good-c', initialWished: false, viewerId: 'viewer-1' } });

    mocks.card.mockClear();
    renderToStaticMarkup(<GoodOtherCompositions data={data} />);
    expect(mocks.card.mock.calls.every(([props]) => (props as ProductCardProps).action === undefined)).toBe(true);
  });

  it('정상 0후보는 숨기고 전송 실패는 재시도 안내를 표시한다', () => {
    expect(renderToStaticMarkup(<GoodOtherCompositions data={{ groups: [], nextChangeAt: null }} />)).toBe('');
    expect(renderToStaticMarkup(<GoodOtherCompositions data={{ groups: [], nextChangeAt: null, unavailable: true }} />))
      .toContain('다른 구성 굿즈를 불러오지 못했습니다.');
  });
});
