import { describe, expect, it } from 'vitest';
import {
  checkoutAddressErrors,
  checkoutDeadlineTimeLabel,
  checkoutEffectivePaymentStatus,
  checkoutOrderName,
  checkoutOrderState,
  checkoutPaymentClosure,
  checkoutPaymentResultFollowsApproval,
  checkoutPaymentResultOutcome,
  checkoutRefundInProgress,
  checkoutReorderMode,
  type CheckoutClosureInput,
  mapPlaceOrderError,
  normalizeCheckoutAddress,
  normalizeCheckoutKey,
  normalizeOrderReference,
  readCheckoutPayment,
} from './checkout';

describe('normalizeCheckoutAddress', () => {
  it('trims fulfillment fields and stores phone digits only', () => {
    expect(normalizeCheckoutAddress({
      recipientName: '  아이콘즈 팬  ',
      phone: '010-1234-5678',
      postalCode: ' 04799 ',
      address1: ' 서울 성동구 아차산로  ',
      address2: ' 101동 202호 ',
      deliveryNote: ' 문 앞에 놓아주세요 ',
    })).toEqual({
      recipientName: '아이콘즈 팬',
      phone: '01012345678',
      postalCode: '04799',
      address1: '서울 성동구 아차산로',
      address2: '101동 202호',
      deliveryNote: '문 앞에 놓아주세요',
    });
  });

  it.each([
    null,
    {},
    { recipientName: '', phone: '01012345678', postalCode: '04799', address1: '서울' },
    { recipientName: '팬', phone: '123', postalCode: '04799', address1: '서울' },
    { recipientName: '팬', phone: '01012345678', postalCode: '4799', address1: '서울' },
    { recipientName: '팬', phone: '01012345678', postalCode: '04799', address1: '' },
    { recipientName: '팬', phone: '01012345678', postalCode: '04799', address1: '서울', admin: true },
  ])('rejects malformed or expanded address payloads: %j', (value) => {
    expect(normalizeCheckoutAddress(value)).toBeNull();
  });

  it('returns field-specific errors for the shipping form', () => {
    expect(checkoutAddressErrors({
      recipientName: ' ',
      phone: 'abc',
      postalCode: '4799',
      address1: '',
      address2: '가'.repeat(201),
      deliveryNote: '나'.repeat(201),
    })).toEqual({
      recipientName: '받는 분을 입력해주세요.',
      phone: '연락처는 숫자 8~15자리로 입력해주세요.',
      postalCode: '우편번호 5자리를 입력해주세요.',
      address1: '기본 주소를 입력해주세요.',
      address2: '상세 주소는 200자 이하로 입력해주세요.',
      deliveryNote: '배송 메모는 200자 이하로 입력해주세요.',
    });
  });

  it('accepts a form value that the server normalizer can store', () => {
    expect(checkoutAddressErrors({
      recipientName: '아이콘즈 팬',
      phone: '010-1234-5678',
      postalCode: '04799',
      address1: '서울 성동구',
      address2: '',
      deliveryNote: '',
    })).toEqual({});
  });
});

describe('checkout identifiers', () => {
  const uuid = '7ad4c967-3d48-44da-a665-64731ac33f62';

  it('accepts canonical UUID references and rejects arbitrary strings', () => {
    expect(normalizeCheckoutKey(uuid)).toBe(uuid);
    expect(normalizeOrderReference(uuid)).toBe(uuid);
    expect(normalizeCheckoutKey('not-a-uuid')).toBeNull();
    expect(normalizeOrderReference(` ${uuid} `)).toBe(uuid);
  });
});

