import { describe, expect, it } from 'vitest';
import {
  formatOrderDate,
  isOrderDetailStatus,
  isVisibleOrderStatus,
  orderReferenceLabel,
  refundStatusLabel,
  orderStatusMeta,
  summarizeOrderItems,
} from './orders';

describe('order presentation helpers', () => {
  it.each([
    ['pending', '결제대기', '결제 상태를 확인하고 있어요'],
    ['paid', '결제완료', '주문이 접수됐어요'],
    ['confirmed', '발주확인', '주문을 확인하고 준비 중이에요'],
    ['shipping', '배송중', '굿즈가 배송 중이에요'],
    ['delivered', '배송완료', '굿즈가 배송 완료됐어요'],
    // "완료"가 아니라 "거래확정"이다(CONTEXT.md) — 변심 청약철회 창이 닫혔다는 뜻이고
    // 하자 클레임은 남아 있다.
    ['done', '거래확정', '거래가 확정됐어요'],
    ['canceled', '취소', '취소된 주문이에요'],
  ] as const)('maps %s to stable Korean copy', (status, label, title) => {
    expect(orderStatusMeta(status)).toMatchObject({ label, title });
  });

  // 사다리가 늘어도 목록·상세가 보는 상태 집합이 함께 늘어야 confirmed·delivered
  // 주문이 조용히 사라지지 않는다(#250).
  it.each(['paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'] as const)(
    'treats %s as a visible order status',
    (status) => {
      expect(isVisibleOrderStatus(status)).toBe(true);
      expect(isOrderDetailStatus(status)).toBe(true);
    },
  );

  it('keeps pending out of the visible history but inside the detail set', () => {
    expect(isVisibleOrderStatus('pending')).toBe(false);
    expect(isOrderDetailStatus('pending')).toBe(true);
    expect(isOrderDetailStatus('settled')).toBe(false);
  });

  it.each([
    ['requested', '환불 요청 접수'],
    ['done', '환불 완료'],
    ['failed', '환불 확인 필요'],
    ['unknown', '환불 처리 확인 필요'],
  ])('maps refund status %s without exposing provider details', (status, label) => {
    expect(refundStatusLabel(status)).toBe(label);
  });

  it('formats a short non-sensitive order reference and a Seoul calendar date', () => {
    expect(orderReferenceLabel('7ad4c967-3d48-44da-a665-64731ac33f62')).toBe('1AC33F62');
    expect(formatOrderDate('2026-07-14T16:30:00.000Z')).toBe('2026. 7. 15.');
  });

  it('summarizes immutable item snapshots without consulting the current catalog', () => {
    expect(summarizeOrderItems([
      { name: '리락쿠마 낮잠 쿠션', qty: 2 },
      { name: '메이플스토리 키링', qty: 1 },
    ])).toEqual({ label: '리락쿠마 낮잠 쿠션 외 1건', itemCount: 3 });
    expect(summarizeOrderItems([])).toEqual({ label: '주문한 굿즈', itemCount: 0 });
  });
});
