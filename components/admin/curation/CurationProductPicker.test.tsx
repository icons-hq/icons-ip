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
/* kit 표(Table) 부품은 행·칸에 data-slot·class를 붙인다 — 속성과 무관하게 행과 칸을 찾는다. */
const rowOf = (html: string, id: string) => html.match(new RegExp(`<tr[^>]*>(?:(?!</tr>).)*<span[^>]*>${id}</span>(?:(?!</tr>).)*</tr>`))?.[0] ?? '';
const cell = (text: string) => new RegExp(`<td[^>]*>${text}</td>`);

describe('CurationProductPicker 평점 열', () => {
  /* L4b(2026-10-26 리드 결정) — 리뷰 BEST 상품 선택기의 평점은 공개 홈이 선정·표시에 쓰는 값(그룹상품 범위 요약)이다. */
  it('그룹 범위 요약이 있으면 그 평균·수를, 없으면 굿즈 단위 집계를 보인다', () => {
    const html = renderToStaticMarkup(<CurationProductPicker
      goods={[card('m1', { reviewSummary: { count: 3, average: 2.33 } }), card('m2')]}
      limit={20} onApply={() => undefined} onClose={() => undefined}
      options={[{ id: 'm1', title: '10주년 기념 키링', archivedAt: null }, { id: 'm2', title: '2단 필통', archivedAt: null }]}
      reviewStatistics={[stat('m1', 5, 1), stat('m2', 4.33, 3)]} selectedIds={[]} />);

    expect(html).toMatch(/<th[^>]*>평점 \/ 리뷰 수<\/th>/);
    expect(rowOf(html, 'm1')).toMatch(cell('2\\.33 / 3개'));
    expect(rowOf(html, 'm1')).not.toContain('5.00');
    expect(rowOf(html, 'm2')).toMatch(cell('4\\.33 / 3개'));
  });

  it('리뷰 BEST가 아니면 평점 열이 없다', () => {
    const html = renderToStaticMarkup(<CurationProductPicker goods={[card('m1')]} limit={4} onApply={() => undefined} onClose={() => undefined}
      options={[{ id: 'm1', title: '2단 필통', archivedAt: null }]} selectedIds={[]} />);
    expect(html).not.toContain('평점 / 리뷰 수');
  });
});

describe('CurationProductPicker URL 추가', () => {
  it('상품 상세 주소를 붙여 넣는 칸을 검색과 따로 둔다', () => {
    const html = renderToStaticMarkup(<CurationProductPicker goods={[card('m1')]} limit={4} onApply={() => undefined} onClose={() => undefined}
      options={[{ id: 'm1', title: '2단 필통', archivedAt: null }]} selectedIds={[]} />);
    expect(html).toContain('상품 URL로 추가');
    expect(html).toContain('placeholder="https://iconsip.com/shop/상품ID 또는 /shop/상품ID"');
  });

  /* 1014-112 — 여러 줄 붙여넣기와 엑셀 한 열 추가는 검색 폼을 제출하지 않는 별도 묶음이다. */
  it('여러 상품 한 번에 추가(여러 줄 붙여넣기·엑셀)를 둔다', () => {
    const html = renderToStaticMarkup(<CurationProductPicker goods={[card('m1')]} limit={4} onApply={() => undefined} onClose={() => undefined}
      options={[{ id: 'm1', title: '2단 필통', archivedAt: null }]} selectedIds={[]} />);
    expect(html).toContain('여러 상품 한 번에 추가');
    expect(html).toContain('여러 줄 붙여넣기');
    expect(html).toContain('또는 엑셀로 추가(한 열)');
    expect(html).toMatch(/<input[^>]*accept=".xlsx,.csv,.tsv,.txt"[^>]*type="file"/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>상품 확인<\/button>/);
  });
});
