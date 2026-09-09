import { describe, expect, it } from 'vitest';
import { normalizeAdminDispatchDelayForm } from './dispatch';

describe('지연 메모 폼', () => {
  const ORDER_ID = '11111111-1111-4111-8111-111111111111';

  function form(values: Record<string, string>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    return formData;
  }

  it('사유와 발송 예정일을 함께 저장한다', () => {
    expect(normalizeAdminDispatchDelayForm(form({
      orderId: ORDER_ID,
      reason: ' 작가 재입고 지연 ',
      expectedShipDate: '2026-08-20',
    }))).toEqual({
      ok: true,
      value: { orderId: ORDER_ID, reason: '작가 재입고 지연', expectedShipDate: '2026-08-20' },
    });
  });

  /* 모르는 날짜를 지어내면 CS에서 그대로 약속이 된다. 비우는 것이 정상 경로다. */
  it('발송 예정일은 비워 둘 수 있다', () => {
    expect(normalizeAdminDispatchDelayForm(form({
      orderId: ORDER_ID,
      reason: '재고 확인 중',
      expectedShipDate: '',
    }))).toMatchObject({ ok: true, value: { expectedShipDate: null } });
  });

  /* 해제 수단이 없으면 운영자가 사유를 '해결'로 덮어쓰고 지연 목록이 줄지 않는다. */
  it('사유를 비우면 메모 해제로 읽고 예정일도 함께 버린다', () => {
    expect(normalizeAdminDispatchDelayForm(form({
      orderId: ORDER_ID,
      reason: '   ',
      expectedShipDate: '2026-08-20',
    }))).toEqual({
      ok: true,
      value: { orderId: ORDER_ID, reason: null, expectedShipDate: null },
    });
  });

  /* 운영자가 적은 날짜가 조용히 사라지면 저장된 줄 안다. */
  it('깨진 주문 id와 날짜는 버리지 않고 되돌린다', () => {
    expect(normalizeAdminDispatchDelayForm(form({
      orderId: 'not-a-uuid',
      reason: '재고 확인 중',
      expectedShipDate: '2026-02-30',
    }))).toEqual({
      ok: false,
      errors: {
        orderId: '주문을 찾을 수 없습니다.',
        expectedShipDate: '발송 예정일을 YYYY-MM-DD 형식으로 입력해주세요.',
      },
    });
  });
});
