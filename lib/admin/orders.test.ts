import { describe, expect, it } from 'vitest';
import {
  adminOrdersHref,
  isKorpayManualRecoveryState,
  normalizeAdminCancellationDecisionForm,
  normalizeAdminGoodsManualRecoveryForm,
  normalizeAdminOrderFilters,
  normalizeAdminOrderStatusForm,
  normalizeAdminOrderTrackingForm,
} from './orders';
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
      errors: { reason: '거절 사유를 10자 이상 200자 이하로 입력해주세요.' },
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
      orderId: null,
      page: 2,
      query: 'maple fan',
      status: 'paid',
      to: '2026-07-14',
    }, { orderId: ORDER_ID, page: 1 })).toBe(
      `/admin/sales/orders?status=paid&from=2026-07-01&to=2026-07-14&query=maple+fan&page=1&order=${ORDER_ID}`,
    );
  });
});
