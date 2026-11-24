import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OrderCancellationRequestSummary, OrderDetailStatus } from '@/lib/orders';
import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import type { MyReviewTarget } from '@/lib/reviews.server';
import {
  OrderActionBar,
  orderActionBarModel,
  reviewTargetBlockedReason,
  type OrderActionBarInput,
  type OrderActionKey,
} from './OrderActionBar';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-17T03:00:00.000Z');

function target(overrides: Partial<MyReviewTarget> = {}): MyReviewTarget {
  return {
    orderId: ORDER_ID, goodId: 'g13', goodName: '홍실 아크릴 블록', goodBg: null, orderedAt: '2026-11-01T06:00:00.000Z',
    deliveredAt: '2026-11-05T06:00:00.000Z', deadlineAt: '2027-02-03T06:00:00.000Z', writable: true, review: null, kind: 'ordinary',
    ...overrides,
  };
}

const REVIEW = {
  id: 'review-1', rating: 5, body: '좋아요', imagePaths: [], imageUrls: [], status: 'published', createdAt: '2026-11-06T06:00:00.000Z',
  editedAt: null, adminReply: null, adminReplyAt: null,
} as unknown as NonNullable<MyReviewTarget['review']>;

function claimRequest(overrides: Partial<OrderCancellationRequestSummary> = {}): OrderCancellationRequestSummary {
  return {
    id: '22222222-2222-4222-8222-222222222222', status: 'requested', claimType: 'return', stage: 'requested', reference: 7,
    requestedAt: '2026-11-10T06:00:00.000Z', decidedAt: null, decisionNote: null, reshipCarrier: null, reshipTrackingNumber: null,
    ...overrides,
  };
}

function input(overrides: Partial<OrderActionBarInput> = {}): OrderActionBarInput {
  return {
    status: 'delivered', digitalOnly: false, reviewTargets: [target()], claimEligibility: { cancel: false, return: true, exchange: true },
    cancellationRequest: null, refund: null, shipments: [shipmentFixture()], now: NOW,
    ...overrides,
  };
}

function byKey(overrides: Partial<OrderActionBarInput> = {}) {
  const model = orderActionBarModel(input(overrides));
  return Object.fromEntries((model?.actions ?? []).map((action) => [action.key, action])) as Record<OrderActionKey, NonNullable<typeof model>['actions'][number]>;
}

describe('orderActionBarModel 상태별 버튼 표', () => {
  it.each(['pending', 'canceled'] as const)('%s 주문은 막대를 그리지 않는다', (status) => {
    expect(orderActionBarModel(input({ status }))).toBeNull();
    expect(renderToStaticMarkup(<OrderActionBar {...input({ status })} />)).toBe('');
  });

  it.each([
    /* status, 구매확정, 리뷰작성, 교환반품, 배송조회 — null은 비활성 */
    ['paid', null, null, null, null],
    ['confirmed', null, null, null, null],
    ['shipping', null, null, '#order-claim-request', 'https://carrier.example.test/track?no=123456789012'],
    ['delivered', '#order-purchase-confirmation', `/my/reviews/new?orderId=${ORDER_ID}&goodId=g13`, '#order-claim-request', 'https://carrier.example.test/track?no=123456789012'],
    ['done', null, `/my/reviews/new?orderId=${ORDER_ID}&goodId=g13`, '#order-claim-request', 'https://carrier.example.test/track?no=123456789012'],
  ] as const)('%s: 구매확정·리뷰작성·교환반품·배송조회 활성 여부와 이동 위치', (status, confirm, review, claim, tracking) => {
    const claimable = status === 'shipping' || status === 'delivered' || status === 'done';
    /* 리뷰 대상은 배송완료 이상 주문에서만 서버가 돌려준다. */
    const model = byKey({
      status: status as OrderDetailStatus,
      reviewTargets: status === 'delivered' || status === 'done' ? [target()] : [],
      claimEligibility: { cancel: false, return: claimable, exchange: claimable },
      shipments: status === 'paid' || status === 'confirmed' ? [] : [shipmentFixture()],
    });
    expect(model.confirm.target?.href ?? null).toBe(confirm);
    expect(model.review.target?.href ?? null).toBe(review);
    expect(model.claim.target?.href ?? null).toBe(claim);
    expect(model.tracking.target?.href ?? null).toBe(tracking);
    expect(Object.keys(model)).toEqual(['confirm', 'review', 'claim', 'tracking']);
  });

  it('구매확정: 배송완료 전은 안내, 완료 후는 `구매확정 완료`(안내 없음)', () => {
    for (const status of ['paid', 'confirmed', 'shipping'] as const) {
      const { confirm } = byKey({ status });
      expect(confirm).toMatchObject({ label: '구매확정', target: null, hint: '구매확정: 배송이 완료되면 할 수 있어요.' });
    }
    expect(byKey({ status: 'delivered' }).confirm).toMatchObject({ label: '구매확정', target: { kind: 'anchor', href: '#order-purchase-confirmation' }, hint: null });
    expect(byKey({ status: 'done' }).confirm).toMatchObject({ label: '구매확정 완료', target: null, hint: null });
  });
});

