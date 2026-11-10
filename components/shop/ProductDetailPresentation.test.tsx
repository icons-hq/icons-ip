import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ card: vi.fn() }));
vi.mock('@/components/wc/ProductCard', () => ({ ProductCard: (props: { name: string }) => { mocks.card(props); return <span>{props.name}</span>; } }));
import { ProductDetailBanner, ProductDetailRecommendations, ProductDetailReviewSummary } from './ProductDetailPresentation';
import type { PublicDetailPresentation } from '@/lib/product-detail-presentation';
import type { Good } from '@/lib/data';
const cards = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, name: `추천 ${i}`, badges: [], stock: 'ok' } as unknown as Good));
const data: PublicDetailPresentation = { banner: { style: 'dark', title: '문구 안내', text: '<script>문자</script>' }, reviews: { count: 15, positiveCount: 12, cards: [{ id: 'review', rating: 4, body: '실제 리뷰입니다', authorName: '팬', createdAt: '2026-10-13T00:00:00Z', imageUrls: [] }] }, recommendations: { similar: cards, together: cards, categoryPopular: [], storePopular: [] }, nextChangeAt: null };
describe('PDP presentation public consumer', () => {
  it('uses the full ratio and escapes promotional prose', () => {
    const banner = renderToStaticMarkup(<ProductDetailBanner data={data} />), review = renderToStaticMarkup(<ProductDetailReviewSummary goodId="g0" data={data} />);
    expect(banner).toContain('&lt;script&gt;'); expect(banner).not.toContain('<script>');
    expect(review).toContain('80'); expect(review).toContain('리뷰 15건 모두 보기'); expect(review).toContain('reviewPage=1');
  });
  it('lets manual relations take precedence over their automatic counterparts', () => {
    const html = renderToStaticMarkup(<ProductDetailRecommendations data={data} manual={{ groups: [{ id: 'manual', kind: 'similar', title: '직접 편성', goods: cards }], nextChangeAt: null }} />);
    expect(html).not.toContain('비슷한 굿즈도 살펴보세요'); expect(html).toContain('함께 구매한 굿즈');
    expect(renderToStaticMarkup(<ProductDetailRecommendations data={data} manual={{ groups: [], nextChangeAt: null, unavailable: true }} />)).toBe('');
  });
  /* L4b · CL-01·CL-02 — 자동 추천 카드도 상세가 내려 준 위시 상태·별점으로 하트와 별점을 단다. */
  it('passes listing hearts and review summaries to every recommendation card', () => {
    mocks.card.mockClear();
    renderToStaticMarkup(<ProductDetailRecommendations data={data} reviewSummaries={{ g1: { count: 3, average: 4 } }} wishlist={{ viewerId: 'viewer-1', goodIds: ['g0'] }} />);
    const calls = mocks.card.mock.calls.map(([props]) => props as { name: string; action?: { props: Record<string, unknown> }; reviewSummary?: unknown });

    expect(calls).toHaveLength(10);
    expect(calls[0].action?.props).toMatchObject({ goodId: 'g0', initialWished: true, label: '추천 0', viewerId: 'viewer-1' });
    expect(calls[1].action?.props).toMatchObject({ goodId: 'g1', initialWished: false });
    expect(calls[1].reviewSummary).toEqual({ count: 3, average: 4 });
    expect(calls[0].reviewSummary).toBeUndefined();

    mocks.card.mockClear();
    renderToStaticMarkup(<ProductDetailRecommendations data={data} />);
    expect(mocks.card.mock.calls.every(([props]) => (props as { action?: unknown }).action === undefined)).toBe(true);
  });
});
