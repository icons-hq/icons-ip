import { describe, expect, it } from 'vitest';
import {
  ADMIN_PAYMENT_METHOD_LABELS,
  ADMIN_PAYMENT_METHOD_OPTIONS,
  adminOrderPaymentMethodLabel,
  GOODS_PAYMENT_ATTEMPT_STATES,
  GOODS_PAYMENT_ATTEMPT_STATE_LABELS,
  adminVirtualAccountEscrowLabel,
  parseAdminOrderVirtualAccount,
  adminOrderBackHref,
  adminOrderDetailHref,
  adminOrderPanelHref,
  adminOrdersHref,
  isKorpayManualRecoveryState,
  normalizeAdminCancellationDecisionForm,
  normalizeAdminGoodsManualRecoveryForm,
  normalizeAdminOrderFilters,
  normalizeAdminOrderStatusForm,
  normalizeAdminStaffCancellationForm,
  normalizeAdminOrderTrackingForm, ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURE_LABELS, ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURES, ADMIN_VIRTUAL_ACCOUNT_REFUND_HINTS, adminTransferEscrowLabel, adminVirtualAccountRefundHint, adminVirtualAccountRefundStateLabel, parseAdminOrderTransferEscrow,
} from './orders';
import { PAYMENT_PROVIDER_LABELS, PAYMENT_PROVIDER_VALUE_LABELS, paymentProviderValueLabel } from '@/lib/payments/provider-capabilities';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';

/* 택배사 목록의 진실원은 DB 레지스트리다(#251). 폼 검증도 상수가 아니라 넘겨받은
   레지스트리를 본다 — 비활성 택배사를 고른 저장을 폼이 먼저 막는지 함께 고정한다. */
const CARRIERS: ShippingCarrierRegistry = [
  {
    code: 'hanjin',
    label: '한진택배',
    active: true,
    trackingUrlTemplate: 'https://example.test/track?no={trackingNumber}',
  },
  {
    code: 'retired_courier',
    label: '계약종료 택배',
    active: false,
    trackingUrlTemplate: 'https://example.test/old?no={trackingNumber}',
  },
];

describe('Korpay manual recovery states', () => {
  it.each(['confirming', 'approved', 'unknown', 'needs_review'] as const)(
    '%s 상태를 원장 확인 대상으로 분류한다',
    (state) => expect(isKorpayManualRecoveryState(state)).toBe(true),
  );

  it.each(['prepared', 'declined', 'canceled'] as const)(
    '%s 상태를 수동 원장 확인에서 제외한다',
    (state) => expect(isKorpayManualRecoveryState(state)).toBe(false),
  );
});

describe('normalizeAdminOrderFilters', () => {
  it('정상 검색 조건과 KST 기간·페이지를 보존한다', () => {
    expect(normalizeAdminOrderFilters({
      from: '2026-07-01',
      order: ORDER_ID,
      page: '3',
      query: '  fan@example.test  ',
      status: 'paid',
      to: '2026-07-14',
    })).toEqual({
      field: 'all',
      from: '2026-07-01',
      orderId: ORDER_ID,
      page: 3,
      query: 'fan@example.test',
      status: 'paid',
      to: '2026-07-14',
    });
  });

  it('허용 목록 밖 값·역전 기간·배열 입력은 안전한 기본값으로 정규화한다', () => {
    expect(normalizeAdminOrderFilters({
      from: '2026-07-20',
      order: 'not-a-uuid',
      page: '-4',
      query: ['first', 'second'],
      status: 'refunded',
      to: '2026-07-01',
    })).toEqual({
      field: 'all',
      from: null,
      orderId: null,
      page: 1,
      query: '',
      status: 'all',
      to: null,
    });
  });

  // 새 사다리 단계가 필터 허용 목록에 없으면 발주확인·배송완료 주문만 모아
  // 보는 화면이 통째로 'all'로 떨어진다(#250).
  it.each(['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'] as const)(
    '%s 상태 필터를 사다리 값으로 받는다',
    (status) => {
      expect(normalizeAdminOrderFilters({ status })).toMatchObject({ status });
    },
  );

  it('실재하지 않는 달력 날짜와 과도한 검색어를 거른다', () => {
    expect(normalizeAdminOrderFilters({
      from: '2026-02-30',
      query: '가'.repeat(101),
      to: '2026-13-01',
    })).toMatchObject({ from: null, query: '', to: null });
  });

  it.each(['all', 'order', 'nickname', 'email', 'recipient', 'tracking'] as const)(
    '%s 검색 대상을 URL 필터로 보존한다',
    (field) => {
      expect(normalizeAdminOrderFilters({ field })).toMatchObject({ field });
    },
  );

  it('허용하지 않은 검색 대상은 전체 검색으로 되돌린다', () => {
    expect(normalizeAdminOrderFilters({ field: 'unknown' })).toMatchObject({ field: 'all' });
  });
});