describe('checkout copy and safe errors', () => {
  it('builds a bounded provider order name without leaking an address', () => {
    expect(checkoutOrderName(['리락쿠마 낮잠 쿠션'])).toBe('리락쿠마 낮잠 쿠션');
    expect(checkoutOrderName(['리락쿠마 낮잠 쿠션', '키링', '피규어'])).toBe('리락쿠마 낮잠 쿠션 외 2건');
    expect(checkoutOrderName(['가'.repeat(120)]).length).toBeLessThanOrEqual(100);
  });

  it('maps database failures to a small client-safe vocabulary', () => {
    expect(mapPlaceOrderError('cart empty')).toBe('empty_cart');
    expect(mapPlaceOrderError('out of stock: secret-good-id')).toBe('out_of_stock');
    expect(mapPlaceOrderError('goods_sale_not_open')).toBe('goods_sale_not_open');
    expect(mapPlaceOrderError('invalid checkout address')).toBe('invalid_address');
    expect(mapPlaceOrderError('account_suspended')).toBe('account_suspended');
    expect(mapPlaceOrderError('goods_purchase_restricted')).toBe('goods_purchase_restricted');
    expect(mapPlaceOrderError('coupon_min_subtotal')).toBe('coupon_rejected');
    expect(mapPlaceOrderError('coupon_expired')).toBe('coupon_rejected');
    expect(mapPlaceOrderError('payment amount below provider minimum')).toBe('payment_below_minimum');
    expect(mapPlaceOrderError('sensitive database failure')).toBe('unavailable');
  });
});

