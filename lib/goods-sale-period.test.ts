import { describe, expect, it } from 'vitest';
import { goodsSalePeriodState, goodsSaleUnavailableLabel, parseGoodsSalePeriod } from './goods-sale-period';
import { goodsPurchaseConditionProblem } from './goods-options';
import { parseGoodsVariantSupply } from './goods-preorders';

const startsAt = '2026-10-13T00:00:00Z'; const endsAt = '2026-10-14T00:00:00Z';
describe('일반 상품의 판매기간', () => {
  it('시작은 포함하고 종료는 제외하며 제한 없음과 구분한다', () => {
    expect(goodsSalePeriodState(null, null, 0)).toBe('unlimited');
    expect(goodsSalePeriodState(startsAt, endsAt, Date.parse(startsAt) - 1)).toBe('scheduled');
    expect(goodsSalePeriodState(startsAt, endsAt, Date.parse(startsAt))).toBe('open');
    expect(goodsSalePeriodState(startsAt, endsAt, Date.parse(endsAt))).toBe('ended');
  });
  it('서버 계산 시각과 경계가 불일치하는 응답을 버린다', () => {
    const row = { startsAt, endsAt, state: 'open', calculatedAt: startsAt, nextChangeAt: endsAt };
    expect(parseGoodsSalePeriod(row)).toEqual(row);
    expect(parseGoodsSalePeriod({ ...row, state: 'ended' })).toBeNull();
    expect(parseGoodsSalePeriod({ ...row, nextChangeAt: null })).toBeNull();
    expect(parseGoodsSalePeriod({ ...row, startsAt: null })).toBeNull();
    expect(parseGoodsSalePeriod({})).toBeNull();
  });
  it('상품 구매 조건과 일반재고의 다음 경계에 판매기간을 전달한다', () => {
    const salePeriod = parseGoodsSalePeriod({ startsAt, endsAt, state: 'scheduled', calculatedAt: '2026-10-12T00:00:00Z', nextChangeAt: startsAt })!;
    expect(goodsSaleUnavailableLabel(salePeriod)).toBe('판매 시작 전');
    expect(goodsPurchaseConditionProblem({ salePeriod })).toBe('판매 시작 전 굿즈입니다.');
    expect(parseGoodsVariantSupply({ mode: 'stock', availableQty: 0, policyId: null, policyRevision: null,
      state: 'stock', startsAt: null, endsAt: null, expectedShipDate: null, calculatedAt: salePeriod.calculatedAt, nextChangeAt: startsAt })).not.toBeNull();
  });
});
