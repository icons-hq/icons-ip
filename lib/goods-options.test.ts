import { describe, expect, it } from 'vitest';
import { cartOptionGood, collapseRandomGoodOptions, defaultGoodOption, goodOptionPurchaseNotices, purchasableOptionQty, goodAtQuotedPrice, goodCompareAtPrice, initialGoodOption, isRestockableGoodOption, isSelectableGoodOption, optionLabel, optionPriceRange, selectableGoodOptionId, soldOutPreviewPrice, variantSearchForSelection, variantSyncDefault } from './goods-options';
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
  /* PD-08 — 재고 0 옵션은 자동 선택하지 않으므로 품절 굿즈의 합계는 이 단가로 미리 보인다. */
  it('품절 굿즈의 합계 미리보기 단가는 첫 옵션 가격, 옵션이 없으면 굿즈 가격이다', () => {
    expect(soldOutPreviewPrice({ price: 12000, options: [options[1], options[0]] })).toBe(15000);
    expect(soldOutPreviewPrice({ price: 12000, options: [options[0]] })).toBe(12000);
    expect(soldOutPreviewPrice({ price: 9000 })).toBe(9000);
    /* 자동 선택 규칙은 그대로다 — 재고 0 단일 옵션을 고르지 않는다(L2 몫). */
    expect(initialGoodOption({ ...good, options: [options[0]] })).toBeUndefined();
  });
  /* LD-5 · 11 §6 B9 · R-04 §3.5 — 굿즈 상세 본품의 첫 선택은 정렬 순서상 첫 구매 가능 옵션이다.
     살 수 있는 옵션이 없으면 고를 수 있는 첫 옵션을 고른 채 연다(빈 옵션 없음 — 셀렉트·가격·합계가 같은 옵션). */
  it('상세의 첫 선택은 첫 구매 가능 옵션이고, 모든 옵션이 품절이면 고를 수 있는 첫 옵션이다', () => {
    expect(defaultGoodOption(good)).toEqual(options[1]);
    expect(defaultGoodOption({ options: [options[1], { ...options[0], id: 'third', stockQty: 5 }] })).toEqual(options[1]);
    expect(defaultGoodOption({ options: [options[0]] })).toEqual(options[0]);
    expect(defaultGoodOption({ options: [options[0], { ...options[1], stockQty: 0 }] })).toEqual(options[0]);
    /* 닫힌 예약판매 옵션은 고를 수 없어 건너뛰고, 고를 수 있는 옵션이 하나도 없으면 고르지 않는다. */
    const closedPreorder = { ...options[0], id: 'closed-preorder', supply: { mode: 'preorder' as const, state: 'closed' as const, availableQty: 0,
      policyId: '00000000-0000-4000-8000-000000000009', policyRevision: 1, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-21T00:00:00Z',
      expectedShipDate: '2026-11-20', calculatedAt: '2026-10-22T00:00:00Z', nextChangeAt: null } };
    expect(defaultGoodOption({ options: [closedPreorder, { ...options[1], stockQty: 0 }] })).toEqual({ ...options[1], stockQty: 0 });
    expect(defaultGoodOption({ options: [closedPreorder] })).toBeUndefined();
    expect(defaultGoodOption({ options: undefined })).toBeUndefined();
    /* 목록 카드 담기·추가 구성의 자동 선택은 그대로 하나뿐인 구매 가능 옵션만이다. */
    expect(initialGoodOption(good)).toBeUndefined();
    expect(initialGoodOption({ ...good, options: [options[0]] })).toBeUndefined();
  });
  /* PD-10 — 재고만 떨어진 옵션은 고를 수 있고(재입고 알림 대상), 닫힌 예약판매 옵션은 고르지 못한다. */
  it('재고만 떨어진 옵션은 재입고 알림 대상이라 고를 수 있고, 예약판매 옵션은 살 수 있을 때만 고른다', () => {
    const preorder = (state: 'open' | 'closed', availableQty: number) => ({ ...options[0], stockQty: availableQty, supply: {
      mode: 'preorder' as const, state, availableQty, policyId: '00000000-0000-4000-8000-000000000009', policyRevision: 1,
      startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-31T00:00:00Z', expectedShipDate: '2026-11-20',
      calculatedAt: '2026-10-22T00:00:00Z', nextChangeAt: null } });
    expect(isRestockableGoodOption(options[0])).toBe(true);
    expect(isSelectableGoodOption(options[0])).toBe(true);
    expect(isRestockableGoodOption(options[1])).toBe(false);
    expect(isSelectableGoodOption(options[1])).toBe(true);
    expect(isRestockableGoodOption(preorder('open', 0))).toBe(false);
    expect(isSelectableGoodOption(preorder('open', 0))).toBe(false);
    expect(isSelectableGoodOption(preorder('closed', 0))).toBe(false);
    expect(isSelectableGoodOption(preorder('open', 3))).toBe(true);
    /* 재고 판매 옵션의 품절은 공급 정보가 있어도 재입고 알림 대상이다. */
    expect(isRestockableGoodOption({ stockQty: 0, supply: { ...preorder('open', 0).supply, mode: 'stock', state: 'stock', policyId: null,
      policyRevision: null, startsAt: null, endsAt: null, expectedShipDate: null } })).toBe(true);
  });
  /* PD-14·PD-10 — 주소의 ?variant= 는 지금 고를 수 있는 이 굿즈의 옵션일 때만 첫 선택이 된다.
     품절 옵션을 가리키는 공유·재입고 알림 링크는 그 옵션을 고른 채(재입고 알림 CTA) 연다. */
  it('주소 옵션은 이 굿즈의 고를 수 있는 옵션일 때만 받고, 품절 옵션도 받는다', () => {
    expect(selectableGoodOptionId(good, options[1].id)).toBe(options[1].id);
    expect(selectableGoodOptionId(good, options[0].id)).toBe(options[0].id);
    expect(selectableGoodOptionId(good, 'other-good-option')).toBeUndefined();
    expect(selectableGoodOptionId(good, null)).toBeUndefined();
    expect(selectableGoodOptionId({ options: undefined }, options[1].id)).toBeUndefined();
    const closedPreorder = { ...options[0], id: 'closed-preorder', supply: { mode: 'preorder' as const, state: 'closed' as const, availableQty: 0,
      policyId: '00000000-0000-4000-8000-000000000009', policyRevision: 1, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-21T00:00:00Z',
      expectedShipDate: '2026-11-20', calculatedAt: '2026-10-22T00:00:00Z', nextChangeAt: null } };
    expect(selectableGoodOptionId({ options: [closedPreorder] }, 'closed-preorder')).toBeUndefined();
  });
  it('옵션을 바꾸면 다른 검색 조건은 두고 ?variant= 만 바꾼다', () => {
    expect(variantSearchForSelection('?reviewPage=2', 'red', undefined)).toBe('?reviewPage=2&variant=red');
    expect(variantSearchForSelection('?variant=blue&qnaPage=1', 'red', 'blue')).toBe('?variant=red&qnaPage=1');
    /* 사용자가 처음 선택으로 돌아와도 주소가 그 선택을 가리킨다. */
    expect(variantSearchForSelection('?variant=red', 'blue', 'blue')).toBe('?variant=blue');
  });
  /* 리뷰·Q&A 페이지 링크는 같은 상세 안 이동이라 선택은 남고 주소의 variant 만 빠진다. */
  it('주소에서 온 첫 선택은 기본 선택이 아니라서 주소에서 빠지면 다시 써 넣는다', () => {
    expect(variantSyncDefault('red', 'red')).toBeUndefined();
    expect(variantSearchForSelection('?reviewPage=2', 'red', variantSyncDefault('red', 'red'))).toBe('?reviewPage=2&variant=red');
    /* 자동 기본 선택(단일 옵션)은 그대로 쓰지 않는다. */
    expect(variantSyncDefault(null, 'only')).toBe('only');
    expect(variantSearchForSelection('?reviewPage=2', 'only', variantSyncDefault(null, 'only'))).toBeNull();
    /* 주소의 값이 고를 수 없어 기본 규칙으로 돌아간 경우(품절·오타)도 자동 선택이다. */
    expect(variantSyncDefault('sold-out', 'only')).toBe('only');
    expect(variantSyncDefault(null, undefined)).toBeUndefined();
  });
  it('첫 화면의 기본 선택과 이미 같은 주소는 건드리지 않는다', () => {
    expect(variantSearchForSelection('', 'only', 'only')).toBeNull();
    expect(variantSearchForSelection('?reviewPage=1', 'only', 'only')).toBeNull();
    expect(variantSearchForSelection('?variant=red', 'red', undefined)).toBeNull();
    expect(variantSearchForSelection('?variant=red', undefined, undefined)).toBeNull();
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

describe('랜덤 판매(D5②)·옵션별 구매 제한(D7②) 표시 규칙', () => {
  it('랜덤 판매 굿즈는 기본 옵션 키 하나로 접혀 자동 선택·빠른 담기 대상이 된다', () => {
    const collapsed = collapseRandomGoodOptions([{ ...options[1], isDefault: false }, { ...options[0], stockQty: 0 }]);
    expect(collapsed).toEqual([expect.objectContaining({ id: options[0].id, name: '랜덤', stockQty: 3, price: 12000, code: '' })]);
    const random: Good = { ...good, optionSaleMode: 'random', options: collapsed };
    expect(initialGoodOption(random)?.id).toBe(options[0].id);
    expect(defaultGoodOption(random)?.id).toBe(options[0].id);
    expect(optionLabel(random.options?.[0], 1)).toBe('랜덤');
    expect(collapseRandomGoodOptions([])).toEqual([]);
  });

  it('수량 최대는 재고와 옵션별 주문당 최대 수량 중 작은 값이다', () => {
    expect(purchasableOptionQty({ stockQty: 5, orderMaxQty: 2 })).toBe(2);
    expect(purchasableOptionQty({ stockQty: 1, orderMaxQty: 2 })).toBe(1);
    expect(purchasableOptionQty({ stockQty: 5, orderMaxQty: null })).toBe(5);
    expect(purchasableOptionQty({ stockQty: 5 })).toBe(5);
    expect(purchasableOptionQty({ stockQty: -1, orderMaxQty: 2 })).toBe(0);
  });

  it('상세 안내는 랜덤 안내와 고른 옵션의 옵션별 제한(확정 카피)이다', () => {
    const random: Good = { ...good, optionSaleMode: 'random', options: collapseRandomGoodOptions(options) };
    expect(goodOptionPurchaseNotices(random, random.options?.[0])).toEqual(['옵션은 주문 후 재고에서 무작위로 정해져 발송됩니다. 같은 옵션이 중복될 수 있습니다.']);
    const limited = { ...options[1], orderMaxQty: 2, memberMaxQty: 5 };
    expect(goodOptionPurchaseNotices({ ...good, options: [options[0], limited] }, limited)).toEqual([
      "'빨강'은 한 번에 2개까지 주문할 수 있습니다.", "'빨강'은 1인당 5개까지 구매할 수 있습니다.",
    ]);
    /* 하나뿐인 '기본 옵션'은 이름을 숨기므로 굿즈 이름으로 말한다. */
    const sole = { ...options[0], name: '기본 옵션', stockQty: 3, memberMaxQty: 1 };
    expect(goodOptionPurchaseNotices({ ...good, options: [sole] }, sole)).toEqual(["'키링'은 1인당 1개까지 구매할 수 있습니다."]);
    expect(goodOptionPurchaseNotices(good, undefined)).toEqual([]);
    expect(goodOptionPurchaseNotices(good, options[1])).toEqual([]);
  });
});