describe('admin order mutation forms', () => {
  it('상태 폼은 사다리 중간 세 칸만 허용한다', () => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('status', 'shipping');
    formData.set('carrier', 'hanjin');
    formData.set('trackingNumber', '1234-5678-9012');

    expect(normalizeAdminOrderStatusForm(formData, CARRIERS)).toEqual({
      ok: true,
      value: {
        orderId: ORDER_ID,
        status: 'shipping',
        carrier: 'hanjin',
        trackingNumber: '123456789012',
      },
    });

    /* paid·done·canceled는 각각 결제 웹훅·자동 거래확정 잡·청약철회 경로가
       소유한다. 운영자 폼이 그 칸을 밀 수 있으면 소유권이 두 곳이 된다(#250). */
    for (const owned of ['pending', 'paid', 'done', 'canceled']) {
      formData.set('status', owned);
      expect(normalizeAdminOrderStatusForm(formData, CARRIERS)).toEqual({
        ok: false,
        errors: { status: '허용된 주문 상태를 선택해주세요.' },
      });
    }
  });

  it('배송 시작은 운송장 없이 통과하지 못한다', () => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('status', 'shipping');

    expect(normalizeAdminOrderStatusForm(formData, CARRIERS)).toEqual({
      ok: false,
      errors: {
        carrier: '택배사를 선택해주세요.',
        trackingNumber: '운송장번호를 입력해주세요.',
      },
    });

    formData.set('carrier', 'unknown_carrier');
    formData.set('trackingNumber', '12345');
    expect(normalizeAdminOrderStatusForm(formData, CARRIERS)).toEqual({
      ok: false,
      errors: {
        carrier: '택배사를 선택해주세요.',
        trackingNumber: '운송장번호는 하이픈을 뺀 8~30자리 영숫자여야 합니다.',
      },
    });
  });

  /* 등록만 되어 있고 계약이 끝난 택배사로 새 운송장을 붙이면 DB 게이트가
     거절한다. 폼이 먼저 막지 않으면 운영자는 이유를 알 수 없는 저장 실패를 본다. */
  it('비활성 택배사는 새 운송장에 붙일 수 없다', () => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('status', 'shipping');
    formData.set('carrier', 'retired_courier');
    formData.set('trackingNumber', '123456789012');

    expect(normalizeAdminOrderStatusForm(formData, CARRIERS)).toEqual({
      ok: false,
      errors: { carrier: '택배사를 선택해주세요.' },
    });
  });

  it.each([
    ['발주확인', 'confirmed'],
    ['배송완료', 'delivered'],
  ])('%s 전이는 운송장 입력을 다시 받지 않는다', (_label, status) => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('status', status);
    formData.set('carrier', 'hanjin');
    formData.set('trackingNumber', '123456789012');

    expect(normalizeAdminOrderStatusForm(formData, CARRIERS)).toEqual({
      ok: true,
      value: { orderId: ORDER_ID, status, carrier: null, trackingNumber: null },
    });
  });

  it('운송장 수정 폼은 주문·택배사·운송장번호를 모두 검증한다', () => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('carrier', 'hanjin');
    formData.set('trackingNumber', ' 1234 5678 9012 ');

    expect(normalizeAdminOrderTrackingForm(formData, CARRIERS)).toEqual({
      ok: true,
      value: { orderId: ORDER_ID, carrier: 'hanjin', trackingNumber: '123456789012' },
    });

    formData.set('orderId', 'not-a-uuid');
    formData.set('carrier', '');
    formData.set('trackingNumber', '');
    expect(normalizeAdminOrderTrackingForm(formData, CARRIERS)).toEqual({
      ok: false,
      errors: {
        orderId: '주문을 찾을 수 없습니다.',
        carrier: '택배사를 선택해주세요.',
        trackingNumber: '운송장번호를 입력해주세요.',
      },
    });
  });

  it('승인은 request uuid만 받고 provider 식별자는 폼에서 받지 않는다', () => {
    const formData = new FormData();
    formData.set('requestId', REQUEST_ID);
    formData.set('paymentKey', 'should-never-be-consumed');
    formData.set('amount', '999999');

    expect(normalizeAdminCancellationDecisionForm(formData, 'approve')).toEqual({
      ok: true,
      value: { requestId: REQUEST_ID },
    });
  });

  it('거절은 request uuid와 10~200자 운영 사유를 요구한다', () => {
    const formData = new FormData();
    formData.set('requestId', REQUEST_ID);
    formData.set('reason', '구매자와 확인 후 요청을 반려합니다');

    expect(normalizeAdminCancellationDecisionForm(formData, 'reject')).toEqual({
      ok: true,
      value: {
        requestId: REQUEST_ID,
        reason: '구매자와 확인 후 요청을 반려합니다',
      },
    });

    formData.set('reason', '짧음');
    expect(normalizeAdminCancellationDecisionForm(formData, 'reject')).toEqual({
      ok: false,
      errors: { reason: '거부 사유를 10자 이상 200자 이하로 적어주세요.' },
    });
  });

  it('Korpay 취소 확인은 request와 exact attestation을 요구한다', () => {
    const formData = new FormData();
    formData.set('attemptId', ATTEMPT_ID);
    formData.set('requestId', REQUEST_ID);
    formData.set('operatorAttestation', 'provider_cancel_confirmed');

    expect(normalizeAdminGoodsManualRecoveryForm(formData)).toEqual({
      ok: true,
      value: {
        operation: 'provider_cancel_confirmed',
        attemptId: ATTEMPT_ID,
        requestId: REQUEST_ID,
        operatorAttested: true,
      },
    });

    formData.set('operatorAttestation', 'yes');
    expect(normalizeAdminGoodsManualRecoveryForm(formData)).toEqual({
      ok: false,
      errors: {
        operatorAttestation: '결제사 원장에서 전액 취소를 확인해야 합니다.',
      },
    });
  });
});

