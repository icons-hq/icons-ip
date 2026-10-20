import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/components/wc/ProductCard', () => ({ ProductCard: ({ name }: { name: string }) => <span>{name}</span> }));
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
});