describe('리뷰작성', () => {
  it('쓸 수 있는 대상이 1개면 그 상품의 작성 화면으로, 월간 리뷰는 kind를 싣는다', () => {
    expect(byKey().review).toMatchObject({ label: '리뷰작성', target: { kind: 'link', href: `/my/reviews/new?orderId=${ORDER_ID}&goodId=g13` }, hint: null });
    expect(byKey({ reviewTargets: [target({ kind: 'month' })] }).review.target).toEqual({ kind: 'link', href: `/my/reviews/new?orderId=${ORDER_ID}&goodId=g13&kind=month` });
  });

  it('배송완료·구매확정인데 대상이 0개면 `배송이 완료되면`이라 말하지 않고 쓸 수 있는 상품이 없다고 알린다(조회 실패 포함)', () => {
    for (const status of ['delivered', 'done'] as const) {
      expect(byKey({ status, reviewTargets: [] }).review, status).toMatchObject({ label: '리뷰작성', target: null, hint: '리뷰작성: 지금은 리뷰를 쓸 수 있는 상품이 없어요.' });
    }
    const html = renderToStaticMarkup(<OrderActionBar {...input({ status: 'delivered', reviewTargets: [] })} />);
    expect(html).toContain('리뷰작성: 지금은 리뷰를 쓸 수 있는 상품이 없어요.');
    expect(html).not.toContain('리뷰작성: 배송이 완료되면 쓸 수 있어요.');
  });

  it('쓸 수 있는 대상이 2개 이상이면 리뷰 칸 앵커로 보낸다(이미 쓴 대상은 세지 않는다)', () => {
    expect(byKey({ reviewTargets: [target(), target({ goodId: 'g14' })] }).review.target).toEqual({ kind: 'anchor', href: '#order-review' });
    expect(byKey({ reviewTargets: [target(), target({ goodId: 'g14', review: REVIEW })] }).review.target?.kind).toBe('link');
  });

  it('대상이 없으면 배송완료 전에는 배송 완료 안내, 모두 작성했으면 `내 리뷰 보기`', () => {
    for (const status of ['paid', 'confirmed', 'shipping'] as const) {
      expect(byKey({ status, reviewTargets: [] }).review, status).toMatchObject({ label: '리뷰작성', target: null, hint: '리뷰작성: 배송이 완료되면 쓸 수 있어요.' });
    }
    expect(byKey({ reviewTargets: [target({ writable: false, review: REVIEW }), target({ goodId: 'g14', writable: false, review: REVIEW })] }).review)
      .toMatchObject({ label: '내 리뷰 보기', target: { kind: 'anchor', href: '#order-review' }, hint: null });
  });

  it('아직 못 쓰면 기존 사유를 `리뷰작성: ` 뒤에 말한다 — 시작일 → 구매확정 사유 → 기본 문구, 이미 쓴 대상은 건너뛴다', () => {
    const blocked = (overrides: Partial<MyReviewTarget>) => byKey({ reviewTargets: [target({ writable: false, ...overrides })] }).review;
    expect(blocked({ opensAt: '2026-11-20T06:00:00.000Z' })).toMatchObject({ target: null, hint: '리뷰작성: 2026. 11. 20.부터 작성 가능' });
    expect(blocked({ purchaseConfirmation: { required: true, block: 'held', holdReason: '사진 확인 중' } }).hint)
      .toBe('리뷰작성: 이 주문의 구매확정이 보류되어 있습니다(사유: 사진 확인 중). 보류가 해제되면 리뷰를 남길 수 있습니다.');
    expect(blocked({ purchaseConfirmation: { required: true, block: 'claim_in_progress', holdReason: null } }).hint).toContain('리뷰작성: 취소·반품·교환 신청이 진행 중인 주문은 구매확정할 수 없어');
    expect(blocked({ purchaseConfirmation: { required: false, block: null, holdReason: null } }).hint).toBe('리뷰작성: 현재 작성할 수 없습니다');
    /* 시작일이 이미 지났으면 시작일 문구가 아니라 다음 사유로 넘어간다. */
    expect(blocked({ opensAt: '2026-11-01T06:00:00.000Z' }).hint).toBe('리뷰작성: 현재 작성할 수 없습니다');
    const mixed = byKey({ reviewTargets: [target({ writable: false, review: REVIEW }), target({ goodId: 'g14', writable: false, opensAt: '2026-11-20T06:00:00.000Z' })] }).review;
    expect(mixed.hint).toBe('리뷰작성: 2026. 11. 20.부터 작성 가능');
  });

  it('reviewTargetBlockedReason은 주문 상세 리뷰 칸과 같은 문구를 돌려준다', () => {
    expect(reviewTargetBlockedReason(target({ writable: false }), NOW)).toBe('현재 작성할 수 없습니다');
  });
});