describe('adminOrdersHref', () => {
  it('필터를 보존하면서 선택 주문과 페이지를 교체한다', () => {
    expect(adminOrdersHref({
      from: '2026-07-01',
      field: 'recipient',
      orderId: null,
      page: 2,
      query: 'maple fan',
      status: 'paid',
      to: '2026-07-14',
    }, { orderId: ORDER_ID, page: 1 })).toBe(
      `/admin/sales/orders?status=paid&from=2026-07-01&to=2026-07-14&query=maple+fan&field=recipient&page=1&order=${ORDER_ID}`,
    );
  });

  it('전용 주문 상세 링크에 목록 조건을 안전하게 싣는다', () => {
    const filters = {
      field: 'tracking' as const,
      from: '2026-07-01',
      orderId: ORDER_ID,
      page: 2,
      query: '1234-5678',
      status: 'shipping' as const,
      to: '2026-07-14',
    };
    const href = adminOrderDetailHref(ORDER_ID, filters);
    const back = new URLSearchParams(href.split('?')[1]).get('back');

    expect(href).toContain(`/admin/sales/orders/${ORDER_ID}?back=`);
    expect(back).toBe(adminOrdersHref(filters));
    expect(adminOrderBackHref(back)).toBe(adminOrdersHref(filters));
  });

  it('상세 back 값은 허용된 주문·거래확정 목록 조건만 복원한다', () => {
    expect(adminOrderBackHref('/admin/sales/dispatch?tab=delayed&delayNotice=partial_failed&page=2&query=ABC'))
      .toBe('/admin/sales/dispatch?tab=delayed&page=2&query=ABC&delayNotice=partial_failed');
    expect(adminOrderBackHref(
      `/admin/sales/orders?status=shipping&field=tracking&query=ABC&page=3&evil=1`,
    )).toBe('/admin/sales/orders?status=shipping&query=ABC&field=tracking&page=3');
    expect(adminOrderBackHref(
      '/admin/sales/settled?from=2026-07-01&to=2026-07-14&query=ABC&page=2&evil=1',
    )).toBe('/admin/sales/settled?from=2026-07-01&to=2026-07-14&query=ABC&page=2');
    expect(adminOrderBackHref(
      '/admin/sales/shipping?tab=transit&originId=00000000-0000-4000-8000-000000042201&query=ABC&page=2&evil=1',
    )).toBe('/admin/sales/shipping?tab=transit&page=2&originId=00000000-0000-4000-8000-000000042201&query=ABC');
    expect(adminOrderBackHref('https://evil.example/steal')).toBe('/admin/sales/orders');
  });
});

