import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HomeGoodsCard } from '@/lib/home-catalog';
import type { HomeReviewStatistic } from '@/lib/home-ranking';
import { CurationProductPicker } from './CurationProductPicker';

const card = (id: string, extra: Partial<HomeGoodsCard> = {}): HomeGoodsCard => ({
  id, name: `상품 ${id}`, brand: null, price: 12000, badge: null, imageBg: '#eee', href: `/shop/${id}`, soldOut: false, ...extra,
});
const stat = (goodId: string, ratingAverage: number, reviewCount: number): HomeReviewStatistic => ({
  goodId, ratingAverage, reviewCount, recentReviewAt: null,
  representative: { id: `review-${goodId}`, rating: 5, body: '공개 후기', authorName: '공개 닉네임', createdAt: '2026-10-20T00:00:00Z' },
});
const rowOf = (html: string, id: string) => html.match(new RegExp(`<tr>(?:(?!</tr>).)*<span>${id}</span>(?:(?!</tr>).)*</tr>`))?.[0] ?? '';

describe('CurationProductPicker 평점 열', () => {
  /* L4b(2026-10-26 리드 결정) — 리뷰 BEST 상품 선택기의 평점은 공개 홈이 선정·표시에 쓰는 값(그룹상품 범위 요약)이다. */
  it('그룹 범위 요약이 있으면 그 평균·수를, 없으면 굿즈 단위 집계를 보인다', () => {
    const html = renderToStaticMarkup(<CurationProductPicker
      goods={[card('m1', { reviewSummary: { count: 3, average: 2.33 } }), card('m2')]}
      limit={20} onApply={() => undefined} onClose={() => undefined}
      options={[{ id: 'm1', title: '10주년 기념 키링', archivedAt: null }, { id: 'm2', title: '2단 필통', archivedAt: null }]}
      reviewStatistics={[stat('m1', 5, 1), stat('m2', 4.33, 3)]} selectedIds={[]} />);

    expect(html).toContain('<th>평점 / 리뷰 수</th>');
    expect(rowOf(html, 'm1')).toContain('<td>2.33 / 3개</td>');
    expect(rowOf(html, 'm1')).not.toContain('5.00');
    expect(rowOf(html, 'm2')).toContain('<td>4.33 / 3개</td>');
  });

  it('리뷰 BEST가 아니면 평점 열이 없다', () => {
    const html = renderToStaticMarkup(<CurationProductPicker goods={[card('m1')]} limit={4} onApply={() => undefined} onClose={() => undefined}
      options={[{ id: 'm1', title: '2단 필통', archivedAt: null }]} selectedIds={[]} />);
    expect(html).not.toContain('평점 / 리뷰 수');
  });
});
