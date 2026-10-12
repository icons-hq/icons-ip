import { describe, expect, it } from 'vitest';
import {
  checkoutAddressErrors,
  checkoutDeadlineTimeLabel,
  checkoutOrderName,
  checkoutOrderState,
  checkoutPaymentClosure,
  checkoutPaymentResultOutcome,
  checkoutReorderMode,
  type CheckoutClosureInput,
  mapPlaceOrderError,
  normalizeCheckoutAddress,
  normalizeCheckoutKey,
  normalizeOrderReference,
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
    expect(mapPlaceOrderError('invalid checkout address')).toBe('invalid_address');
    expect(mapPlaceOrderError('account_suspended')).toBe('account_suspended');
    expect(mapPlaceOrderError('coupon_min_subtotal')).toBe('coupon_rejected');
    expect(mapPlaceOrderError('coupon_expired')).toBe('coupon_rejected');
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
  const order: CheckoutClosureInput = {
    status: 'pending',
    paymentMethod: 'card',
    paymentStatus: null,
    paymentAttempt: { state: 'declined', expiresAt: '2026-10-12T05:10:00.000Z', provider: 'toss' },
    hasActiveCancellationRequest: false,
  };

  it('승인 거절된 결제 대기 주문은 즉시 취소 뒤 다시 담을 수 있다', () => {
    expect(checkoutReorderMode(order, 'payment_closed')).toBe('cancel_then_reorder');
    expect(checkoutReorderMode({ ...order, paymentAttempt: null }, 'closed')).toBe('cancel_then_reorder');
  });

  it('고객 취소가 즉시 끝나지 않는 주문에는 액션을 열지 않는다', () => {
    // prepared(만료 포함)·진행 중 시도는 request_order_claim이 미해결로 보고 요청만 접수한다.
    for (const state of ['prepared', 'confirming', 'unknown', 'needs_review', 'approved']) {
      expect(checkoutReorderMode({
        ...order,
        paymentAttempt: { state, expiresAt: '2026-10-12T04:00:00.000Z', provider: 'toss' },
      }, 'payment_closed')).toBeNull();
    }
    expect(checkoutReorderMode({ ...order, paymentStatus: 'failed' }, 'payment_closed')).toBeNull();
    expect(checkoutReorderMode({ ...order, hasActiveCancellationRequest: true }, 'payment_closed')).toBeNull();
    expect(checkoutReorderMode({ ...order, paymentAttempt: null }, 'payable')).toBeNull();
    expect(checkoutReorderMode({ ...order, paymentMethod: 'bank_transfer' }, 'payment_closed')).toBeNull();
    expect(checkoutReorderMode({ ...order, status: 'paid' }, 'complete')).toBeNull();
  });

  it('이미 취소된 카드 주문은 취소 없이 다시 담기만 연다', () => {
    expect(checkoutReorderMode({ ...order, status: 'canceled' }, 'closed')).toBe('reorder');
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

  it('결제가 잡혔을 수 있는 상태와 모르는 값은 확인 중으로 둔다', () => {
    for (const state of ['confirming', 'unknown', 'needs_review', 'approved', 'something_new']) {
      expect(checkoutPaymentResultOutcome({ orderStatus: 'pending', paymentStatus: null, attempt: attempt(state) }, now))
        .toBe('checking');
    }
    expect(checkoutPaymentResultOutcome({ orderStatus: 'pending', paymentStatus: 'pending', attempt: attempt('declined') }, now))
      .toBe('checking');
  });
});