describe('교환반품 접수', () => {
  it('접수할 수 있으면 반품·교환 패널 앵커로 보낸다', () => {
    expect(byKey().claim).toMatchObject({ label: '교환반품 접수', target: { kind: 'anchor', href: '#order-claim-request' }, hint: null });
    expect(byKey({ claimEligibility: { cancel: false, return: false, exchange: true } }).claim.target).not.toBeNull();
  });

  it('접수 자격이 없으면 비활성 + 반품 판정의 사유(배송 전·확인 불가)', () => {
    expect(byKey({ claimEligibility: { cancel: true, return: false, exchange: false } }).claim)
      .toMatchObject({ label: '교환반품 접수', target: null, hint: '교환반품 접수: 배송 중 또는 배송완료 주문의 전체 수량을 확인한 뒤 신청할 수 있습니다.' });
    expect(byKey({ claimEligibility: null }).claim.hint).toBe('교환반품 접수: 신청 가능 여부를 확인할 수 없습니다. 주문을 새로고침하거나 1:1 문의로 알려주세요.');
  });

  it('진행 중인 반품·교환 클레임이 있으면 `교환반품 진행 보기`로 같은 패널에 보낸다', () => {
    for (const claimType of ['return', 'exchange'] as const) {
      expect(byKey({ cancellationRequest: claimRequest({ claimType, stage: 'in_review' }) }).claim)
        .toMatchObject({ label: '교환반품 진행 보기', target: { kind: 'anchor', href: '#order-claim-request' }, hint: null });
    }
  });

  it('끝난 반품·교환 클레임은 진행 중이 아니라 다시 접수 가능 여부로 판정한다', () => {
    expect(byKey({ cancellationRequest: claimRequest({ stage: 'completed' }) }).claim.label).toBe('교환반품 접수');
  });

  it('반품 환불의 송금 대기(awaiting_transfer)도 처리 중이다 — 교환은 제외', () => {
    const refund = { status: 'awaiting_transfer', createdAt: '2026-11-12T06:00:00.000Z' };
    expect(byKey({ cancellationRequest: claimRequest({ stage: 'completed' }), refund }).claim).toMatchObject({ label: '교환반품 진행 보기', target: { href: '#order-claim-request' } });
    expect(byKey({ cancellationRequest: claimRequest({ claimType: 'exchange', stage: 'completed' }), refund }).claim.label).toBe('교환반품 접수');
    /* 취소 클레임의 송금 대기는 반품·교환 진행이 아니다 — 같은 패널이 막으므로 접수 불가 + 안내다. */
    expect(byKey({ cancellationRequest: claimRequest({ claimType: 'cancel', stage: 'completed' }), refund }).claim)
      .toMatchObject({ label: '교환반품 접수', target: null, hint: '교환반품 접수: 이미 처리 중인 클레임이 있습니다.' });
  });

  it('진행 중인 취소 클레임이 있으면 반품·교환 패널이 없으므로 접수 불가로 말한다', () => {
    expect(byKey({ cancellationRequest: claimRequest({ claimType: 'cancel', stage: 'processing' }) }).claim)
      .toMatchObject({ label: '교환반품 접수', target: null, hint: '교환반품 접수: 이미 처리 중인 클레임이 있습니다.' });
  });
});

