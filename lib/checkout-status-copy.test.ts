import { describe, expect, it } from 'vitest';
import type { CheckoutPaymentReading } from './checkout';
import {
  closedPaymentCopy,
  orderDetailCardPaymentNotice,
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

  it('시도가 만료된 주문은 결제 화면과 같은 사실을 말하고 결제를 이어가라고 하지 않는다', () => {
    const notice = orderDetailCardPaymentNotice(
      reading({ state: 'payment_closed', closure: 'attempt_expired', reorderMode: null }),
      { orderId, orderExpiresAt },
    );

    expect(notice.header).toEqual(closedPaymentCopy('attempt_expired', { orderExpiresAt, provider: 'toss' }));
    expect(notice.header.body).toContain('청구된 금액은 없어요');
    expect(notice.header.body).toContain('결제 기한(16:41)');
    expect(notice.banner).toBeNull();
    expect(noticeText(notice)).not.toContain('확인하고 있어요');
    expect(noticeText(notice)).not.toContain('이어가기');
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
