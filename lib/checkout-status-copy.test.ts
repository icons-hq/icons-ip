import { describe, expect, it } from 'vitest';
import type { CheckoutPaymentReading } from './checkout';
import {
  checkoutStatusCopy,
  closedPaymentCopy,
  orderDetailCardPaymentNotice,
  REORDER_CANCELED_COPY,
  REORDER_REQUESTED_COPY,
} from './checkout-status-copy';

const orderId = '585fa706-0000-4000-8000-000000000001';
const orderExpiresAt = '2026-10-12T07:41:00.000Z';

function reading(overrides: Partial<CheckoutPaymentReading>): CheckoutPaymentReading {
  return { state: 'payable', closure: null, reorderMode: null, provider: 'toss', ...overrides };
}

function noticeText(notice: ReturnType<typeof orderDetailCardPaymentNotice>) {
  return [
    notice.header.title,
    notice.header.body,
    notice.banner?.title ?? '',
    notice.banner?.body ?? '',
    notice.banner?.link.label ?? '',
  ].join(' ');
}

/* QA-3: 결제 화면에서 "이 주문 취소하고 다시 주문하기"로 취소를 마친 뒤에도 위쪽 안내가
   "이 주문을 취소하고 같은 굿즈로 다시 주문해주세요"로 남으면 이미 끝난 일을 다시 하라고 한다. */
describe('checkoutStatusCopy — 이 화면에서 주문을 취소한 뒤', () => {
  const declinedCopy = closedPaymentCopy('not_approved', { orderExpiresAt, provider: 'toss' });

  it('닫힌 결제 안내를 취소 사실로 바꾼다', () => {
    const copy = checkoutStatusCopy({
      state: 'payment_closed',
      closedCopy: declinedCopy,
      isBankTransfer: false,
      orderStatus: 'pending',
      reorderMode: 'cancel_then_reorder',
      reorderCanceled: true,
    });

    expect(copy).toEqual(REORDER_CANCELED_COPY);
    expect(copy?.body).not.toContain('취소하고 같은 굿즈로 다시 주문해주세요');
  });

  it('결제 기한이 지난 주문의 안내도 취소 사실로 바꾼다', () => {
    expect(checkoutStatusCopy({
      state: 'closed',
      closedCopy: null,
      isBankTransfer: false,
      orderStatus: 'pending',
      reorderMode: 'cancel_then_reorder',
      reorderCanceled: true,
    })).toEqual(REORDER_CANCELED_COPY);
  });

  it('취소 전에는 닫힌 결제 안내를 그대로 둔다', () => {
    expect(checkoutStatusCopy({
      state: 'payment_closed',
      closedCopy: declinedCopy,
      isBankTransfer: false,
      orderStatus: 'pending',
      reorderMode: 'cancel_then_reorder',
    })).toEqual(declinedCopy);
  });
});

/* 2026-10-12 QA-1: 취소가 즉시 끝나지 않고 취소 요청으로 접수되면(경합·시계 차이, 또는
   request_order_claim이 시도 만료를 아직 미해결로 보는 DB) 장바구니에 담지 않았다는 사실이
   서버 상태를 다시 읽은 뒤에도 남아야 한다. */