describe('배송조회', () => {
  it('추적 가능한 배송 건이 하나면 택배사 조회 주소로 새 창 이동', () => {
    expect(byKey().tracking).toMatchObject({ label: '배송조회', target: { kind: 'external', href: 'https://carrier.example.test/track?no=123456789012' }, hint: null });
  });

  it('둘 이상이면 배송 묶음 앵커로 보낸다', () => {
    const shipments = [shipmentFixture(), shipmentFixture({ id: '00000000-0000-4000-8000-000000044702', trackingUrl: 'https://carrier.example.test/track?no=2' })];
    expect(byKey({ shipments }).tracking.target).toEqual({ kind: 'anchor', href: '#order-shipments' });
  });

  it('운송장·조회 주소가 없으면 비활성 + 안내, 퀵·방문수령 같은 택배가 아닌 배송 건은 세지 않는다', () => {
    const hint = '배송조회: 운송장이 등록되면 볼 수 있어요.';
    expect(byKey({ shipments: [] }).tracking).toMatchObject({ target: null, hint });
    expect(byKey({ shipments: [shipmentFixture({ trackingUrl: null, trackingNumber: null })] }).tracking).toMatchObject({ target: null, hint });
    const quick = shipmentFixture({ delivery: { method: 'quick' } as never });
    expect(byKey({ shipments: [quick] }).tracking).toMatchObject({ target: null, hint });
    /* 퀵 한 건 + 택배 한 건 = 추적 가능은 한 건이라 외부 링크다. */
    const parcel = shipmentFixture({ id: '00000000-0000-4000-8000-000000044703', delivery: { method: 'parcel' } as never });
    expect(byKey({ shipments: [quick, parcel] }).tracking.target?.kind).toBe('external');
  });
});

describe('디지털 전용 주문', () => {
  it('교환반품 접수·배송조회를 그리지 않고 구매확정·리뷰작성만 둔다', () => {
    const model = orderActionBarModel(input({ digitalOnly: true }));
    expect(model?.actions.map((action) => action.key)).toEqual(['confirm', 'review']);
    const html = renderToStaticMarkup(<OrderActionBar {...input({ digitalOnly: true })} />);
    expect(html).toContain('data-count="2"');
    expect(html).not.toContain('교환반품'); expect(html).not.toContain('배송조회');
  });
});

describe('OrderActionBar 렌더', () => {
  it('주문 처리 그룹 안에 네 버튼을 순서대로 그리고, 활성 버튼은 링크·비활성은 disabled 버튼이다', () => {
    const html = renderToStaticMarkup(<OrderActionBar {...input()} />);
    expect(html).toContain('aria-label="주문 처리"'); expect(html).toContain('role="group"'); expect(html).toContain('data-count="4"');
    const positions = ['구매확정', '리뷰작성', '교환반품 접수', '배송조회'].map((label) => html.indexOf(`>${label}</`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('href="#order-purchase-confirmation"'); expect(html).toContain('href="#order-claim-request"');
    expect(html).toContain(`href="/my/reviews/new?orderId=${ORDER_ID}&amp;goodId=g13"`);
    expect(html).toContain('href="https://carrier.example.test/track?no=123456789012" rel="noreferrer" target="_blank"');
    expect(html).not.toContain('disabled'); expect(html).not.toContain('order-action-hints');
  });

  it('비활성 버튼은 disabled이고 안내 줄과 연결된다. 안내는 비활성 사유만 모은다', () => {
    const html = renderToStaticMarkup(<OrderActionBar {...input({ status: 'paid', reviewTargets: [], claimEligibility: { cancel: true, return: false, exchange: false }, shipments: [] })} />);
    expect((html.match(/disabled=""/g) ?? [])).toHaveLength(4);
    expect(html).toContain('aria-describedby="order-action-hint-confirm"'); expect(html).toContain('id="order-action-hint-confirm"');
    expect(html).toContain('<ul class="order-action-hints">');
    for (const text of ['구매확정: 배송이 완료되면 할 수 있어요.', '리뷰작성: 배송이 완료되면 쓸 수 있어요.', '교환반품 접수: 배송 중 또는 배송완료 주문의 전체 수량을', '배송조회: 운송장이 등록되면 볼 수 있어요.']) expect(html).toContain(text);
  });

  it('구매확정 완료는 안내 줄 없이 disabled 버튼만 둔다', () => {
    const html = renderToStaticMarkup(<OrderActionBar {...input({ status: 'done', reviewTargets: [target({ writable: false, review: REVIEW })] })} />);
    expect(html).toContain('>구매확정 완료</button>'); expect(html).toContain('>내 리뷰 보기</a>');
    expect(html).not.toContain('order-action-hint-confirm');
  });
});
