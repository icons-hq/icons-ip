import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/* 신고 폼의 server action은 Supabase·쿠키를 끌고 온다 — 예시 렌더 검증에는 대역으로 둔다(GoodReviews.test와 같다). */
vi.mock('@/app/community/actions', () => ({ reportCommunityTargetAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { ReviewDisplayExample, ReviewDisplayExampleContent } from './ReviewDisplayExample';

const repoFile = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const NOW = new Date('2026-11-11T03:00:00.000Z');

/* SHEET-027: 리뷰 관리 화면의 고객 화면 노출 예시. 공개 부품으로 그리고, 고객 화면과 같은 자리·이름을 쓴다. */
describe('ReviewDisplayExampleContent', () => {
  const html = renderToStaticMarkup(<ReviewDisplayExampleContent now={NOW} />);

  it('labels each area as an example in the order customers meet them', () => {
    const steps = ['예시 ①', '예시 ②', '예시 ③', '예시 ④', '예시 ⑤'].map(step => html.indexOf(step));
    expect(steps.every(index => index >= 0)).toBe(true);
    expect(steps).toEqual([...steps].sort((left, right) => left - right));
    expect(html.indexOf('wc-product-card')).toBeLessThan(html.indexOf('wc-gallery-best-reviews'));
    expect(html.indexOf('wc-gallery-best-reviews')).toBeLessThan(html.indexOf('wc-pdp-tools__rating'));
    expect(html.indexOf('wc-pdp-tools__rating')).toBeLessThan(html.indexOf('wc-pdp-review-summary'));
    expect(html.indexOf('wc-pdp-review-summary')).toBeLessThan(html.indexOf('wc-review-list'));
  });

  /* 리뷰 지적: 대표이미지 갤러리의 BEST 리뷰 장도 고객이 리뷰를 보는 자리다. 공개 부품(PdpGallery·GalleryBestReviews)으로 그 장만 그린다. */
  it('shows the gallery BEST review slide with three cards and says when customers see it', () => {
    const best = html.slice(html.indexOf('<section class="wc-gallery-best-reviews"'), html.indexOf('</section>', html.indexOf('<section class="wc-gallery-best-reviews"')));
    expect(best).toContain('<h2 id="gallery-best-reviews-heading">BEST 리뷰</h2>');
    expect(best).toContain('운영자가 선정한 구매 리뷰');
    expect(best.match(/<li>/g)).toHaveLength(3);
    expect(best).toContain('리뷰 모두 보기');
    expect(html).toMatch(/<section aria-label="\[예시\] 아크릴 스탠드 이미지" aria-roledescription="carousel" class="wc-pdp-gallery" data-active-kind="reviews">/);
    expect(html).toContain('BEST 리뷰를 켜고 이 상품에 선정한 리뷰가 3개 이상일 때만');
    expect(html.indexOf('wc-pdp__layout')).toBeLessThan(html.indexOf('wc-pdp-gallery'));
    expect(html.indexOf('wc-pdp-gallery')).toBeLessThan(html.indexOf('wc-pdp__info'));
  });

  it('renders the public review tab opened, with summary, list, reply and event disclosure', () => {
    expect(html).toContain('리뷰 (4)');
    expect(html).toMatch(/<div aria-labelledby="pdp-tab-reviews" class="wc-tabs__panel" id="pdp-panel-reviews" role="tabpanel"/);
    expect(html).toMatch(/id="pdp-panel-detail"[^>]*hidden=""|hidden=""[^>]*id="pdp-panel-detail"/);
    for (const part of ['wc-review-summary__score', 'wc-review-summary__dist', 'wc-review-list', 'wc-review-item__reply', 'ICONS 운영자', '한달사용 리뷰', '재구매', '수정됨', '‘예시 포토리뷰 이벤트’ 선정']) {
      expect(html, part).toContain(part);
    }
    expect(html).toContain('4.3');
    expect(html).toContain('4개 리뷰보기');
  });

  it('shows the listing rating only on the card that has reviews', () => {
    expect(html.match(/class="wc-product-card__rating"/g)).toHaveLength(1);
    expect(html).toContain('(4)');
    expect(html).not.toMatch(/src="https?:/);
  });
});

describe('ReviewDisplayExample panel', () => {
  it('stays folded under the review list until opened, without building the example', () => {
    const html = renderToStaticMarkup(<ReviewDisplayExample />);
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*data-review-display-example=""/);
    expect(html).toContain('고객 화면 노출 예시 (PC·모바일)');
    expect(html).toContain('예시 데이터');
    expect(html).not.toContain('wc-review-list');
    expect(html).not.toContain('<iframe');
  });
});

/* 가격 아래 별점 줄은 GoodDetail 안의 마크업을 옮겨 적었다. 상세가 바뀌면 여기서 먼저 깨진다 — 예시도 함께 맞춘다. */
describe('example markup stays in step with the product detail page', () => {
  it('copies the rating row and tab names from GoodDetail', () => {
    const detail = repoFile('components/screens/GoodDetail.tsx');
    for (const part of ['<p className="wc-pdp-tools__rating">', '<strong className="wc-pdp-tools__average">{formatReviewAverage(reviewSummary.average)}</strong>',
      '<a className="wc-pdp-tools__reviews"', "{reviewSummary.count.toLocaleString('ko-KR')}개 리뷰보기", '<span className="wc-rating__stars">',
      "label: '상세정보'", "label: '리뷰'", "label: 'Q&A'", "label: '추가정보'", 'idBase="pdp"', '<div className="wc-pdp-panel">',
      '<div className="wc-pdp__layout">', 'selectedReviews={selectedReviews} />', '<div className="wc-pdp__info">']) {
      expect(detail, part).toContain(part);
    }
  });

  it('renders the same review blocks the product detail route renders', () => {
    const page = repoFile('app/shop/[goodId]/page.tsx');
    expect(page).toContain('reviews={<GoodReviews goodId={goodId} section={reviewSection} />}');
    expect(page).toContain('reviewHighlights={<ProductDetailReviewSummary goodId={goodId} data={presentation} />}');
    expect(page).toContain('selectedReviews={selectedReviews.length === 3 ? <GalleryBestReviews goodId={goodId} cards={selectedReviews} /> : undefined}');
  });
});