describe('checkoutStatusCopy — 이 화면의 취소가 취소 요청으로 접수된 뒤', () => {
  const requestedClosure = closedPaymentCopy('cancellation_requested', { orderExpiresAt, provider: 'toss' });

  it('다시 읽은 닫힌 결제(처리 중인 취소 요청)와 기한 경과 안내를 접수 사실로 바꾼다', () => {
    for (const state of ['payment_closed', 'closed'] as const) {
      const copy = checkoutStatusCopy({
        state,
        closedCopy: state === 'payment_closed' ? requestedClosure : null,
        isBankTransfer: false,
        orderStatus: 'pending',
        reorderMode: null,
        reorderRequested: true,
      });
      expect(copy).toEqual(REORDER_REQUESTED_COPY);
    }
    expect(REORDER_REQUESTED_COPY.body).toContain('장바구니에 다시 담지 않았어요');
    expect(REORDER_REQUESTED_COPY.body).toContain('주문 상세');
    // 끝나는 시점은 결제 결과에 달려 있으므로 약속하지 않는다.
    expect(REORDER_REQUESTED_COPY.body).not.toContain('바로 돌아와요');
    expect(REORDER_REQUESTED_COPY.body).not.toContain('담당자');
  });

  it('그 뒤 취소가 끝난 주문은 취소된 주문으로 안내한다', () => {
    expect(checkoutStatusCopy({
      state: 'closed',
      closedCopy: null,
      isBankTransfer: false,
      orderStatus: 'canceled',
      reorderMode: 'reorder',
      reorderRequested: true,
    })?.title).toBe('취소된 주문이에요');
  });

  it('승인과 겹쳐 확인 중·결제 취소 진행으로 바뀌면 그 상태 안내를 따른다', () => {
    expect(checkoutStatusCopy({
      state: 'checking',
      closedCopy: null,
      isBankTransfer: false,
      orderStatus: 'pending',
      reorderMode: null,
      reorderRequested: true,
    })?.title).toBe('결제를 확인하고 있어요');
    expect(checkoutStatusCopy({
      state: 'refund_in_progress',
      closedCopy: null,
      isBankTransfer: false,
      orderStatus: 'pending',
      reorderMode: null,
      reorderRequested: true,
    })?.title).toBe('결제 취소를 진행하고 있어요');
  });
});

/* 2026-10-12 QA-1: 결제 준비 후 유효 시간이 지난 주문도 거절 주문처럼 즉시 정리한다. */
describe('closedPaymentCopy — 시도 만료', () => {
  it('취소하고 다시 주문하기를 줄 수 있으면 즉시 정리를 권하고 자동 취소 대기를 말하지 않는다', () => {
    const copy = closedPaymentCopy('attempt_expired', {
      orderExpiresAt,
      provider: 'toss',
      reorderMode: 'cancel_then_reorder',
    });

    expect(copy.title).toBe('결제 가능 시간이 지났어요');
    expect(copy.body).toContain('청구된 금액은 없어요');
    expect(copy.body).toContain('이 주문을 취소하고 같은 굿즈로 다시 주문해주세요');
    expect(copy.body).toContain('바로 돌아와요');
    expect(copy.body).not.toContain('자동으로 취소');
  });

  it('즉시 취소가 확실하지 않으면 결제 기한 뒤 자동 취소를 안내한다', () => {
    const copy = closedPaymentCopy('attempt_expired', { orderExpiresAt, provider: 'toss' });

    expect(copy.body).toContain('결제 기한(16:41)이 지나면 몇 분 안에 자동으로 취소');
    expect(copy.body).not.toContain('바로 돌아와요');
  });
});

/* QA-2: 거절·시도 만료로 닫힌 결제대기 주문의 주문 상세가 '결제 상태를 확인하고 있어요'와
   '결제 상태 확인·이어가기'를 보이면 청구가 진행 중이고 이어갈 수 있는 것처럼 읽힌다. */
