import { describe, expect, it } from 'vitest';
import {
  formatOrderDate,
  orderReferenceLabel,
  orderStatusMeta,
  summarizeOrderItems,
} from './orders';

describe('order presentation helpers', () => {
  it.each([
    ['paid', '결제완료', '주문이 접수됐어요'],
    ['shipping', '배송중', '굿즈가 배송 중이에요'],
    ['done', '완료', '주문이 완료됐어요'],
    ['canceled', '취소', '취소된 주문이에요'],
  ] as const)('maps %s to stable Korean copy', (status, label, title) => {
    expect(orderStatusMeta(status)).toMatchObject({ label, title });
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
