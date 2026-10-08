import { describe, expect, it } from 'vitest';
import { cartOptionGood, goodAtQuotedPrice, goodCompareAtPrice, initialGoodOption, optionLabel, optionPriceRange } from './goods-options';
import type { GoodsSalesQuoteLine } from './goods-sales';
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

/* 판매가(소비자가) 12,000원에서 10% 할인한 할인가 10,800원이 기준 판매가다. 옵션가는 할인가에
   더하고 할인하지 않으므로, 옵션 정가는 소비자가 + 옵션가이고 할인 금액 1,200원은 옵션과 무관하다. */
describe('옵션 정가 — 소비자가 + 옵션 추가금액', () => {
  const ids = { base: '00000000-0000-4000-8000-000000000011', small: '00000000-0000-4000-8000-000000000012', large: '00000000-0000-4000-8000-000000000013' };
  const option = (id: string, price: number): GoodOption => ({ id, name: id, code: id, price, stockQty: 5, isDefault: id === ids.base, attributes: {} });
  const discounted: Good = { ...good, price: 10800, priceMax: 13800, catalogPrice: 10800, catalogCompareAtPrice: 12000, compareAtPrice: 12000,
    options: [option(ids.base, 10800), option(ids.small, 11300), option(ids.large, 13800)] };
  const period = { pricePeriodId: '00000000-0000-4000-8000-000000000014', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-31T00:00:00Z' };
  const quote = (variantId: string, regularPrice: number, effectivePrice = regularPrice, pricing = { pricePeriodId: null, startsAt: null, endsAt: null } as Pick<GoodsSalesQuoteLine, 'pricePeriodId' | 'startsAt' | 'endsAt'>): GoodsSalesQuoteLine => ({
    goodId: discounted.id, variantId, qty: 1, available: true, regularPrice, effectivePrice, ...pricing });

  it.each([
    ['옵션가 0원', ids.base, 10800, 12000],
    ['할인 금액보다 작은 옵션가 500원', ids.small, 11300, 12500],
    ['할인 금액보다 큰 옵션가 3,000원', ids.large, 13800, 15000],
  ])('%s 옵션은 결제가에 할인 금액 1,200원을 더한 정가와 비교한다', (_, variantId, price, compareAtPrice) => {
    expect(cartOptionGood(discounted, variantId)).toMatchObject({ price, compareAtPrice, catalogPrice: 10800, catalogCompareAtPrice: 12000 });
    expect(goodAtQuotedPrice(cartOptionGood(discounted, variantId), quote(variantId, price))).toMatchObject({ price, compareAtPrice });
  });

  it('기간 할인 중인 옵션은 소비자가 대신 그 옵션의 정상가와 비교한다', () => {
    const regular = { regularPrice: 13800, effectivePrice: 12000, calculatedAt: '2026-10-08T00:00:00Z', ...period };
    const scheduled = { ...discounted, options: discounted.options!.map(item => item.id === ids.large ? { ...item, price: 12000, pricing: regular } : item) };
    expect(cartOptionGood(scheduled, ids.large)).toMatchObject({ price: 12000, compareAtPrice: 13800 });
    expect(goodAtQuotedPrice(cartOptionGood(scheduled, ids.large), quote(ids.large, 13800, 12000, period))).toMatchObject({ price: 12000, compareAtPrice: 13800 });
    /* 카탈로그를 읽은 뒤 기간이 끝나 서버 견적에서 빠지면 상품 할인 기준으로 돌아온다. */
    expect(goodAtQuotedPrice(cartOptionGood(scheduled, ids.large), quote(ids.large, 13800))).toMatchObject({ price: 13800, compareAtPrice: 15000 });
  });

  it('소비자가가 없으면 기간 할인 옵션만 비교 정가를 갖는다', () => {
    const plain = { ...discounted, catalogCompareAtPrice: null, compareAtPrice: null };
    expect(cartOptionGood(plain, ids.large)?.compareAtPrice).toBeNull();
    expect(goodAtQuotedPrice(cartOptionGood(plain, ids.large), quote(ids.large, 13800))?.compareAtPrice).toBeNull();
    expect(goodAtQuotedPrice(cartOptionGood(plain, ids.large), quote(ids.large, 13800, 12000, period))?.compareAtPrice).toBe(13800);
  });

  it('옵션을 고르기 전에는 최저 판매가 옵션의 정가를 쓴다', () => {
    const catalog = { price: 10800, compareAtPrice: 12000 };
    expect(goodCompareAtPrice(catalog, discounted.options)).toBe(12000);
    /* 기본 옵션에도 옵션가가 붙어 모든 옵션이 기준 판매가보다 비싸도 할인을 잃지 않는다. */
    expect(goodCompareAtPrice(catalog, discounted.options!.slice(1))).toBe(12500);
    expect(goodCompareAtPrice(catalog, [option(ids.large, 13800)])).toBe(15000);
    expect(goodCompareAtPrice(catalog, [option(ids.large, 13800), { ...option(ids.small, 11000), pricing: {
      regularPrice: 11300, effectivePrice: 11000, calculatedAt: '2026-10-08T00:00:00Z', ...period } }])).toBe(11300);
    expect(goodCompareAtPrice(catalog, undefined)).toBe(12000);
    expect(goodCompareAtPrice({ price: 10800, compareAtPrice: null }, discounted.options)).toBeNull();
  });

  it('저장값이 없는 굿즈는 표시 가격을 기준 판매가와 소비자가로 본다', () => {
    const legacy = { ...good, compareAtPrice: 20000 };
    expect(cartOptionGood(legacy, options[1].id)).toMatchObject({ price: 15000, compareAtPrice: 23000, catalogPrice: 12000, catalogCompareAtPrice: 20000 });
  });
});
