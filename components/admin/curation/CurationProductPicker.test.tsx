import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
/* 공개 홈 목록에 없는 행의 이유는 그 쪽 줄만 가볍게 읽는다 — 정적 렌더에서는 받은 뒤의 값을 바로 준다. */
vi.mock('@/components/admin/useGoodReferenceInfo', () => ({
  useGoodReferenceInfo: (ids: readonly string[]) => {
    const reasons: Record<string, string> = { d1: 'draft', i1: 'ip_draft', r1: 'restricted' };
    return { info: new Map(ids.filter(id => id in reasons).map(id => [id, { name: null, code: null, visibility: reasons[id] }])), remember: () => undefined };
  },
}));
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

/* QA1 MD 후속: 노출 상태 칸도 결과 줄·담은 목록과 같은 이유(초안·IP 초안·성인(19금))로 부른다 — '비노출'과 섞지 않는다. */
describe('CurationProductPicker 노출 상태', () => {
  it('공개 홈 목록의 상품은 노출 중·품절, 나머지는 이유 배지(모르면 고객 화면 미노출)로 보인다', () => {
    const html = renderToStaticMarkup(<CurationProductPicker goods={[card('m1'), card('s1', { soldOut: true })]} limit={4} onApply={() => undefined} onClose={() => undefined}
      options={[{ id: 'm1', title: '공개 상품', archivedAt: null }, { id: 's1', title: '품절 상품', archivedAt: null }, { id: 'd1', title: '초안 상품', archivedAt: null },
        { id: 'i1', title: 'IP 준비 상품', archivedAt: null }, { id: 'r1', title: '19금 상품', archivedAt: null }, { id: 'u1', title: '이유 모름', archivedAt: null }]} selectedIds={[]} />);
    expect(rowOf(html, 'm1')).toContain('>노출 중</span>');
    expect(rowOf(html, 's1')).toContain('>품절</span>');
    expect(rowOf(html, 'd1')).toMatch(/data-good-visibility="draft"[^>]*>.*초안<\/span>/);
    expect(rowOf(html, 'i1')).toContain('IP 초안</span>');
    expect(rowOf(html, 'r1')).toContain('성인(19금)</span>');
    expect(rowOf(html, 'u1')).toContain('고객 화면 미노출</span>');
    expect(html).not.toMatch(/비노출|비공개/);
  });
});
