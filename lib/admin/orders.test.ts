import { describe, expect, it } from 'vitest';
import {
  adminOrdersHref,
  normalizeAdminCancellationDecisionForm,
  normalizeAdminOrderFilters,
  normalizeAdminOrderStatusForm,
} from './orders';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

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

  it('실재하지 않는 달력 날짜와 과도한 검색어를 거른다', () => {
    expect(normalizeAdminOrderFilters({
      from: '2026-02-30',
      query: '가'.repeat(101),
      to: '2026-13-01',
    })).toMatchObject({ from: null, query: '', to: null });
  });
});

describe('admin order mutation forms', () => {
  it('배송 상태 전이는 shipping·done만 허용한다', () => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('status', 'shipping');

    expect(normalizeAdminOrderStatusForm(formData)).toEqual({
      ok: true,
      value: { orderId: ORDER_ID, status: 'shipping' },
    });

    formData.set('status', 'canceled');
    expect(normalizeAdminOrderStatusForm(formData)).toEqual({
      ok: false,
      errors: { status: '허용된 배송 상태를 선택해주세요.' },
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
      `/admin?section=orders&status=paid&from=2026-07-01&to=2026-07-14&query=maple+fan&page=1&order=${ORDER_ID}`,
    );
  });
});
