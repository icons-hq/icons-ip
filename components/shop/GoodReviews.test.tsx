import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodReviews } from './GoodReviews';
import type { GoodReviewItem, GoodReviewSection } from '@/lib/reviews.server';

/* 신고 폼의 server action은 Supabase·쿠키를 끌고 온다. 여기서 검증하는 것은
   "신고 경로가 붙어 있는가"라 액션 자체는 대역으로 둔다. */
vi.mock('@/app/community/actions', () => ({
  reportCommunityTargetAction: vi.fn(),
}));

function review(overrides: Partial<GoodReviewItem> = {}): GoodReviewItem {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    rating: 5,
    body: '마감이 깔끔하고 배송도 빨랐습니다',
    authorName: 'fan_888888',
    isMine: false,
    createdAt: '2026-08-17T02:00:00.000Z',
    editedAt: null,
    adminReply: null,
    adminReplyAt: null,
    imageUrls: [],
    ...overrides,
  };
}

function section(overrides: Partial<GoodReviewSection> = {}): GoodReviewSection {
  return {
    summary: {
      count: 3,
      average: 4,
      distribution: [0, 1, 0, 0, 2],
      photoCount: 1,
    },
    reviews: [review()],
    total: 3,
    pageSize: 10,
    options: { page: 1, photoOnly: false, sort: 'recent' },
    ...overrides,
  };
}

function render(overrides: Partial<GoodReviewSection> = {}) {
  return renderToStaticMarkup(<GoodReviews goodId="g13" section={section(overrides)} />);
}

describe('GoodReviews', () => {
  it('평균·개수·분포를 함께 그린다', () => {
    const html = render();

    expect(html).toContain('4.0');
    expect(html).toContain('리뷰 3건');
    expect(html).toContain('wc-review-summary__dist');
  });

  /* 별을 색으로만 구분하면 저대비 환경에서 평점이 통째로 사라진다. */
  it('별점을 스크린리더가 읽을 수 있게 남긴다', () => {
    expect(render()).toContain('5점 만점에');
  });

  it('리뷰가 없으면 왜 비었는지 말한다', () => {
    const html = render({
      summary: { count: 0, average: 0, distribution: [0, 0, 0, 0, 0], photoCount: 0 },
      reviews: [],
      total: 0,
    });

    expect(html).toContain('아직 등록된 리뷰가 없습니다');
    expect(html).not.toContain('wc-review-summary__dist');
  });

  it('정렬과 사진 필터를 링크로 건다', () => {
    const html = render();

    expect(html).toContain('reviewSort=rating_desc');
    expect(html).toContain('reviewPhoto=1');
    expect(html).toContain('사진 리뷰만');
  });

  it('운영자 답글을 리뷰와 함께 공개한다', () => {
    const html = render({
      reviews: [review({
        adminReply: '불편을 드려 죄송합니다. 교환을 도와드리겠습니다.',
        adminReplyAt: '2026-08-17T05:00:00.000Z',
      })],
    });

    expect(html).toContain('ICONS 운영자');
    expect(html).toContain('교환을 도와드리겠습니다');
  });

  /* 자기 리뷰를 자기가 신고하는 경로는 만들지 않는다 — 수정·삭제는 내 리뷰가 맡는다. */
  it('내 리뷰에는 신고 대신 관리 링크를 준다', () => {
    const mine = render({ reviews: [review({ isMine: true })] });
    const others = render();

    expect(mine).toContain('내 리뷰 관리');
    expect(mine).not.toContain('>신고<');
    expect(others).toContain('>신고<');
    expect(others).toContain('value="review"');
  });

  it('수정된 리뷰임을 밝힌다', () => {
    expect(render({ reviews: [review({ editedAt: '2026-08-18T02:00:00.000Z' })] }))
      .toContain('수정됨');
  });

  /* v1에는 리뷰 보상이 없다(#254 확정). 기대를 만들지 않도록 명시한다. */
  it('보상이 없다는 사실을 적는다', () => {
    expect(render()).toContain('적립금이나 혜택이 주어지지는 않습니다');
  });

  it('한 페이지를 넘으면 숫자 페이지네이션을 그린다', () => {
    const html = render({ total: 24 });

    expect(html).toContain('다음');
    expect(html).toContain('wc-pagination__cell');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('reviewPage=2');
    expect(render({ total: 3 })).not.toContain('wc-pagination');
  });

  /* 회귀: 기본 조건으로 돌아가는 링크가 쿼리를 비우면 굿즈 상세가 상세정보 탭으로
     열려 #reviews 앵커가 숨은 패널을 가리킨다 — "이전"·"최신순"이 무동작이 된다. */
  it('기본 조건으로 돌아가는 링크에도 reviewPage를 싣는다', () => {
    const html = render({ options: { page: 2, photoOnly: false, sort: 'recent' }, total: 24 });

    expect(html).toContain('href="/shop/g13?reviewPage=1#reviews"');
    expect(html).not.toContain('"/shop/g13#reviews"');
  });

  /* 요약부 포토 그리드는 지금 페이지에 실린 사진만 쓴다 — 없는 사진을 채우지 않는다. */
  it('사진이 있으면 요약부에 썸네일을 모은다', () => {
    const withPhoto = render({
      reviews: [review({ imageUrls: ['https://cdn.example/r1.webp'] })],
    });

    expect(withPhoto).toContain('wc-review-summary__photos');
    expect(withPhoto).toContain('https://cdn.example/r1.webp');
    expect(render()).not.toContain('wc-review-summary__photos');
  });
});