describe('orderDetailCardPaymentNotice', () => {
  it('승인 거절된 주문은 다시 결제할 수 없다고 말하고 결제 화면의 정리 액션으로 보낸다', () => {
    const notice = orderDetailCardPaymentNotice(
      reading({ state: 'payment_closed', closure: 'not_approved', reorderMode: 'cancel_then_reorder' }),
      { orderId, orderExpiresAt },
    );

    expect(notice.header.title).toBe('이 주문은 다시 결제할 수 없어요');
    expect(notice.banner).toMatchObject({
      title: '결제가 승인되지 않았어요',
      link: { href: `/checkout/${orderId}`, label: '주문 정리하고 다시 주문하기' },
    });
    expect(noticeText(notice)).not.toContain('확인하고 있어요');
    expect(noticeText(notice)).not.toContain('승인 확인 중');
    expect(noticeText(notice)).not.toContain('이어가기');
    expect(noticeText(notice)).not.toContain('이어갈 수');
  });

  it('시도가 만료된 주문은 결제 화면과 같은 사실을 말하고 거절 주문처럼 결제 화면의 정리 액션으로 보낸다', () => {
    const notice = orderDetailCardPaymentNotice(
      reading({ state: 'payment_closed', closure: 'attempt_expired', reorderMode: 'cancel_then_reorder' }),
      { orderId, orderExpiresAt },
    );

    expect(notice.header).toEqual(closedPaymentCopy('attempt_expired', {
      orderExpiresAt,
      provider: 'toss',
      reorderMode: 'cancel_then_reorder',
    }));
    expect(notice.header.body).toContain('청구된 금액은 없어요');
    expect(notice.header.body).not.toContain('자동으로 취소');
    expect(notice.banner).toMatchObject({
      title: '결제 가능 시간이 지났어요',
      link: { href: `/checkout/${orderId}`, label: '주문 정리하고 다시 주문하기' },
    });
    expect(noticeText(notice)).not.toContain('확인하고 있어요');
    expect(noticeText(notice)).not.toContain('이어가기');
  });

  it('시도 만료여도 즉시 취소가 확실하지 않으면 자동 취소를 안내하고 결제 화면으로 보내지 않는다', () => {
    const notice = orderDetailCardPaymentNotice(
      reading({ state: 'payment_closed', closure: 'attempt_expired', reorderMode: null }),
      { orderId, orderExpiresAt },
    );

    expect(notice.header.body).toContain('결제 기한(16:41)');
    expect(notice.banner).toBeNull();
  });

  it('결제 기한이 지난 주문은 즉시 취소할 수 있을 때만 결제 화면의 정리 액션으로 보낸다', () => {
    const cancelable = orderDetailCardPaymentNotice(
      reading({ state: 'closed', reorderMode: 'cancel_then_reorder' }),
      { orderId, orderExpiresAt },
    );
    expect(cancelable.header.title).toBe('결제 가능한 시간이 지났어요');
    expect(cancelable.banner?.link.label).toBe('주문 정리하고 다시 주문하기');

    const waiting = orderDetailCardPaymentNotice(
      reading({ state: 'closed', reorderMode: null }),
      { orderId, orderExpiresAt },
    );
    expect(waiting.header.body).toContain('몇 분 안에 자동으로 취소');
    expect(waiting.banner).toBeNull();
  });

  it('같은 주문으로 결제할 수 있을 때만 결제 이어가기를 약속한다', () => {
    const notice = orderDetailCardPaymentNotice(reading({ state: 'payable' }), { orderId, orderExpiresAt });

    expect(notice.header.title).toBe('결제를 기다리고 있어요');
    expect(notice.banner?.link).toEqual({ href: `/checkout/${orderId}`, label: '결제 이어가기' });
  });

  it('승인 결과를 확정하지 못한 주문만 확인 중으로 말하고 이어가기를 약속하지 않는다', () => {
    const notice = orderDetailCardPaymentNotice(reading({ state: 'checking' }), { orderId, orderExpiresAt });

    expect(notice.header.title).toBe('결제를 확인하고 있어요');
    expect(notice.banner?.link.label).toBe('결제 상태 보기');
    expect(noticeText(notice)).not.toContain('이어가기');
  });

  it('처리 중인 취소가 있으면 아래 취소 안내로 넘기고 결제 화면으로 보내지 않는다', () => {
    const requested = orderDetailCardPaymentNotice(
      reading({ state: 'payment_closed', closure: 'cancellation_requested' }),
      { orderId, orderExpiresAt },
    );
    expect(requested.header.title).toBe('취소 요청을 처리하고 있어요');
    expect(requested.header.body).not.toContain('주문 상세에서');
    expect(requested.banner).toBeNull();

    const refunding = orderDetailCardPaymentNotice(
      reading({ state: 'refund_in_progress' }),
      { orderId, orderExpiresAt },
    );
    expect(refunding.header.title).toBe('결제 취소를 진행하고 있어요');
    expect(refunding.banner).toBeNull();
  });

  it('결제 시도를 읽지 못하면 상태를 단정하지 않는다', () => {
    const notice = orderDetailCardPaymentNotice(null, { orderId, orderExpiresAt });

    expect(notice.banner?.link).toEqual({ href: `/checkout/${orderId}`, label: '결제 화면 보기' });
    expect(noticeText(notice)).not.toContain('확인하고 있어요');
    expect(noticeText(notice)).not.toContain('이어가기');
  });
});
