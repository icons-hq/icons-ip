import { describe, expect, it } from 'vitest';
import oracle from '../test/fixtures/goods-transaction-independent-math.json';
import { allocateGoodsDeliveryFees, calculateGoodsQuantityDelivery, parseGoodsDeliveryQuantityTerms, type GoodsDeliveryAllocationGood } from './goods-delivery-pricing';
import { allocateTransactionAmount } from './goods-transaction-values';

describe('수량 배송비와 선착불 정수 배분', () => {
  it.each(oracle.repeated)('N 반복 Q=$quantity N=$interval', vector => {
    expect(calculateGoodsQuantityDelivery(vector.quantity, { kind: 'repeat', interval: vector.interval, baseFee: vector.baseFee })).toBe(vector.expected);
  });
  it.each(oracle.tiers)('비누적 3구간 Q=$quantity', vector => {
    expect(calculateGoodsQuantityDelivery(vector.quantity, { kind: 'tier3', baseFee: vector.baseFee, firstLimit: vector.firstLimit,
      secondLimit: vector.secondLimit, extra1: vector.extra1, extra2: vector.extra2 })).toBe(vector.expected);
  });
  it.each(oracle.allocations)('Python Fraction 최대나머지 total=$total', vector => {
    expect(allocateTransactionAmount(vector.total, vector.rows)).toEqual(vector.expected);
    expect(allocateTransactionAmount(vector.total, [...vector.rows].reverse())).toEqual(vector.expected);
    expect(allocateTransactionAmount(vector.total, vector.rows.map(row => ({ ...row, weight: row.weight * 7 })))).toEqual(vector.expected);
  });
  const goods: GoodsDeliveryAllocationGood[] = [
    { goodId: 'a', qty: 3, subtotal: 24000, policyEligible: false, individualFee: 6000, regionalEligible: true, paymentMode: 'prepaid' },
    { goodId: 'b', qty: 1, subtotal: 5000, policyEligible: false, individualFee: 2000, regionalEligible: true, paymentMode: 'collect' },
  ];
  it('같은 출고지의 공동 지역비를 배분한 뒤 결제시점만 나눈다', () => {
    expect(allocateGoodsDeliveryFees(goods, 0, { unit: 'per_shipment', fee: 1000 })).toMatchObject({ prepaidFee: 6750, collectFee: 2250, fullFee: 9000,
      goods: [{ goodId: 'a', baseFee: 6000, regionalFee: 750 }, { goodId: 'b', baseFee: 2000, regionalFee: 250 }] });
    expect(allocateGoodsDeliveryFees(goods.map(good => ({ ...good, paymentMode: 'prepaid' })), 0, { unit: 'per_shipment', fee: 1000 }))
      .toMatchObject({ prepaidFee: 9000, collectFee: 0, fullFee: 9000 });
    expect(allocateGoodsDeliveryFees(goods, 0, { unit: 'per_good', fee: 1000 })).toMatchObject({ prepaidFee: 7000, collectFee: 3000, fullFee: 10000 });
  });
  it('정책 기본료는 소계→수량, 지역비는 기본료→소계→수량으로 명시 전환한다', () => {
    const zero = goods.map(good => ({ ...good, subtotal: 0, policyEligible: true, individualFee: 0 }));
    expect(allocateGoodsDeliveryFees(zero, 1001, { unit: 'per_shipment', fee: 1000 }).goods).toMatchObject([
      { goodId: 'a', baseFee: 751, regionalFee: 750 }, { goodId: 'b', baseFee: 250, regionalFee: 250 },
    ]);
    expect(allocateGoodsDeliveryFees(zero, 0, { unit: 'per_shipment', fee: 1000 }).goods).toMatchObject([{ regionalFee: 750 }, { regionalFee: 250 }]);
    expect(allocateGoodsDeliveryFees(goods.map(good => ({ ...good, individualFee: 0 })), 0, { unit: 'per_shipment', fee: 1000 }).goods)
      .toMatchObject([{ regionalFee: 828 }, { regionalFee: 172 }]);
    expect(allocateTransactionAmount(1, [{ id: 'b', weight: 1 }, { id: 'a', weight: 1 }])).toEqual({ a: 1, b: 0 });
    expect(() => allocateTransactionAmount(1, [{ id: 'a', weight: 0 }])).toThrow('zero_weight');
  });
  it('구간 역전/누적료 오해/문자 숫자/상한을 거절한다', () => {
    const terms = { kind: 'tier3', baseFee: 3000, firstLimit: 2, secondLimit: 5, extra1: 1000, extra2: 2500 } as const;
    for (const patch of [{ firstLimit: 0 }, { secondLimit: 2 }, { extra2: 500 }, { baseFee: '3000' }, { baseFee: 1000001 }]) {
      expect(parseGoodsDeliveryQuantityTerms({ ...terms, ...patch })).toBeNull();
    }
    expect(calculateGoodsQuantityDelivery(6, terms)).toBe(5500);
    expect(() => calculateGoodsQuantityDelivery(Number.MAX_SAFE_INTEGER, { kind: 'repeat', interval: 1, baseFee: 1000000 })).toThrow('overflow');
  });
});
