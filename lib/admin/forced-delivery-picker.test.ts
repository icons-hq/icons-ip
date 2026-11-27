import { describe, expect, it } from 'vitest';
import { FORCED_DELIVERY_PICKER_QUERY_MAX, forcedDeliveryOrderBlocked, normalizeForcedDeliveryPickRequest, parseForcedDeliveryOrderRows } from './forced-delivery-picker';

const row = (extra: Record<string, unknown> = {}) => ({ id: 'f0dd0000-0000-4001-8000-000000000001', user_id: 'abcdef01-0000-4000-8000-000000000001', buyer_name: '시험 구매자', status: 'confirmed',
  total: 12000, created_at: '2026-11-11T00:00:00Z', cancellation_request_status: null, total_count: 41, order_number: '2026111110000001', ...extra });

describe('강제 배송완료 주문 고르기 조회 조건', () => {
  it('선택창이 보낸 조건을 정해진 값으로만 받고, 모르는 값은 주문번호·발주확인·첫 쪽으로 돌린다', () => {
    expect(normalizeForcedDeliveryPickRequest({ query: ' 2026 ', field: 'nickname', filter: 'shipping', page: 3 })).toEqual({ query: '2026', field: 'nickname', status: 'shipping', page: 3 });
    expect(normalizeForcedDeliveryPickRequest({ query: '', field: 'email', filter: 'delivered', page: 0 })).toEqual({ query: '', field: 'order', status: 'confirmed', page: 1 });
    expect(normalizeForcedDeliveryPickRequest({ field: 'all', filter: '', page: 1.5 })).toEqual({ query: '', field: 'order', status: 'confirmed', page: 1 });
    for (const input of [null, undefined, 'x', 7, []]) expect(normalizeForcedDeliveryPickRequest(input)).toEqual({ query: '', field: 'order', status: 'confirmed', page: 1 });
    expect(normalizeForcedDeliveryPickRequest({ query: '가'.repeat(300) }).query).toHaveLength(FORCED_DELIVERY_PICKER_QUERY_MAX);
    expect(normalizeForcedDeliveryPickRequest({ page: 99_999_999 }).page).toBe(10_000);
  });
});

describe('강제 배송완료 주문 고르기 결과 읽기', () => {
  it('줄마다 주문번호·구매자·상태·금액을 읽고 전체 건수는 조회가 돌려준 값을 쓴다', () => {
    expect(parseForcedDeliveryOrderRows([row(), row({ id: 'f0dd0000-0000-4001-8000-000000000002', order_number: '2026111110000002', status: 'shipping', total: 0 })])).toEqual({
      total: 41,
      rows: [
        { orderId: 'f0dd0000-0000-4001-8000-000000000001', orderNumber: '2026111110000001', buyerName: '시험 구매자', status: 'confirmed', total: 12000, createdAt: '2026-11-11T00:00:00Z', cancellationInProgress: false },
        { orderId: 'f0dd0000-0000-4001-8000-000000000002', orderNumber: '2026111110000002', buyerName: '시험 구매자', status: 'shipping', total: 0, createdAt: '2026-11-11T00:00:00Z', cancellationInProgress: false },
      ],
    });
    expect(parseForcedDeliveryOrderRows([])).toEqual({ rows: [], total: 0 });
    /* 주문 상세·미리보기와 같은 이름 규칙: 별명이 없으면 fan_ 뒤 여섯 글자. */
    expect(parseForcedDeliveryOrderRows([row({ buyer_name: null }), row({ buyer_name: '  ' })])?.rows.map(item => item.buyerName)).toEqual(['fan_abcdef', 'fan_abcdef']);
  });

  it('취소 요청이 끝나지 않은 줄은 고를 수 없다고 말한다(끝났거나 거절된 요청은 막지 않는다)', () => {
    const blocked = (status: string | null) => parseForcedDeliveryOrderRows([row({ cancellation_request_status: status })])!.rows[0];
    for (const status of ['requested', 'processing', 'needs_review']) expect(forcedDeliveryOrderBlocked(blocked(status))).toBe('취소 요청이 진행 중입니다');
    for (const status of ['completed', 'rejected', null]) expect(forcedDeliveryOrderBlocked(blocked(status))).toBeNull();
  });

  it('모르는 모양이 하나라도 있으면 목록을 통째로 거절한다', () => {
    expect(parseForcedDeliveryOrderRows(null)).toBeNull();
    expect(parseForcedDeliveryOrderRows({})).toBeNull();
    for (const bad of [{ id: 'not-a-uuid' }, { user_id: null }, { order_number: '12345' }, { order_number: null }, { status: 'paid' }, { status: 'delivered' }, { total: -1 }, { total: 1.5 }, { total: '1000' },
      { created_at: 'yesterday' }, { buyer_name: 7 }, { cancellation_request_status: 3 }, { total_count: 'many' }, { total_count: -1 }]) {
      expect(parseForcedDeliveryOrderRows([row(), row(bad)]), JSON.stringify(bad)).toBeNull();
    }
    expect(parseForcedDeliveryOrderRows([null])).toBeNull();
  });
});
