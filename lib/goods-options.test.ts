import { describe, expect, it } from 'vitest';
import { cartOptionGood, goodAtQuotedPrice, initialGoodOption, optionLabel, optionPriceRange } from './goods-options';
import type { Good, GoodOption } from './data';

const options: GoodOption[] = [
  { id:'00000000-0000-4000-8000-000000000001', name:'파랑', code:'BLUE', price:12000, stockQty:0, isDefault:true, attributes:{} },
  { id:'00000000-0000-4000-8000-000000000002', name:'빨강', code:'RED', price:15000, stockQty:3, isDefault:false, attributes:{} },
];
const good: Good={id:'g1',name:'키링',ip:'ip',type:'키링',price:12000,stockQty:3,stock:'ok',badge:null,img:'',options};

describe('public goods options',()=>{
  it('재고 초과 수량은 품절로 바꾸지 않아 남은 수량으로 줄일 수 있다', () => {
    const line = { goodId: good.id, variantId: options[1].id, qty: 4, regularPrice: 15000, effectivePrice: 15000,
      pricePeriodId: null, startsAt: null, endsAt: null, available: false, supply: {
        mode: 'stock' as const, state: 'stock' as const, availableQty: 2,
        policyRevision: null, policyId: null, startsAt: null, endsAt: null, expectedShipDate: null,
        calculatedAt: '2026-09-10T00:00:00Z', nextChangeAt: null,
      } };
    expect(goodAtQuotedPrice(cartOptionGood(good, options[1].id), line)).toMatchObject({ stock: 'ok', stockQty: 2 });
    expect(goodAtQuotedPrice(cartOptionGood(good, options[1].id), { ...line, supply: { ...line.supply, availableQty: 0 } })).toMatchObject({ stock: 'soldout', stockQty: 0 });
  });
  it('requires an explicit choice for multiple options and auto-selects only a single available option',()=>{
    expect(initialGoodOption(good)).toBeUndefined();
    expect(initialGoodOption({...good,options:[options[1]]})).toEqual(options[1]);
    expect(initialGoodOption({...good,options:[options[0]]})).toBeUndefined();
  });
  it('shows the price range including sold-out visible options',()=>{
    expect(optionPriceRange(options)).toEqual({price:12000,priceMax:15000});
    expect(optionPriceRange([options[1]])).toEqual({price:15000,priceMax:15000});
  });
  it('resolves a cart line with its option price and stock, never a different option',()=>{
    expect(cartOptionGood(good,options[1].id)).toMatchObject({price:15000,stockQty:3});
    expect(cartOptionGood(good,options[0].id)).toMatchObject({price:12000,stockQty:0,stock:'soldout'});
    expect(cartOptionGood(good,'missing')).toBeUndefined();
    expect(cartOptionGood(good,undefined as never)).toBeUndefined();
  });
  it('hides only the untouched sole default label',()=>{
    expect(optionLabel({...options[0],name:'기본 옵션'},1)).toBeNull();
    expect(optionLabel({...options[0],name:'기본 옵션'},2)).toBe('기본 옵션');
    expect(optionLabel(options[1],1)).toBe('빨강');
  });
  it('uses the selected option period price and its own regular price for comparison', () => {
    const priced = { ...good, compareAtPrice: 20000, options: [{ ...options[1], price: 12000, pricing: {
      regularPrice: 15000, effectivePrice: 12000, pricePeriodId: '00000000-0000-4000-8000-000000000003',
      startsAt: '2026-09-10T00:00:00Z', endsAt: '2026-09-11T00:00:00Z', calculatedAt: '2026-09-10T12:00:00Z',
    } }] };
    expect(cartOptionGood(priced, options[1].id)).toMatchObject({ price: 12000, compareAtPrice: 15000 });
  });
});
