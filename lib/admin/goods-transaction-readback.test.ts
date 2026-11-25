import { describe, expect, it } from 'vitest';
import { calculateGoodsQuantityDelivery } from '@/lib/goods-delivery-pricing';
import { goodsDeliveryReadback, goodsDeliveryReadbackRows, goodsDeliveryTermsFromFields, goodsPricePeriodReadback, goodsVolumeReadback } from './goods-transaction-readback';

const delivery = (fields: Partial<Record<string, string>>) => ({ kind: 'existing', baseFee: '', interval: '', firstLimit: '', secondLimit: '', extra1: '', extra2: '', paymentMode: 'prepaid', ...fields });
const volume = (fields: Partial<Record<string, string>>) => ({ condition: 'quantity', threshold: '', discountKind: 'fixed', discountValue: '', startsAt: '', endsAt: '', ...fields });

describe('수량별 배송비 되읽기', () => {
  it('수량마다 반복은 개수 구간마다 배송비가 늘어나는 모습을 보인다', () => {
    expect(goodsDeliveryReadback(delivery({ kind: 'repeat', baseFee: '3000', interval: '2' }))).toBe('1~2개 3,000원 · 3~4개 6,000원 · 5~6개 9,000원 · …');
    expect(goodsDeliveryReadback(delivery({ kind: 'repeat', baseFee: '2500', interval: '1' }))).toBe('1개 2,500원 · 2개 5,000원 · 3개 7,500원 · …');
  });

  it('2구간·3구간은 구간 끝 개수와 넘었을 때의 금액을 보인다', () => {
    expect(goodsDeliveryReadback(delivery({ kind: 'tier2', baseFee: '3000', firstLimit: '3', extra1: '1000' }))).toBe('1~3개 3,000원 · 4개부터 4,000원');
    expect(goodsDeliveryReadback(delivery({ kind: 'tier3', baseFee: '3000', firstLimit: '3', secondLimit: '5', extra1: '1000', extra2: '2500' })))
      .toBe('1~3개 3,000원 · 4~5개 4,000원 · 6개부터 5,500원');
  });

  it('금액은 고객 화면과 결제가 쓰는 계산과 같다', () => {
    const fields = delivery({ kind: 'tier3', baseFee: '3000', firstLimit: '3', secondLimit: '5', extra1: '1000', extra2: '2500' });
    const terms = goodsDeliveryTermsFromFields(fields)!;
    for (const row of goodsDeliveryReadbackRows(terms)) {
      expect(row.fee).toBe(calculateGoodsQuantityDelivery(row.from, terms));
      if (row.to !== null) expect(row.fee).toBe(calculateGoodsQuantityDelivery(row.to, terms));
    }
    const repeat = goodsDeliveryTermsFromFields(delivery({ kind: 'repeat', baseFee: '3000', interval: '4' }))!;
    for (const row of goodsDeliveryReadbackRows(repeat)) expect(calculateGoodsQuantityDelivery(row.to!, repeat)).toBe(row.fee);
  });

  it('상품의 배송비 그대로이거나 입력이 규칙에 맞지 않으면 말하지 않는다', () => {
    expect(goodsDeliveryReadback(delivery({}))).toBeNull();
    expect(goodsDeliveryReadback(delivery({ kind: 'repeat', baseFee: '3000' }))).toBeNull();
    expect(goodsDeliveryReadback(delivery({ kind: 'repeat', baseFee: '3000', interval: '0' }))).toBeNull();
    /* 3구간의 두 번째 한도는 첫 번째보다 커야 하고 추가금은 줄어들 수 없다(저장 규칙과 같다). */
    expect(goodsDeliveryReadback(delivery({ kind: 'tier3', baseFee: '3000', firstLimit: '5', secondLimit: '5', extra1: '1000', extra2: '2000' }))).toBeNull();
    expect(goodsDeliveryReadback(delivery({ kind: 'tier3', baseFee: '3000', firstLimit: '3', secondLimit: '5', extra1: '2000', extra2: '1000' }))).toBeNull();
    expect(goodsDeliveryReadback(delivery({ kind: 'tier2', baseFee: '3,000', firstLimit: '3', extra1: '1000' }))).toBeNull();
  });
});

describe('복수구매 할인 되읽기', () => {
  it('수량 조건과 정액·비율 할인을 한 줄로 말한다', () => {
    expect(goodsVolumeReadback(volume({ threshold: '3', discountValue: '500' }))).toBe('같은 상품을 3개 이상 사면 개당 500원씩 깎아 줍니다. 기간 제한 없이 항상 적용됩니다.');
    expect(goodsVolumeReadback(volume({ condition: 'regular_subtotal', threshold: '50000', discountKind: 'percent', discountValue: '10' })))
      .toBe('같은 상품의 정상가 합계가 50,000원 이상이면 개당 10%씩 깎아 줍니다. 기간 제한 없이 항상 적용됩니다.');
  });

  it('기간은 시작·종료를 모두 넣었을 때만 날짜로 말하고, 하나만 넣으면 함께 넣으라고 알린다', () => {
    expect(goodsVolumeReadback(volume({ threshold: '2', discountValue: '100', startsAt: '2026-12-01T10:00', endsAt: '2026-12-31T23:59' })))
      .toBe('같은 상품을 2개 이상 사면 개당 100원씩 깎아 줍니다. 2026-12-01 10:00부터 2026-12-31 23:59까지(KST) 적용됩니다.');
    expect(goodsVolumeReadback(volume({ threshold: '2', discountValue: '100', startsAt: '2026-12-01T10:00' }))).toContain('시작과 종료를 함께');
  });

  it('조건·할인값이 규칙에 맞지 않으면 말하지 않는다', () => {
    expect(goodsVolumeReadback(volume({}))).toBeNull();
    expect(goodsVolumeReadback(volume({ threshold: '1', discountValue: '500' }))).toBeNull();
    expect(goodsVolumeReadback(volume({ threshold: '3', discountKind: 'percent', discountValue: '101' }))).toBeNull();
  });
});

describe('기간 할인 되읽기', () => {
  const input = { optionName: '기본 옵션', price: 22000, discountPrice: '18000', startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' };

  it('할인가·기간·끝난 뒤 가격을 한 줄로 말한다', () => {
    expect(goodsPricePeriodReadback(input)).toBe('기본 옵션: 2026-12-01 10:00부터 2026-12-07 23:59까지(KST) 18,000원에 팝니다. 판매가 22,000원보다 4,000원 낮고, 끝나면 22,000원으로 돌아갑니다.');
  });

  it('할인가가 판매가 이상이거나 기간이 맞지 않으면 말하지 않는다', () => {
    expect(goodsPricePeriodReadback({ ...input, discountPrice: '22000' })).toBeNull();
    expect(goodsPricePeriodReadback({ ...input, discountPrice: '0' })).toBeNull();
    expect(goodsPricePeriodReadback({ ...input, discountPrice: '' })).toBeNull();
    expect(goodsPricePeriodReadback({ ...input, startsAt: '' })).toBeNull();
    expect(goodsPricePeriodReadback({ ...input, startsAt: '2026-12-08T00:00' })).toBeNull();
  });
});
