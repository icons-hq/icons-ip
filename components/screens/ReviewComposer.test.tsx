import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReviewComposer } from './ReviewComposer';
import type { MyReviewTarget } from '@/lib/reviews.server';
import { PURCHASE_CONFIRMATION_NOTICE } from '@/lib/review-purchase-confirmation';

/* 폼은 server action을 import한다. 여기서 보는 것은 렌더 결과라 액션 모듈만 대역으로 둔다. */
vi.mock('@/app/my/reviews/actions', () => ({
  createReviewAction: vi.fn(),
  updateReviewAction: vi.fn(),
}));

const NOW = new Date('2026-11-12T00:00:00.000Z');
const ORDER_ID = '99999999-9999-4999-8999-999999999999';

function target(overrides: Partial<MyReviewTarget> = {}): MyReviewTarget {
  return {
    orderId: ORDER_ID,
    goodId: 'g13',
    goodName: '아크릴 블록',
    goodBg: null,
    orderedAt: '2026-11-01T00:00:00.000Z',
    deliveredAt: '2026-11-10T00:00:00.000Z',
    deadlineAt: '2027-02-08T00:00:00.000Z',
    writable: true,
    purchaseConfirmation: { required: false, block: null, holdReason: null },
    review: null,
    ...overrides,
  };
}

function render(value: MyReviewTarget, mode: 'create' | 'edit' = 'create') {
  return renderToStaticMarkup(<ReviewComposer mode={mode} now={NOW} target={value} />);
}

describe('ReviewComposer — 리뷰 등록 = 구매확정 (1014-079)', () => {
  it('미확정 주문은 확정 안내와 확인 체크를 보이고, 버튼이 확정까지 말한다', () => {
    const html = render(target({ purchaseConfirmation: { required: true, block: null, holdReason: null } }));

    expect(html).toContain('리뷰를 등록하면 구매확정됩니다');
    expect(html).toContain(PURCHASE_CONFIRMATION_NOTICE);
    const checkbox = html.match(/<input[^>]*name="confirmPurchase"[^>]*\/>/)?.[0] ?? '';
    expect(checkbox).toContain('type="checkbox"');
    expect(checkbox).toContain('required=""');
    expect(checkbox).toContain('value="on"');
    expect(html).toContain('받은 굿즈와 구매확정 내용을 확인했습니다.');
    expect(html).toContain('리뷰 등록하고 구매확정');
    /* 리뷰 없이 확정만 하는 길은 주문 상세의 [구매확정]이다(②). */
    expect(html).toContain(`href="/orders/${ORDER_ID}"`);
    expect(html).toContain('[구매확정]');
  });

  it('이미 구매확정된 주문은 안내 없이 리뷰만 등록한다', () => {
    const html = render(target());

    expect(html).not.toContain('리뷰를 등록하면 구매확정됩니다');
    expect(html).not.toContain('confirmPurchase');
    expect(html).toContain('리뷰 등록');
    expect(html).not.toContain('리뷰 등록하고 구매확정');
    /* 확정을 겸하지 않는 등록은 리뷰 작성만으로 주는 혜택이 정말 없다. */
    expect(html).toContain('리뷰 작성만으로 혜택이 지급되지는 않으며');
  });

  /* 확정을 겸하는 등록은 구매확정 적립금이 함께 지급된다. 같은 화면의 리뷰이벤트 배너('선정 시 적립금')와도
     어긋나지 않게, 리뷰 작성 자체의 혜택·구매확정 적립금·이벤트 선정 혜택을 나눠 말한다. */
  it('확정을 겸하면 혜택 문장이 구매확정 적립금을 따로 말하고 이벤트 배너와 어긋나지 않는다', () => {
    const event = {
      id: 'event-1', title: 'TEST 리뷰 이벤트', description: 'TEST 이벤트 내용', creditAmount: 3000, plannedWinners: 10,
      startsOn: '2026-11-01', endsOn: '2026-11-30', announcesOn: '2026-12-05', bannerStyle: 'basic',
    } as unknown as import('@/lib/review-events').PublicReviewEvent;
    const reviewEvents = { rows: [{ goodId: 'g13', event }], nextChangeAt: null } as unknown as import('@/lib/review-events').GoodsReviewEvents;
    const html = renderToStaticMarkup(<ReviewComposer mode="create" now={NOW} reviewEvents={reviewEvents}
      target={target({ purchaseConfirmation: { required: true, block: null, holdReason: null } })} />);

    expect(html).toContain('선정 시 적립금');
    expect(html).toContain('구매확정 적립금은 리뷰 등록 여부·내용과 관계없이 같은 기준으로 지급됩니다.');
    expect(html).toContain('리뷰 작성 자체에 대한 혜택은 없습니다. 구매확정 적립금은 리뷰 없이 [구매확정]이나 자동 구매확정으로도 똑같이 지급됩니다.');
    expect(html).not.toContain('리뷰 작성만으로 혜택이 지급되지는 않으며');
    expect(html).not.toMatch(/(?<!구매확정 )적립금은 리뷰 내용과 관계없이/);
  });

  /* 반품 진행 중 주문은 구매확정할 수 없어 리뷰도 막는다. 폼을 숨기는 대신 이유를 말한다. */
  it('취소·반품·교환이 진행 중이면 폼 대신 막힌 이유와 주문 상세 경로를 보인다', () => {
    const html = render(target({ writable: false, purchaseConfirmation: { required: true, block: 'claim_in_progress', holdReason: null } }));

    expect(html).toContain('지금은 리뷰를 남길 수 없습니다');
    expect(html).toContain('취소·반품·교환 신청이 진행 중');
    expect(html).toContain('주문 상세 보기');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('리뷰를 등록하면 구매확정됩니다');
  });

  it('구매확정 보류는 관리자가 남긴 사유와 함께 알린다', () => {
    const html = render(target({ writable: false, purchaseConfirmation: { required: true, block: 'held', holdReason: '사진 확인 중' } }));

    expect(html).toContain('구매확정이 보류되어 있습니다(사유: 사진 확인 중)');
  });

  it('이미 쓴 리뷰가 있으면 확정 사유보다 중복 안내가 먼저다', () => {
    const html = render(target({
      writable: false,
      purchaseConfirmation: { required: true, block: 'claim_in_progress', holdReason: null },
      review: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rating: 4, body: '마감이 깔끔합니다', imagePaths: [], imageUrls: [],
        status: 'visible', createdAt: '2026-11-11T00:00:00.000Z', editedAt: null, adminReply: null, adminReplyAt: null,
      },
    }));

    expect(html).toContain('이미 이 주문의 굿즈에 리뷰를 남겼거나');
    expect(html).not.toContain('취소·반품·교환 신청이 진행 중');
  });

  /* 리뷰 수정은 구매확정하지 않는다. 도입 전에 쓴 미확정 주문 리뷰도 그대로 고친다. */
  it('리뷰 수정 화면은 확정 안내를 띄우지 않는다', () => {
    const html = render(target({
      writable: false,
      editable: true,
      purchaseConfirmation: { required: true, block: null, holdReason: null },
      review: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rating: 4, body: '마감이 깔끔합니다', imagePaths: [], imageUrls: [],
        status: 'visible', createdAt: '2026-11-11T00:00:00.000Z', editedAt: null, adminReply: null, adminReplyAt: null,
      },
    }), 'edit');

    expect(html).toContain('리뷰 수정');
    expect(html).not.toContain('리뷰를 등록하면 구매확정됩니다');
    expect(html).not.toContain('confirmPurchase');
  });
});
