import { describe, expect, it } from 'vitest';
import { goodsPriceDraftFromValues, planErpSalePrice, resolveGoodsPrice, type GoodsPriceDraft } from './goods-price-editor';

const draft = (changes: Partial<GoodsPriceDraft> = {}): GoodsPriceDraft => ({
  regularPrice: '10000', discountEnabled: false, discountValue: '', discountUnit: 'won', ...changes,
});

describe('판매가·할인 입력 변환', () => {
  it('할인 설정안함은 판매가를 price로, compareAtPrice는 빈 값으로 저장한다', () => {
    expect(resolveGoodsPrice(draft())).toMatchObject({ price: '10000', compareAtPrice: '', salePrice: 10000, discountAmount: 0 });
    expect(resolveGoodsPrice(draft({ discountValue: '3000' }))).toMatchObject({ price: '10000', compareAtPrice: '' });
    expect(resolveGoodsPrice(draft({ regularPrice: '' }))).toMatchObject({ price: '', compareAtPrice: '', salePrice: 0 });
  });

  it('할인 설정함은 판매가를 compareAtPrice로, 할인가를 price로 저장한다', () => {
    expect(resolveGoodsPrice(draft({ discountEnabled: true, discountValue: '3000' })))
      .toEqual({ price: '7000', compareAtPrice: '10000', regularPrice: 10000, discountAmount: 3000, salePrice: 7000 });
  });

  it('% 할인은 원 단위로 내리고 소수 둘째 자리까지 받는다', () => {
    expect(resolveGoodsPrice(draft({ regularPrice: '9900', discountEnabled: true, discountValue: '15', discountUnit: 'percent' })))
      .toMatchObject({ price: '8415', compareAtPrice: '9900', discountAmount: 1485 });
    expect(resolveGoodsPrice(draft({ regularPrice: '9999', discountEnabled: true, discountValue: '33.33', discountUnit: 'percent' })))
      .toMatchObject({ discountAmount: 3332, price: '6667' });
    expect(resolveGoodsPrice(draft({ regularPrice: '1000', discountEnabled: true, discountValue: '0.29', discountUnit: 'percent' })))
      .toMatchObject({ discountAmount: 2, price: '998' });
  });

  it('0 이하·판매가 이상의 할인은 오류로 막고 저장 값에 할인을 싣지 않는다', () => {
    for (const changes of [
      { discountValue: '0' }, { discountValue: '' }, { discountValue: '10000' }, { discountValue: '12000' }, { discountValue: '-1' },
      { discountValue: '1.5' }, { discountUnit: 'percent' as const, discountValue: '100' }, { discountUnit: 'percent' as const, discountValue: '0' },
      { discountUnit: 'percent' as const, discountValue: '12.345' },
    ]) {
      const result = resolveGoodsPrice(draft({ discountEnabled: true, ...changes }));
      expect(result.discountError, JSON.stringify(changes)).toBeTruthy();
      expect(result).toMatchObject({ price: '10000', compareAtPrice: '', discountAmount: 0 });
    }
    expect(resolveGoodsPrice(draft({ regularPrice: '50', discountEnabled: true, discountValue: '1', discountUnit: 'percent' })).discountError)
      .toContain('1원보다 작습니다');
    expect(resolveGoodsPrice(draft({ regularPrice: '', discountEnabled: true, discountValue: '100' })).discountError).toContain('판매가를 먼저');
  });

  it('잘못된 판매가는 원문을 price로 넘기고 오류를 표시한다', () => {
    expect(resolveGoodsPrice(draft({ regularPrice: '1.5' }))).toMatchObject({ price: '1.5', regularPrice: null, salePrice: null, regularPriceError: expect.any(String) });
    expect(resolveGoodsPrice(draft({ regularPrice: '2147483648' })).regularPriceError).toBeTruthy();
  });

  it('기존 상품은 compareAtPrice > price일 때 할인 설정함(차액 원)으로 연다', () => {
    expect(goodsPriceDraftFromValues({ price: '22000', compareAtPrice: '26000' }))
      .toEqual({ regularPrice: '26000', discountEnabled: true, discountValue: '4000', discountUnit: 'won' });
    expect(goodsPriceDraftFromValues({ price: '22000', compareAtPrice: '' }))
      .toEqual({ regularPrice: '22000', discountEnabled: false, discountValue: '', discountUnit: 'won' });
    expect(goodsPriceDraftFromValues({ price: '22000', compareAtPrice: '22000' })).toMatchObject({ regularPrice: '22000', discountEnabled: false });
    expect(goodsPriceDraftFromValues({ price: '0', compareAtPrice: '' })).toMatchObject({ regularPrice: '' });
  });

  it('실패·브라우저 복구의 화면 입력을 저장 값보다 먼저 되살린다', () => {
    const recovered = { price: '10000', compareAtPrice: '', regularPrice: '10000', discountEnabled: 'true', discountValue: '15', discountUnit: 'percent' };
    expect(goodsPriceDraftFromValues(recovered)).toEqual({ regularPrice: '10000', discountEnabled: true, discountValue: '15', discountUnit: 'percent' });
    const opened = goodsPriceDraftFromValues({ price: '7000', compareAtPrice: '10000' });
    expect(resolveGoodsPrice(opened)).toMatchObject({ price: '7000', compareAtPrice: '10000' });
  });
});

describe('ERP 판매가 적용 계산', () => {
  it('옵션 미사용이면 판매가 칸에 넣고, 할인이 있으면 결과 할인가를 알린다', () => {
    expect(planErpSalePrice({ salePrice: 12000, mode: 'single', basePrice: 0 })).toMatchObject({ ok: true, target: 'regularPrice', value: 12000 });
    expect(planErpSalePrice({ salePrice: 12000, mode: 'single', basePrice: 9000, discountAmount: 1000 }))
      .toMatchObject({ ok: true, target: 'regularPrice', value: 12000, message: expect.stringContaining('할인가는 11,000원') });
  });

  it('옵션 사용 중이면 옵션가 = ERP 판매가 − 현재 판매 금액이고 음수는 적용하지 않는다', () => {
    expect(planErpSalePrice({ salePrice: 13000, mode: 'multiple', basePrice: 10000 })).toMatchObject({ ok: true, target: 'extraPrice', value: 3000 });
    expect(planErpSalePrice({ salePrice: 10000, mode: 'multiple', basePrice: 10000 })).toMatchObject({ ok: true, value: 0 });
    expect(planErpSalePrice({ salePrice: 9000, mode: 'multiple', basePrice: 10000 })).toMatchObject({ ok: false, error: expect.stringContaining('낮아') });
    expect(planErpSalePrice({ salePrice: 9000, mode: 'multiple', basePrice: null })).toMatchObject({ ok: false });
    expect(planErpSalePrice({ salePrice: -1, mode: 'single', basePrice: 0 })).toMatchObject({ ok: false });
  });
});