/* 토스 가상계좌(ADR-0049): 입금 대기는 결제 시도의 새 상태이고, 주문의 입금 계좌는 admin_order_virtual_account가 돌려준다. */
describe('가상계좌 입금 대기와 입금 정보', () => {
  it('결제 시도 상태에 입금 대기(가상계좌)가 있고 모든 상태에 운영자 표기가 있다', () => {
    expect(GOODS_PAYMENT_ATTEMPT_STATES).toContain('awaiting_deposit');
    expect(GOODS_PAYMENT_ATTEMPT_STATE_LABELS.awaiting_deposit).toBe('입금 대기(가상계좌)');
    for (const state of GOODS_PAYMENT_ATTEMPT_STATES) expect(GOODS_PAYMENT_ATTEMPT_STATE_LABELS[state], state).toBeTruthy();
    expect(isKorpayManualRecoveryState('awaiting_deposit')).toBe(false);
  });

  it('입금 정보를 읽고, 가상계좌가 아닌 주문(null)과 형식이 어긋난 응답(undefined)을 구분한다', () => {
    const account = { bankCode: '20', accountNumber: 'X1234567890', dueAt: '2026-11-25T15:00:00+00:00', amount: 32000, useEscrow: true, state: 'awaiting' };
    expect(parseAdminOrderVirtualAccount(account)).toEqual({ ...account, escrow: null, refund: null });
    expect(parseAdminOrderVirtualAccount({ ...account, useEscrow: null })?.useEscrow).toBeNull();
    expect(parseAdminOrderVirtualAccount({ ...account, useEscrow: undefined })?.useEscrow).toBeNull();
    expect(parseAdminOrderVirtualAccount(null)).toBeNull();
    for (const broken of [[], 'x', { ...account, bankCode: '우리' }, { ...account, accountNumber: '12 34' }, { ...account, dueAt: 'soon' },
      { ...account, amount: -1 }, { ...account, amount: 1.5 }, { ...account, useEscrow: 'Y' }, { ...account, state: 'expired' }]) {
      expect(parseAdminOrderVirtualAccount(broken), JSON.stringify(broken)).toBeUndefined();
    }
  });

  /* 에스크로 배송 등록 작업(20261125090200) — 운영자 json에만 실린다. 모르는 값은 조용히 접지 않고 '불러오지 못했다'로 본다. */
  it('에스크로 배송 등록 작업을 읽고, 모르는 값이면 응답 전체를 읽지 못한 것으로 본다', () => {
    const account = { bankCode: '20', accountNumber: 'X1234567890', dueAt: '2026-11-25T15:00:00+00:00', amount: 32000, useEscrow: true, state: 'deposited' };
    expect(parseAdminOrderVirtualAccount({ ...account, escrow: { deliveryState: 'manual_required', escrowStatus: null, lastErrorCode: 'INVALID_COMPANY' } })?.escrow)
      .toEqual({ deliveryState: 'manual_required', escrowStatus: null, lastErrorCode: 'INVALID_COMPANY' });
    expect(parseAdminOrderVirtualAccount({ ...account, escrow: { deliveryState: 'registered', escrowStatus: 'CANCEL_REQUESTED', lastErrorCode: null } })?.escrow)
      .toEqual({ deliveryState: 'registered', escrowStatus: 'CANCEL_REQUESTED', lastErrorCode: null });
    expect(parseAdminOrderVirtualAccount({ ...account, escrow: null })?.escrow).toBeNull();
    for (const escrow of [{ deliveryState: 'lost' }, { deliveryState: 'ready', escrowStatus: 'DONE' }, { deliveryState: 'ready', lastErrorCode: 'bad code!' }, []]) {
      expect(parseAdminOrderVirtualAccount({ ...account, escrow }), JSON.stringify(escrow)).toBeUndefined();
    }
  });

  /* 환불 뒤 은행 송금 감시(20261125110000) — 운영자 json에만 실린다. 실패 신호를 조용히 접지 않는다. */
  it('환불 송금 감시를 읽고, 실패에는 사유가 있어야 하며 모르는 값이면 응답 전체를 읽지 못한 것으로 본다', () => {
    const account = { bankCode: '20', accountNumber: 'X1234567890', dueAt: '2026-11-25T15:00:00+00:00', amount: 32000, useEscrow: false, state: 'deposited' };
    const refund = { state: 'failed', refundStatus: 'FAILED', failureCode: 'refund_failed', refundedAt: '2026-11-26T01:00:00+00:00',
      checkedAt: '2026-11-26T03:00:00+00:00', failedAt: '2026-11-26T03:00:00+00:00', resolvedAt: null, resolutionNote: null };
    expect(parseAdminOrderVirtualAccount({ ...account, refund })?.refund).toEqual({ state: 'failed', failureCode: 'refund_failed',
      refundedAt: refund.refundedAt, checkedAt: refund.checkedAt, resolutionNote: null, completedVia: null });
    // 에스크로 구매자 취소 환불을 시스템이 닫은 완료(20261125130000)는 근거와 함께 읽는다. 완료가 아닌데 근거가 있거나 모르는 근거면 읽지 않는다.
    const escrowSettled = { ...refund, state: 'completed', refundStatus: 'NONE', failureCode: null, completedVia: 'escrow_buyer_cancel' };
    expect(parseAdminOrderVirtualAccount({ ...account, refund: escrowSettled })?.refund?.completedVia).toBe('escrow_buyer_cancel');
    for (const broken of [{ ...escrowSettled, state: 'pending' }, { ...escrowSettled, completedVia: 'operator' }]) {
      expect(parseAdminOrderVirtualAccount({ ...account, refund: broken }), JSON.stringify(broken)).toBeUndefined();
    }
    expect(adminVirtualAccountRefundStateLabel({ state: 'completed', completedVia: 'escrow_buyer_cancel' })).toBe('토스 에스크로 환불로 닫힘');
    expect(adminVirtualAccountRefundStateLabel({ state: 'completed', completedVia: null })).toBe('환불 송금 완료');
    expect(adminVirtualAccountRefundHint({ state: 'completed', completedVia: 'escrow_buyer_cancel' })).toContain('토스페이먼츠 상점관리자');
    expect(parseAdminOrderVirtualAccount({ ...account, refund: { ...refund, state: 'pending', failureCode: null, checkedAt: null } })?.refund?.state).toBe('pending');
    for (const broken of [{ ...refund, state: 'lost' }, { ...refund, failureCode: null }, { ...refund, failureCode: 'other' }, { ...refund, refundedAt: 'soon' }]) {
      expect(parseAdminOrderVirtualAccount({ ...account, refund: broken }), JSON.stringify(broken)).toBeUndefined();
    }
    expect(ADMIN_VIRTUAL_ACCOUNT_REFUND_HINTS.failed).toContain('[처리 완료로 표시]');
    for (const code of ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURES) expect(ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURE_LABELS[code]).toBeTruthy();
  });

  /* 계좌이체 에스크로(20261125110100) — 구매자 선택 기록이 없어 결제사 조회 전에는 '확인 중'이다. */
  it('계좌이체 에스크로 작업을 읽고 적용 여부를 운영자 말로 쓴다', () => {
    expect(parseAdminOrderTransferEscrow({ useEscrow: null, deliveryState: 'ready', escrowStatus: null, lastErrorCode: null }))
      .toEqual({ useEscrow: null, job: { deliveryState: 'ready', escrowStatus: null, lastErrorCode: null } });
    expect(parseAdminOrderTransferEscrow({ useEscrow: true, deliveryState: 'manual_required', escrowStatus: 'IN_PROGRESS', lastErrorCode: 'carrier_unmapped' })?.job.deliveryState)
      .toBe('manual_required');
    expect(parseAdminOrderTransferEscrow(null)).toBeNull();
    for (const broken of [[], { useEscrow: 'Y', deliveryState: 'ready' }, { useEscrow: true, deliveryState: 'lost' }]) {
      expect(parseAdminOrderTransferEscrow(broken), JSON.stringify(broken)).toBeUndefined();
    }
    expect(adminTransferEscrowLabel(null)).toBe('확인 중(결제사 조회 전)');
    expect(adminTransferEscrowLabel(false)).toBe('적용 안 함');
  });

  it('구매안전서비스(에스크로) 적용 여부를 운영자 말로 쓴다', () => {
    expect(adminVirtualAccountEscrowLabel(true)).toBe('적용(구매자가 선택)');
    expect(adminVirtualAccountEscrowLabel(false)).toBe('적용 안 함');
    expect(adminVirtualAccountEscrowLabel(null)).toBe('기록 없음');
  });
});

