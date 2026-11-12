import { describe, expect, it } from 'vitest';
import { goodsSalePeriodOrderNotice, goodsSalePeriodState, goodsSaleUnavailableLabel, parseGoodsSalePeriod } from './goods-sale-period';
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

/* QA1 S-D2-11: 주문서가 판매기간 종료를 '재고 변경'으로만 알렸다. */
describe('goodsSalePeriodOrderNotice', () => {
  const now = Date.parse('2026-11-12T06:00:00Z');
  const period = (state: 'open' | 'ended' | 'scheduled' | 'unlimited', endsAt: string | null = null) =>
    ({ startsAt: endsAt ? '2026-11-01T00:00:00Z' : null, endsAt, state, calculatedAt: '2026-11-12T05:00:00Z', nextChangeAt: null });
  it('판매기간이 끝난 굿즈의 이름과 이유를 말한다 — 화면을 연 뒤 종료 시각이 지난 굿즈도', () => {
    const goods = [
      { name: '곧 종료 스티커', salePeriod: period('open', '2026-11-12T05:59:00Z') },
      { name: '머그', salePeriod: period('unlimited') },
      { name: '엽서', salePeriod: period('ended', '2026-11-11T00:00:00Z') },
    ];
    expect(goodsSalePeriodOrderNotice(goods, 'cart', now)).toBe('판매기간이 끝난 굿즈가 있어요: 곧 종료 스티커, 엽서. 장바구니에서 이 굿즈를 빼고 다시 주문해주세요.');
    expect(goodsSalePeriodOrderNotice([goods[0]], 'direct', now)).toBe('판매기간이 끝난 굿즈가 있어요: 곧 종료 스티커. 이 굿즈는 지금 주문할 수 없어요.');
  });
  it('판매 시작 전 굿즈도 알리고, 판매 중이면 없다', () => {
    expect(goodsSalePeriodOrderNotice([{ name: '예정 굿즈', salePeriod: period('scheduled', '2026-12-01T00:00:00Z') }], 'cart', now))
      .toContain('아직 판매를 시작하지 않은 굿즈가 있어요: 예정 굿즈.');
    expect(goodsSalePeriodOrderNotice([{ name: '머그', salePeriod: period('open', '2026-12-01T00:00:00Z') }, { name: '키링' }], 'cart', now)).toBeNull();
  });
});