describe('checkoutOrderState', () => {
  const now = Date.parse('2026-07-14T05:00:00.000Z');

  it('keeps provider-approved orders in checking until the webhook confirms the order', () => {
    expect(checkoutOrderState('pending', 'pending', '2026-07-14T05:10:00.000Z', now)).toBe('checking');
    expect(checkoutOrderState('pending', 'paid', '2026-07-14T05:10:00.000Z', now)).toBe('checking');
  });

  it('separates payable, complete, and closed orders', () => {
    expect(checkoutOrderState('pending', null, '2026-07-14T05:10:00.000Z', now)).toBe('payable');
    expect(checkoutOrderState('paid', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('confirmed', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('shipping', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('delivered', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('done', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('pending', null, '2026-07-14T04:59:59.000Z', now)).toBe('closed');
    expect(checkoutOrderState('canceled', 'canceled', null, now)).toBe('closed');
  });

  /* 승인과 취소 요청이 겹친 주문: finalizer가 결제 원장을 paid로 남기고 주문은 pending,
     결제 기한은 비운 채 결제 취소를 시작한다(20261013110100). 승인은 확정됐으므로
     '결제사 승인 결과를 아직 확정하지 못했어요'로 안내하면 사실과 다르다(INT-5). */
  it('결제는 승인됐고 처리 중인 취소 요청이 있으면 확인 중이 아니라 결제 취소 진행이다', () => {
    expect(checkoutOrderState('pending', 'paid', null, now, 'cancellation_requested', true))
      .toBe('refund_in_progress');
    expect(checkoutOrderState('pending', 'paid', '2026-07-14T04:00:00.000Z', now, null, true))
      .toBe('refund_in_progress');
    // 결제가 아직 확정되지 않은 시도는 취소 요청이 있어도 확인 중이다.
    expect(checkoutOrderState('pending', 'pending', null, now, 'cancellation_requested', true))
      .toBe('checking');
    expect(checkoutOrderState('pending', 'paid', null, now, null, false)).toBe('checking');
    expect(checkoutOrderState('canceled', 'refunded', null, now, null, true)).toBe('closed');
  });
});

describe('checkoutRefundInProgress', () => {
  it('결제 대기 주문의 결제 원장이 paid이고 처리 중인 취소 요청이 있을 때만 참이다', () => {
    const base = { orderStatus: 'pending', paymentStatus: 'paid', hasActiveCancellationRequest: true };
    expect(checkoutRefundInProgress(base)).toBe(true);
    expect(checkoutRefundInProgress({ ...base, hasActiveCancellationRequest: false })).toBe(false);
    expect(checkoutRefundInProgress({ ...base, paymentStatus: 'pending' })).toBe(false);
    expect(checkoutRefundInProgress({ ...base, paymentStatus: null })).toBe(false);
    expect(checkoutRefundInProgress({ ...base, orderStatus: 'paid' })).toBe(false);
    expect(checkoutRefundInProgress({ ...base, orderStatus: 'canceled', paymentStatus: 'refunded' })).toBe(false);
  });
});

/*
 * 굿즈 주문당 결제 시도는 하나이고 prepare는 만료 전 prepared 시도만 재사용한다.
 * 승인 거절·시도 만료 뒤에도 "결제 준비하기"를 띄우면 누를 때마다 같은 실패만 돈다.
 */
describe('checkoutPaymentClosure', () => {
  const now = Date.parse('2026-10-12T05:00:00.000Z');
  const base = {
    paymentMethod: 'card' as const,
    paymentAttempt: null,
    hasActiveCancellationRequest: false,
  };

  it('결제 시도가 없거나 아직 유효한 prepared 시도면 같은 주문으로 다시 결제할 수 있다', () => {
    expect(checkoutPaymentClosure(base, now)).toBeNull();
    expect(checkoutPaymentClosure({
      ...base,
      paymentAttempt: { state: 'prepared', expiresAt: '2026-10-12T05:00:01.000Z', provider: 'toss' },
    }, now)).toBeNull();
  });

  it.each(['declined', 'canceled'])('%s 시도는 같은 주문 재결제를 닫는다', (state) => {
    expect(checkoutPaymentClosure({
      ...base,
      paymentAttempt: { state, expiresAt: '2026-10-12T05:10:00.000Z', provider: 'toss' },
    }, now)).toBe('not_approved');
  });

  it('유효 시간이 지난 prepared 시도는 결제를 닫는다', () => {
    expect(checkoutPaymentClosure({
      ...base,
      paymentAttempt: { state: 'prepared', expiresAt: '2026-10-12T05:00:00.000Z', provider: 'toss' },
    }, now)).toBe('attempt_expired');
  });

  it('처리 중인 취소 요청은 결제를 닫는다', () => {
    expect(checkoutPaymentClosure({ ...base, hasActiveCancellationRequest: true }, now))
      .toBe('cancellation_requested');
  });

  it('진행 중·모호한 시도는 닫힘이 아니라 확인 중 축이다', () => {
    for (const state of ['confirming', 'unknown', 'needs_review', 'approved']) {
      expect(checkoutPaymentClosure({
        ...base,
        paymentAttempt: { state, expiresAt: '2026-10-12T04:00:00.000Z', provider: 'toss' },
      }, now)).toBeNull();
    }
  });

  it('무통장 주문은 시도 만료가 곧 입금 기한이라 이 판정을 쓰지 않는다', () => {
    expect(checkoutPaymentClosure({
      ...base,
      paymentMethod: 'bank_transfer',
      paymentAttempt: { state: 'prepared', expiresAt: '2026-10-12T04:00:00.000Z', provider: 'bank_transfer' },
    }, now)).toBeNull();
  });

  it('닫힌 결제는 결제 대기 주문을 payable 대신 payment_closed로 보낸다', () => {
    expect(checkoutOrderState('pending', null, '2026-10-12T05:10:00.000Z', now, 'not_approved'))
      .toBe('payment_closed');
    expect(checkoutOrderState('pending', 'pending', '2026-10-12T05:10:00.000Z', now, 'not_approved'))
      .toBe('checking');
    expect(checkoutOrderState('pending', null, '2026-10-12T04:59:00.000Z', now, 'not_approved'))
      .toBe('closed');
  });
});

describe('checkoutReorderMode', () => {
  const now = Date.parse('2026-10-12T05:00:00.000Z');
  const order: CheckoutClosureInput = {
    status: 'pending',
    paymentMethod: 'card',
    paymentStatus: null,
    paymentAttempt: { state: 'declined', expiresAt: '2026-10-12T05:10:00.000Z', provider: 'toss' },
    hasActiveCancellationRequest: false,
  };
  const prepared = (expiresAt: string) => ({
    ...order,
    paymentAttempt: { state: 'prepared', expiresAt, provider: 'toss' },
  });

  it('승인 거절된 결제 대기 주문은 즉시 취소 뒤 다시 담을 수 있다', () => {
    expect(checkoutReorderMode(order, 'payment_closed', now)).toBe('cancel_then_reorder');
    expect(checkoutReorderMode({ ...order, paymentAttempt: null }, 'closed', now)).toBe('cancel_then_reorder');
  });

  /* 2026-10-12 QA-1: 유효 시간이 지난 prepared 시도는 claim·재-prepare가 모두 거절되므로
     request_order_claim이 즉시 취소한다. 거절 주문과 같은 정리 흐름을 연다. */
  it('서버가 읽은 유효 시간이 지난 prepared 시도만 남은 주문도 즉시 취소 뒤 다시 담을 수 있다', () => {
    expect(checkoutReorderMode(prepared('2026-10-12T05:00:00.000Z'), 'payment_closed', now))
      .toBe('cancel_then_reorder');
    expect(checkoutReorderMode(prepared('2026-10-12T04:50:00.000Z'), 'closed', now))
      .toBe('cancel_then_reorder');
  });

  it('아직 유효한 prepared 시도나 시각을 모르는 첫 렌더에서는 시도 만료를 단정하지 않는다', () => {
    expect(checkoutReorderMode(prepared('2026-10-12T05:00:01.000Z'), 'payment_closed', now)).toBeNull();
    expect(checkoutReorderMode(prepared('2026-10-12T04:50:00.000Z'), 'payment_closed', 0)).toBeNull();
    expect(checkoutReorderMode(prepared('not-a-date'), 'payment_closed', now)).toBeNull();
  });

  it('고객 취소가 즉시 끝나지 않는 주문에는 액션을 열지 않는다', () => {
    // 승인 API를 불렀거나 부를 수 있는 시도는 request_order_claim이 요청만 접수한다.
    for (const state of ['confirming', 'unknown', 'needs_review', 'approved']) {
      expect(checkoutReorderMode({
        ...order,
        paymentAttempt: { state, expiresAt: '2026-10-12T04:00:00.000Z', provider: 'toss' },
      }, 'payment_closed', now)).toBeNull();
    }
    expect(checkoutReorderMode({ ...order, paymentStatus: 'failed' }, 'payment_closed', now)).toBeNull();
    expect(checkoutReorderMode({ ...order, hasActiveCancellationRequest: true }, 'payment_closed', now)).toBeNull();
    expect(checkoutReorderMode({ ...order, paymentAttempt: null }, 'payable', now)).toBeNull();
    expect(checkoutReorderMode({ ...order, paymentMethod: 'bank_transfer' }, 'payment_closed', now)).toBeNull();
    expect(checkoutReorderMode({ ...order, status: 'paid' }, 'complete', now)).toBeNull();
  });

  it('이미 취소된 카드 주문은 취소 없이 다시 담기만 연다', () => {
    expect(checkoutReorderMode({ ...order, status: 'canceled' }, 'closed', now)).toBe('reorder');
  });
});

/* 주문 상세가 결제 화면과 같은 규칙으로 결제 국면을 읽는다(QA-2). */
describe('readCheckoutPayment', () => {
  const now = Date.parse('2026-10-12T05:12:00.000Z');
  const order = {
    status: 'pending',
    paymentMethod: 'card' as const,
    paymentStatus: null,
    paymentAttempt: null,
    hasActiveCancellationRequest: false,
    expiresAt: '2026-10-12T05:15:00.000Z',
  };

  it('승인 거절된 결제 대기 주문은 닫힌 결제이고 취소 뒤 다시 담을 수 있다', () => {
    expect(readCheckoutPayment({
      ...order,
      paymentAttempt: { state: 'declined', expiresAt: '2026-10-12T05:10:00.000Z', provider: 'toss' },
    }, now)).toEqual({
      state: 'payment_closed',
      closure: 'not_approved',
      reorderMode: 'cancel_then_reorder',
      provider: 'toss',
    });
  });

  it('유효 시간이 지난 prepared 시도는 닫힌 결제이고 거절 주문처럼 취소 뒤 다시 담을 수 있다', () => {
    expect(readCheckoutPayment({
      ...order,
      paymentAttempt: { state: 'prepared', expiresAt: '2026-10-12T05:11:00.000Z', provider: 'toss' },
    }, now)).toEqual({
      state: 'payment_closed',
      closure: 'attempt_expired',
      reorderMode: 'cancel_then_reorder',
      provider: 'toss',
    });
  });

  it('시도가 없거나 유효하면 결제할 수 있고, 확인 중 시도는 확인 중이다', () => {
    expect(readCheckoutPayment(order, now)).toEqual({ state: 'payable', closure: null, reorderMode: null, provider: null });
    expect(readCheckoutPayment({ ...order, paymentStatus: 'pending' }, now).state).toBe('checking');
  });

  it('결제 기한이 지난 주문은 닫힘 사유를 싣지 않는다', () => {
    expect(readCheckoutPayment({
      ...order,
      expiresAt: '2026-10-12T05:00:00.000Z',
      paymentAttempt: { state: 'declined', expiresAt: '2026-10-12T04:55:00.000Z', provider: 'toss' },
    }, now)).toEqual({ state: 'closed', closure: null, reorderMode: 'cancel_then_reorder', provider: 'toss' });
  });
});

describe('checkoutEffectivePaymentStatus', () => {
  it('승인 API를 부른 뒤 확정하지 못한 시도는 원장 행이 없어도 확인 중이다', () => {
    for (const state of ['confirming', 'unknown', 'needs_review']) {
      expect(checkoutEffectivePaymentStatus(state, null)).toBe('pending');
    }
    expect(checkoutEffectivePaymentStatus('declined', null)).toBeNull();
    expect(checkoutEffectivePaymentStatus(undefined, 'paid')).toBe('paid');
  });
});

describe('checkoutDeadlineTimeLabel', () => {
  it('결제 기한을 KST 시:분으로 고정해 서버·브라우저 렌더가 갈라지지 않게 한다', () => {
    expect(checkoutDeadlineTimeLabel('2026-10-12T05:15:00.000Z')).toBe('14:15');
    expect(checkoutDeadlineTimeLabel(null)).toBeNull();
    expect(checkoutDeadlineTimeLabel('not-a-date')).toBeNull();
  });
});

describe('checkoutPaymentResultOutcome', () => {
  const now = Date.parse('2026-10-12T05:00:00.000Z');
  const attempt = (state: string, expiresAt = '2026-10-12T05:05:00.000Z') => ({ state, expiresAt });

  it('주문 상태가 결제 완료 국면이면 승인, 취소면 취소다', () => {
    expect(checkoutPaymentResultOutcome({ orderStatus: 'paid', paymentStatus: 'paid', attempt: attempt('approved') }, now))
      .toBe('approved');
    expect(checkoutPaymentResultOutcome({ orderStatus: 'canceled', paymentStatus: null, attempt: attempt('canceled') }, now))
      .toBe('canceled');
  });

  /* C race 스모크 케이스 A: 승인을 기다리는 사이 취소를 요청했다. 결제 원장은 paid, 주문은
     pending, 요청은 processing(자동 결제 취소가 실패하면 needs_review)이다(INT-5). */
  it('승인된 결제를 취소 요청에 따라 취소하는 중이면 확인 중이 아니라 결제 취소 진행이다', () => {
    expect(checkoutPaymentResultOutcome({
      orderStatus: 'pending', paymentStatus: 'paid', attempt: attempt('approved'), hasActiveCancellationRequest: true,
    }, now)).toBe('refund_in_progress');
    expect(checkoutPaymentResultOutcome({
      orderStatus: 'pending', paymentStatus: 'paid', attempt: attempt('approved'), hasActiveCancellationRequest: false,
    }, now)).toBe('checking');
  });

  it('승인 뒤 결제사 취소까지 끝나 취소된 주문은 결제 취소 완료로 구분한다', () => {
    expect(checkoutPaymentResultOutcome({
      orderStatus: 'canceled', paymentStatus: 'refunded', attempt: attempt('approved'),
    }, now)).toBe('refunded');
  });

  it('승인 콜백과 어긋나지 않는 결과는 승인·결제 취소 진행·결제 취소 완료뿐이다', () => {
    expect(checkoutPaymentResultFollowsApproval('approved')).toBe(true);
    expect(checkoutPaymentResultFollowsApproval('refund_in_progress')).toBe(true);
    expect(checkoutPaymentResultFollowsApproval('refunded')).toBe(true);
    for (const outcome of ['checking', 'not_approved', 'attempt_expired', 'retryable', 'cancellation_requested', 'canceled'] as const) {
      expect(checkoutPaymentResultFollowsApproval(outcome)).toBe(false);
    }
  });

  it('늦게 끝낸 인증(시도 만료)은 확인 중이 아니라 시도 만료다', () => {
    expect(checkoutPaymentResultOutcome({
      orderStatus: 'pending', paymentStatus: null, attempt: attempt('prepared', '2026-10-12T04:59:59.000Z'),
    }, now)).toBe('attempt_expired');
  });

  it('유효한 prepared 시도는 같은 주문 재시도, 거절·취소 시도는 다시 결제 불가다', () => {
    expect(checkoutPaymentResultOutcome({ orderStatus: 'pending', paymentStatus: null, attempt: attempt('prepared') }, now))
      .toBe('retryable');
    expect(checkoutPaymentResultOutcome({ orderStatus: 'pending', paymentStatus: null, attempt: attempt('declined') }, now))
      .toBe('not_approved');
    expect(checkoutPaymentResultOutcome({ orderStatus: 'pending', paymentStatus: null, attempt: attempt('canceled') }, now))
      .toBe('not_approved');
  });

  it('승인 전에 닫힌 시도에 처리 중인 취소 요청이 있으면 재시도 대신 취소 요청으로 안내한다', () => {
    for (const state of ['prepared', 'declined', 'canceled']) {
      expect(checkoutPaymentResultOutcome({
        orderStatus: 'pending', paymentStatus: null, attempt: attempt(state), hasActiveCancellationRequest: true,
      }, now)).toBe('cancellation_requested');
    }
    expect(checkoutPaymentResultOutcome({
      orderStatus: 'pending', paymentStatus: null, attempt: attempt('prepared'), hasActiveCancellationRequest: false,
    }, now)).toBe('retryable');
  });

  it('결제가 잡혔을 수 있는 시도는 취소 요청이 있어도 확인 중으로 둔다', () => {
    for (const state of ['confirming', 'unknown', 'needs_review', 'approved']) {
      expect(checkoutPaymentResultOutcome({
        orderStatus: 'pending', paymentStatus: null, attempt: attempt(state), hasActiveCancellationRequest: true,
      }, now)).toBe('checking');
    }
  });

  it('결제가 잡혔을 수 있는 상태와 모르는 값은 확인 중으로 둔다', () => {
    for (const state of ['confirming', 'unknown', 'needs_review', 'approved', 'something_new']) {
      expect(checkoutPaymentResultOutcome({ orderStatus: 'pending', paymentStatus: null, attempt: attempt(state) }, now))
        .toBe('checking');
    }
    expect(checkoutPaymentResultOutcome({ orderStatus: 'pending', paymentStatus: 'pending', attempt: attempt('declined') }, now))
      .toBe('checking');
  });
});