/* 결제수단 값은 card·bank_transfer 둘뿐이다. card에는 토스의 카드·가상계좌·계좌이체와 나이스페이·코페이 결제가 함께 묶이므로 '카드'라고도, 결제사 하나의 이름으로도 부르지 않는다. */
describe('결제수단 이름', () => {
  it('card는 결제사 결제(카드·가상계좌·계좌이체) — 토스·나이스페이·코페이가 모두 이 값이라 결제사 이름을 붙이지 않는다 — bank_transfer는 무통장 입금(직접 이체)이다', () => {
    expect(ADMIN_PAYMENT_METHOD_LABELS).toEqual({ card: '결제사 결제(카드·가상계좌·계좌이체)', bank_transfer: '무통장 입금(직접 이체)' });
    expect(ADMIN_PAYMENT_METHOD_OPTIONS.map(option => option.value)).toEqual(['', 'card', 'bank_transfer']);
    expect(ADMIN_PAYMENT_METHOD_OPTIONS[0].label).toBe('전체');
    expect(JSON.stringify(ADMIN_PAYMENT_METHOD_OPTIONS)).not.toContain('"카드"');
    /* card에는 결제사 이름을 붙이지 않는다 — 나이스페이·코페이 주문에 틀린 결제사가 찍히지 않게 한다. 무통장은 결제사 이름표(lib/payments/provider-capabilities)의 이름이다. */
    for (const provider of Object.values(PAYMENT_PROVIDER_VALUE_LABELS)) expect(ADMIN_PAYMENT_METHOD_LABELS.card).not.toContain(provider);
    expect(ADMIN_PAYMENT_METHOD_LABELS.card).not.toMatch(/토스|나이스페이|코페이/);
    expect(ADMIN_PAYMENT_METHOD_LABELS.bank_transfer.startsWith(PAYMENT_PROVIDER_LABELS.bank_transfer)).toBe(true);
    expect([adminOrderPaymentMethodLabel('card'), adminOrderPaymentMethodLabel('bank_transfer'), adminOrderPaymentMethodLabel(null), adminOrderPaymentMethodLabel('point')])
      .toEqual([ADMIN_PAYMENT_METHOD_LABELS.card, ADMIN_PAYMENT_METHOD_LABELS.bank_transfer, '', 'point']);
    expect([paymentProviderValueLabel('toss'), paymentProviderValueLabel('korpay'), paymentProviderValueLabel('unknown_pg'), paymentProviderValueLabel(null)]).toEqual(['토스 결제', '코페이', null, null]);
  });
});

