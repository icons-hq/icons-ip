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
    expect(planErpSalePrice({ salePrice: 12000, mode: 'single', price: draft({ regularPrice: '' }) }))
      .toEqual({ ok: true, target: 'regularPrice', value: 12000, attention: false, message: '판매가에 ERP 판매가 12,000원을 넣었습니다.' });
    expect(planErpSalePrice({ salePrice: 12000, mode: 'single', price: draft({ discountEnabled: true, discountValue: '1000' }) }))
      .toMatchObject({ ok: true, target: 'regularPrice', value: 12000, attention: false, message: expect.stringContaining('할인가는 11,000원') });
  });

  /* 2026-10-07 리뷰: % 할인은 새 판매가로 다시 계산되므로 이전 할인 금액을 그대로 빼면 안내가 틀린다. */
  it('% 할인은 새 판매가로 다시 계산한 할인가를 알린다', () => {
    const plan = planErpSalePrice({ salePrice: 20000, mode: 'single', price: draft({ discountEnabled: true, discountValue: '10', discountUnit: 'percent' }) });
    expect(plan).toMatchObject({ ok: true, value: 20000, attention: false });
    if (!plan.ok) throw new Error();
    expect(plan.message).toContain('10%(2,000원)');
    expect(plan.message).toContain('할인가는 18,000원');
    expect(plan.message).not.toContain('19,000원');
  });

  it('새 판매가에 맞지 않는 할인과 남아 있는 기본 옵션 옵션가는 확인이 필요하다고 알린다', () => {
    const tooLarge = planErpSalePrice({ salePrice: 12000, mode: 'single', price: draft({ regularPrice: '20000', discountEnabled: true, discountValue: '15000' }) });
    expect(tooLarge).toMatchObject({ ok: true, value: 12000, attention: true, message: expect.stringContaining('할인 칸을 확인해주세요') });
    const extra = planErpSalePrice({ salePrice: 20000, mode: 'single', extraPrice: 1500, price: draft({ discountEnabled: true, discountValue: '10', discountUnit: 'percent' }) });
    expect(extra).toMatchObject({ ok: true, value: 20000, attention: true });
    if (!extra.ok) throw new Error();
    expect(extra.message).toContain('기본 옵션 옵션가 1,500원');
    expect(extra.message).toContain('19,500원');
  });

  it('옵션 사용 중이면 옵션가 = ERP 판매가 − 판매가(할인 전)이고 음수는 적용하지 않는다', () => {
    expect(planErpSalePrice({ salePrice: 13000, mode: 'multiple', price: draft() }))
      .toEqual({ ok: true, target: 'extraPrice', value: 3000, attention: false, message: '옵션가를 3,000원으로 맞춰 판매 13,000원이 되었습니다.' });
    expect(planErpSalePrice({ salePrice: 13000, mode: 'multiple', price: draft({ discountEnabled: true, discountValue: '10', discountUnit: 'percent' }) }))
      .toMatchObject({ ok: true, target: 'extraPrice', value: 3000 });
    expect(planErpSalePrice({ salePrice: 10000, mode: 'multiple', price: draft() })).toMatchObject({ ok: true, value: 0 });
    expect(planErpSalePrice({ salePrice: 9000, mode: 'multiple', price: draft() })).toMatchObject({ ok: false, error: expect.stringContaining('낮아') });
    /* 할인가(9,000원)보다는 높아도 판매가(할인 전)보다 낮으면 옵션가가 음수가 되어 적용하지 않는다. */
    expect(planErpSalePrice({ salePrice: 9500, mode: 'multiple', price: draft({ discountEnabled: true, discountValue: '1000' }) }))
      .toEqual({ ok: false, error: expect.stringContaining('판매가(할인 전) 10,000원보다 낮아') });
    expect(planErpSalePrice({ salePrice: 9000, mode: 'multiple', price: draft({ regularPrice: '1.5' }) })).toMatchObject({ ok: false });
    expect(planErpSalePrice({ salePrice: 9000, mode: 'multiple', price: draft({ discountEnabled: true, discountValue: '0' }) })).toMatchObject({ ok: false });
    expect(planErpSalePrice({ salePrice: -1, mode: 'single', price: draft() })).toMatchObject({ ok: false });
  });

  /* 2026-10-07 QA: 할인 중 옵션가를 할인가 기준으로 맞춰 그 옵션만 할인이 상쇄됐다(빨강 12,000원 · 파랑 10,800원). 옵션 미사용과 같은 의미로 맞춘다. */
  it('옵션 사용 중에도 ERP 판매가는 그 옵션의 할인 전 금액이고, 상품 할인은 그대로 적용해 할인 전·후 금액을 알린다', () => {
    const percent = draft({ regularPrice: '12000', discountEnabled: true, discountValue: '10', discountUnit: 'percent' });
    const same = planErpSalePrice({ salePrice: 12000, mode: 'multiple', price: percent });
    expect(same).toMatchObject({ ok: true, target: 'extraPrice', value: 0, attention: false });
    if (!same.ok) throw new Error();
    expect(same.message).toBe('옵션가를 0원으로 맞춰 할인 전 판매 12,000원(ERP 판매가)이 되었습니다. 상품 할인 10%(1,200원)이 그대로 적용되어 할인가는 10,800원입니다.');
    const higher = planErpSalePrice({ salePrice: 15000, mode: 'multiple', price: percent });
    expect(higher).toMatchObject({ ok: true, value: 3000 });
    if (!higher.ok) throw new Error();
    expect(higher.message).toContain('할인 전 판매 15,000원');
    expect(higher.message).toContain('할인가는 13,800원');
    const won = planErpSalePrice({ salePrice: 13000, mode: 'multiple', price: draft({ discountEnabled: true, discountValue: '2000' }) });
    expect(won).toMatchObject({ ok: true, value: 3000 });
    if (!won.ok) throw new Error();
    expect(won.message).toContain('상품 할인 2,000원이 그대로 적용되어 할인가는 11,000원입니다.');
    /* 옵션 미사용의 ERP 판매가도 할인 전 판매가다 — 두 모드의 결과 금액이 같다. */
    const single = planErpSalePrice({ salePrice: 12000, mode: 'single', price: percent });
    expect(single.ok && single.message).toContain('할인가는 10,800원');
  });

  /* 2026-10-07 리뷰: 판매가가 비어 있으면 ERP 판매가 전액이 옵션가가 되어, 나중에 판매가를 넣으면 이중으로 더해진다. */
  it('옵션 사용 중 판매가가 비었거나 0원이면 옵션가로 적용하지 않고 판매가를 먼저 입력하게 한다', () => {
    for (const regularPrice of ['', '0']) {
      expect(planErpSalePrice({ salePrice: 15000, mode: 'multiple', price: draft({ regularPrice }) }))
        .toEqual({ ok: false, error: expect.stringContaining('판매가를 먼저 입력해주세요') });
    }
  });
});
