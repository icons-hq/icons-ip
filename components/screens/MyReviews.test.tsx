import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MyReviews } from './MyReviews';
import type { MyReviewTarget } from '@/lib/reviews.server';

/* 삭제 버튼은 'use client'이고 server action을 import한다. 여기서 검증하는 것은
   목록 구조라 액션 모듈만 대역으로 둔다. */
vi.mock('@/app/my/reviews/actions', () => ({
  deleteReviewAction: vi.fn(),
}));

const NOW = new Date('2026-08-18T00:00:00.000Z');

function target(overrides: Partial<MyReviewTarget> = {}): MyReviewTarget {
  return {
    orderId: '99999999-9999-4999-8999-999999999999',
    goodId: 'g13',
    goodName: '아크릴 블록',
    goodBg: null,
    orderedAt: '2026-08-01T00:00:00.000Z',
    deliveredAt: '2026-08-10T00:00:00.000Z',
    deadlineAt: '2026-11-08T00:00:00.000Z',
    writable: true,
    review: null,
    ...overrides,
  };
}

function writtenReview(overrides: Partial<NonNullable<MyReviewTarget['review']>> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    rating: 4,
    body: '마감이 깔끔합니다',
    imagePaths: [],
    imageUrls: [],
    status: 'visible' as const,
    createdAt: '2026-08-11T00:00:00.000Z',
    editedAt: null,
    adminReply: null,
    adminReplyAt: null,
    ...overrides,
  };
}

function render(targets: MyReviewTarget[]) {
  return renderToStaticMarkup(<MyReviews now={NOW} targets={targets} />);
}

describe('MyReviews', () => {
  it('작성 가능한 굿즈에 남은 기한과 작성 링크를 준다', () => {
    const html = render([target()]);

    expect(html).toContain('작성할 수 있는 리뷰 1건');
    expect(html).toContain('리뷰 쓰기');
    expect(html).toContain('작성 기한 82일 남음');
    expect(html).toContain('goodId=g13');
  });

  it('리뷰가 없으면 왜 비었는지 말한다', () => {
    const html = render([]);

    expect(html).toContain('지금 리뷰를 남길 수 있는 굿즈가 없습니다');
  });

  it('작성한 리뷰에는 수정과 삭제 경로를 준다', () => {
    const html = render([target({ writable: false, review: writtenReview() })]);

    expect(html).toContain('내가 쓴 리뷰 1건');
    expect(html).toContain('/my/reviews/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(html).toContain('>삭제</button>');
  });

  /* 블라인드는 삭제가 아니다. 왜 안 보이는지 말하지 않으면 사용자는 자기 글이
     사라졌다고만 알고 물어볼 근거조차 갖지 못한다. */
  it('블라인드된 리뷰는 이유와 문의 경로를 함께 밝힌다', () => {
    const html = render([target({
      writable: false,
      review: writtenReview({ status: 'hidden' }),
    })]);

    expect(html).toContain('비공개 처리되어 굿즈 상세에는 보이지 않습니다');
    expect(html).toContain('/my/inquiries/new');
    expect(html).not.toContain('>수정</a>');
  });

  /* 기한이 지나도 삭제는 상시다 — 수정만 닫힌다. */
  it('기한이 지난 리뷰는 수정을 닫고 삭제는 남긴다', () => {
    const html = render([target({
      deliveredAt: '2026-01-01T00:00:00.000Z',
      writable: false,
      review: writtenReview(),
    })]);

    expect(html).toContain('수정할 수 없습니다');
    expect(html).toContain('>삭제</button>');
  });

  /* 사라진 항목은 "왜 못 쓰는지"를 설명하지 못한다. */
  it('기한이 지난 미작성 굿즈도 감추지 않는다', () => {
    const html = render([target({ deliveredAt: '2026-01-01T00:00:00.000Z', writable: false })]);

    expect(html).toContain('기한이 지난 굿즈 1건');
    expect(html).toContain('작성 기한(배송완료 후 90일)이 지났습니다');
  });

  /* v1에는 리뷰 보상이 없다(#254 확정). */
  it('보상이 없다는 사실을 적는다', () => {
    expect(render([])).toContain('적립금이나 혜택이 주어지지는 않습니다');
  });
});