describe('주문 처리 패널 링크', () => {
  it('패널까지 여는 링크는 주문번호를 검색어로, 열 주문을 order로 싣는다(번호가 없는 옛 주문만 내부 번호)', () => {
    expect(adminOrderPanelHref(ORDER_ID, '2026102710000042')).toBe(`/admin/sales/orders?query=2026102710000042&order=${ORDER_ID}`);
    expect(adminOrderPanelHref(ORDER_ID)).toBe(`/admin/sales/orders?query=${ORDER_ID}&order=${ORDER_ID}`);
    expect(adminOrderPanelHref(ORDER_ID, null)).toBe(`/admin/sales/orders?query=${ORDER_ID}&order=${ORDER_ID}`);
    expect(new URL(adminOrderPanelHref(ORDER_ID, '2026102710000042'), 'https://x.test').searchParams.get('order')).toBe(ORDER_ID);
  });
});

describe('운영자 전액 취소 양식', () => {
  it('확인란 값은 받지 않는다 — 출고지시가 나간 배송 건은 창고 회신 기록으로 DB가 판정한다', () => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('reasonCode', 'out_of_stock');
    formData.set('note', '');
    formData.set('warehouseStopConfirmed', 'confirmed');
    expect(normalizeAdminStaffCancellationForm(formData)).toEqual({ ok: true, value: { orderId: ORDER_ID, reasonCode: 'out_of_stock', note: null } });
  });
});
