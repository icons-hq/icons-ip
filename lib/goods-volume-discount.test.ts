import { describe, expect, it } from 'vitest';
import oracle from '../test/fixtures/goods-transaction-independent-math.json';
import { calculateGoodsVolumeDiscount, parseGoodsVolumeDiscountPolicy, parseGoodsVolumeDiscountTerms, type GoodsVolumeDiscountPolicy } from './goods-volume-discount';

const at = '2026-10-14T00:00:00Z';
const policy: GoodsVolumeDiscountPolicy = { id: '00000000-0000-4000-8000-000000000001', goodId: 'good-a', revision: 1, status: 'active', draftValues: {},
  terms: { condition: 'quantity', threshold: 3, discountKind: 'fixed', discountValue: 1000, startsAt: null, endsAt: null } };

describe('복수구매 할인 독립 산식', () => {
  it.each(oracle.discounts)('Fraction oracle $input.condition/$input.kind/$input.target', vector => {
    const lines = vector.input.lines.map((line, index) => ({ lineId: `line-${index}`, goodId: policy.goodId, regularUnitPrice: line.regular, unitPrice: line.effective, qty: line.quantity }));
    const selected = { ...policy, terms: { ...policy.terms!, condition: vector.input.condition as 'quantity' | 'regular_subtotal', threshold: vector.input.target,
      discountKind: vector.input.kind as 'fixed' | 'percent', discountValue: vector.input.value } };
    const result = calculateGoodsVolumeDiscount(lines, [selected], at);
    expect([result.subtotal, result.volumeDiscountTotal, result.netSubtotal]).toEqual([vector.expected.subtotal, vector.expected.discount, vector.expected.net]);
    expect(result.lines.map(line => line.volumeUnitDiscount)).toEqual(vector.expected.unitDiscounts);
    const split = lines.flatMap(line => Array.from({ length: line.qty }, (_, index) => ({ ...line, lineId: `${line.lineId}-${index}`, qty: 1 })));
    expect(calculateGoodsVolumeDiscount(split, [selected], at).volumeDiscountTotal).toBe(result.volumeDiscountTotal);
  });
  it('옵션/직접입력 여러 줄을 합치되 다른 상품과 상태를 구분한다', () => {
    const line = { lineId: 'a', goodId: 'good-a', regularUnitPrice: 10000, unitPrice: 8000, qty: 2 };
    expect(calculateGoodsVolumeDiscount([line, { ...line, lineId: 'b', qty: 1 }], [policy], at).volumeDiscountTotal).toBe(3000);
    expect(calculateGoodsVolumeDiscount([line, { ...line, lineId: 'b', goodId: 'good-b', qty: 1 }], [policy], at).volumeDiscountTotal).toBe(0);
    expect(calculateGoodsVolumeDiscount([{ ...line, qty: 3 }], [{ ...policy, status: 'draft' }], at).volumeDiscountTotal).toBe(0);
  });
  it('활성 기간 시작 포함·종료 제외와 다음 경계를 지킨다', () => {
    const timed = { ...policy, terms: { ...policy.terms!, startsAt: at, endsAt: '2026-10-15T00:00:00Z' } };
    const lines = [{ lineId: 'a', goodId: 'good-a', regularUnitPrice: 10000, unitPrice: 8000, qty: 3 }];
    expect(calculateGoodsVolumeDiscount(lines, [timed], '2026-10-13T23:59:59Z')).toMatchObject({ volumeDiscountTotal: 0, nextChangeAt: at });
    expect(calculateGoodsVolumeDiscount(lines, [timed], at)).toMatchObject({ volumeDiscountTotal: 3000, nextChangeAt: timed.terms.endsAt });
    expect(calculateGoodsVolumeDiscount(lines, [timed], timed.terms.endsAt)).toMatchObject({ volumeDiscountTotal: 0, nextChangeAt: null });
  });
  it('최대 입력 곱셈은 Number 반올림 전에 거절하고 가격/활성 조건의 암묵 변환을 막는다', () => {
    expect(() => calculateGoodsVolumeDiscount([{ lineId: 'a', goodId: 'good-a', regularUnitPrice: 2147483647, unitPrice: 2147483647, qty: 2147483647 }], [], at)).toThrow('transaction_amount_overflow');
    for (const patch of [{ threshold: '3' }, { threshold: 1.5 }, { discountValue: 0 }, { startsAt: at }, { extra: true }]) {
      expect(parseGoodsVolumeDiscountTerms({ ...policy.terms, ...patch })).toBeNull();
    }
    expect(parseGoodsVolumeDiscountPolicy({ ...policy, goodId: '기존-text-상품' })?.goodId).toBe('기존-text-상품');
    expect(parseGoodsVolumeDiscountPolicy({ ...policy, status: 'draft', terms: null, draftValues: { threshold: '입력 중' } })?.terms).toBeNull();
    expect(parseGoodsVolumeDiscountPolicy({ ...policy, terms: null })).toBeNull();
    expect(parseGoodsVolumeDiscountPolicy({ ...policy, draftValues: { amount: '999' } })).toBeNull();
  });
});
