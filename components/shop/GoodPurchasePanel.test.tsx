import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Good } from '@/lib/data';
import { activeGalleryIndex } from './PdpGallery';
import {
  CART_ADDED_STATUS,
  GoodPurchasePanel,
  GoodRailBuyBox,
  addToCartResultStep,
  addedCartItems,
  buyNowNavigation,
  foldedPurchaseInputsNote,
  isGoodSoldOut,
  mergedCartQuantity,
  purchaseBlockReason,
  purchaseCtaState,
  purchaseSubtotal,
  purchaseTotalDisplay,
  type AdditionalPurchaseChoice,
  type GoodPurchaseController,
} from './GoodPurchasePanel';

vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({ error: null, getQuantity: () => 0, pending: false, ready: true, setQuantity: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/g13',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/shop/RestockCta', () => ({
  RestockCta: ({ initialRequested, optionName, variantId }: { initialRequested: boolean; optionName?: string | null; variantId?: string | null }) => (
    <button className="wc-restock-cta" data-option={optionName ?? ''} data-variant={variantId ?? ''} type="button">
      {initialRequested ? '재입고 알림 신청됨' : '재입고 알림 받기'}
    </button>
  ),
}));

const good: Good = {
  id: 'g13',
  name: '아크릴 블록',
  ip: 'hong-sil-quest',
  type: '아크릴',
  price: 12000,
  badge: 'NEW',
  stock: 'ok',
  stockQty: 8,
  img: 'url("https://cdn.example/g13.webp") center / cover no-repeat',
};

function controller(overrides: Partial<GoodPurchaseController> = {}): GoodPurchaseController {
  return {
    good,
    selectedOption: undefined,
    selectOption: vi.fn(),
    selectionRequired: false,
    quantity: 1,
    setQuantity: vi.fn(),
    subtotal: good.price,
    soldOut: false,
    restockRequested: false,
    disabled: false,
    inert: false,
    message: null,
    addToCart: vi.fn(),
    buyNow: vi.fn(),
    ...overrides,
  };
}

describe('purchaseSubtotal', () => {
  it('수량만큼 곱한 금액을 낸다', () => {
    expect(purchaseSubtotal(12000, 3)).toBe(36000);
    expect(purchaseSubtotal(12000, 1)).toBe(12000);
  });

  /* 합계가 음수·NaN 으로 새면 "₩NaN" 이 그대로 화면에 남는다. */
  it('망가진 입력은 0으로 떨어뜨린다', () => {
    expect(purchaseSubtotal(Number.NaN, 2)).toBe(0);
    expect(purchaseSubtotal(12000, Number.NaN)).toBe(0);
    expect(purchaseSubtotal(-100, 2)).toBe(0);
    expect(purchaseSubtotal(12000, -3)).toBe(0);
  });
});

describe('mergedCartQuantity', () => {
  /* 상세에서 2개를 담고 다시 3개를 담으면 5개다 — 덮어쓰면 앞의 담기가 사라진다. */
  it('이미 담긴 수량에 더한다', () => {
    expect(mergedCartQuantity(2, 3)).toBe(5);
    expect(mergedCartQuantity(0, 1)).toBe(1);
  });

  /* 재고 상한은 카트와 DB 가 판정한다. 여기서 조용히 자르면 왜 덜 담겼는지 아무도 말하지 않는다. */
  it('재고로 자르지 않는다', () => {
    expect(mergedCartQuantity(8, 5)).toBe(13);
  });

  it('최소 한 개는 담는다', () => {
    expect(mergedCartQuantity(1, 0)).toBe(2);
    expect(mergedCartQuantity(0, -4)).toBe(1);
  });
});

describe('purchaseBlockReason', () => {
  const base = {
    disabled: false,
    soldOut: false,
    ready: true,
    pending: false,
    nextQuantity: 1,
    stockQty: 8,
  };

  it('막을 이유가 없으면 null 이다', () => {
    expect(purchaseBlockReason(base)).toBeNull();
  });

  it('미리보기·품절·준비중·저장중·재고 순으로 이유를 정한다', () => {
    expect(purchaseBlockReason({ ...base, disabled: true, soldOut: true })).toBe('disabled');
    expect(purchaseBlockReason({ ...base, soldOut: true, ready: false })).toBe('soldout');
    expect(purchaseBlockReason({ ...base, ready: false, pending: true })).toBe('not_ready');
    expect(purchaseBlockReason({ ...base, pending: true, nextQuantity: 99 })).toBe('pending');
    expect(purchaseBlockReason({ ...base, nextQuantity: 9 })).toBe('stock');
  });
});

describe('buyNowNavigation', () => {
  it('요청이 없으면 이동하지 않는다', () => {
    expect(buyNowNavigation({ requested: false, cartPending: false, cartError: null })).toBe('abort');
  });

  it('카트 반영이 끝나기 전에는 기다린다 — 클라이언트 성공 신호는 진실원이 아니다', () => {
    expect(buyNowNavigation({ requested: true, cartPending: true, cartError: null })).toBe('wait');
  });

  it('반영이 정착하고 오류가 없을 때만 체크아웃으로 간다', () => {
    expect(buyNowNavigation({ requested: true, cartPending: false, cartError: null })).toBe('navigate');
  });

  it('카트가 오류를 냈으면 이동을 접는다 — 담기지 않은 채 결제 화면에 서지 않는다', () => {
    expect(
      buyNowNavigation({ requested: true, cartPending: false, cartError: '재고 초과' }),
    ).toBe('abort');
  });
});

describe('addToCartResultStep', () => {
  it('담기를 누르지 않았으면 성공 문구가 남아 있어도 모달을 열지 않는다', () => {
    expect(addToCartResultStep({ awaiting: false, message: CART_ADDED_STATUS })).toBe('idle');
    expect(addToCartResultStep({ awaiting: false, message: null })).toBe('idle');
  });

  it('카트 반영 확정 문구가 온 뒤에만 연다 — 반영 중에는 기다린다', () => {
    expect(addToCartResultStep({ awaiting: true, message: null })).toBe('wait');
    expect(addToCartResultStep({ awaiting: true, message: CART_ADDED_STATUS })).toBe('open');
  });

  it('카트·검증 오류 문구가 오면 열지 않고 기다림을 접는다', () => {
    expect(addToCartResultStep({ awaiting: true, message: '현재 재고보다 많이 담을 수 없습니다.' })).toBe('fail');
    expect(addToCartResultStep({ awaiting: true, message: '아크릴 블록: 각인 문구를 입력해주세요.' })).toBe('fail');
  });
});

describe('addedCartItems', () => {
  it('본품과 고른 추가 구성을 담기 함수와 같은 선택으로 요약한다', () => {
    const blue = { id: 'blue', name: '파랑', price: 12000, stockQty: 3, code: 'BLUE', attributes: {}, isDefault: true };
    const red = { ...blue, id: 'red', name: '빨강', isDefault: false };
    const sticker = { ...good, id: 'g14', name: '추가 스티커', options: [{ ...blue, id: 'x-blue' }, { ...red, id: 'x-red' }] };
    const items = addedCartItems({
      good: { ...good, options: [blue, red] },
      selectedOption: red,
      quantity: 2,
      additionalChoices: [
        { goodId: sticker.id, name: sticker.name, good: sticker, selected: true, selectedOption: sticker.options[1], quantity: 3 },
        { goodId: 'g15', name: '고르지 않은 추가 구성', selected: false, quantity: 1 },
      ],
    });

    expect(items).toEqual([
      { name: '아크릴 블록', option: '빨강', quantity: 2 },
      { name: '추가 스티커', option: '빨강', quantity: 3 },
    ]);
  });

  it('하나뿐인 기본 옵션은 옵션 이름을 비운다', () => {
    const only = { id: 'only', name: '기본 옵션', price: 12000, stockQty: 3, code: 'ONLY', attributes: {}, isDefault: true };
    expect(addedCartItems({ good: { ...good, options: [only] }, selectedOption: only, quantity: 1 })).toEqual([
      { name: '아크릴 블록', option: null, quantity: 1 },
    ]);
  });
});

describe('isGoodSoldOut', () => {
  /* 품절 판정은 수량이 아니라 판매 상태다 — 운영자가 내린 굿즈는 재고가 남아도 품절이다. */
  it('판매 상태로만 판정한다', () => {
    expect(isGoodSoldOut({ stock: 'soldout' })).toBe(true);
    expect(isGoodSoldOut({ stock: 'low' })).toBe(false);
    expect(isGoodSoldOut({ stock: 'ok' })).toBe(false);
  });
});

describe('purchaseTotalDisplay', () => {
  const base = { good, unavailableLabel: null, selectionRequired: false, subtotal: 24000, soldOut: false, quantity: 2 };

  it('본문 패널과 레일 박스가 같은 합계 라벨·값을 쓴다', () => {
    expect(purchaseTotalDisplay(base)).toEqual({ label: '총 금액', amount: '₩24,000', numeric: true });
    expect(purchaseTotalDisplay({ ...base, good: { ...good, transactionOffer: null } }).label).toBe('총 금액');
  });

  it('판매 기간 밖이면 판매 상태를, 판매 중 옵션 전이면 안내 문구를 금액 대신 보인다', () => {
    expect(purchaseTotalDisplay({ ...base, unavailableLabel: '판매 종료', selectionRequired: true, subtotal: 0, soldOut: true }))
      .toEqual({ label: '판매 상태', amount: '판매 종료', numeric: false });
    expect(purchaseTotalDisplay({ ...base, selectionRequired: true, subtotal: 0 }))
      .toEqual({ label: '총 금액', amount: '옵션 선택 후 표시', numeric: false });
  });

  /* PD-08 — 재고 0 옵션은 자동 선택되지 않아 품절 굿즈에 "옵션 선택 후 표시"가 남던 결함. */
  it('품절 굿즈는 고를 옵션이 없으니 가격으로 합계를 보인다', () => {
    const only = { id: 'only', name: '기본 옵션', price: 9000, stockQty: 0, code: 'ONLY', attributes: {}, isDefault: true };
    expect(purchaseTotalDisplay({ ...base, good: { ...good, stock: 'soldout', stockQty: 0, options: [only] }, selectionRequired: true, subtotal: 0, soldOut: true, quantity: 1 }))
      .toEqual({ label: '총 금액', amount: '₩9,000', numeric: true });
    /* 옵션이 없는 품절 굿즈는 굿즈 가격이다. */
    expect(purchaseTotalDisplay({ ...base, good: { ...good, stock: 'soldout', stockQty: 0 }, selectionRequired: true, subtotal: 0, soldOut: true, quantity: 1 }).amount)
      .toBe('₩12,000');
  });

  /* PD-10 — 고른 품절 옵션은 담기 대상이 아니라 subtotal 이 0 이어도 그 옵션 가격으로 합계를 보인다. */
  it('고른 품절 옵션은 그 옵션 가격으로 합계를 보인다', () => {
    const red = { id: 'red', name: '빨강', price: 15000, stockQty: 0, code: 'RED', attributes: {}, isDefault: false };
    expect(purchaseTotalDisplay({ ...base, restockOption: red, selectionRequired: true, subtotal: 0, quantity: 1 }))
      .toEqual({ label: '총 금액', amount: '₩15,000', numeric: true });
    /* 모든 옵션이 품절인 굿즈에서 직접 고른 옵션도 첫 옵션 대신 그 옵션 가격이다. */
    expect(purchaseTotalDisplay({ ...base, good: { ...good, stock: 'soldout', stockQty: 0 }, restockOption: red, selectionRequired: true, subtotal: 0, soldOut: true, quantity: 1 }).amount)
      .toBe('₩15,000');
    /* 판매 상태 안내가 먼저다. */
    expect(purchaseTotalDisplay({ ...base, restockOption: red, unavailableLabel: '판매 종료' }).amount).toBe('판매 종료');
  });
});

describe('purchaseCtaState (PD-10 · DESIGN restock-cta)', () => {
  const blue = { id: 'blue', name: '파랑', price: 12000, stockQty: 3, code: 'BLUE', attributes: {}, isDefault: true };
  const red = { id: 'red', name: '빨강', price: 15000, stockQty: 0, code: 'RED', attributes: {}, isDefault: false };
  const multi = { ...good, options: [blue, red] };
  const base = { good: multi, unavailableLabel: null, soldOut: false, restockRequested: false, restockVariantIds: [] as string[] };

  it('판매 불가 안내 → 굿즈 전체 품절(모든 옵션) → 고른 옵션만 품절(그 옵션) → 담기·구매 순이다', () => {
    expect(purchaseCtaState({ ...base, unavailableLabel: '판매 종료', soldOut: true, restockOption: red })).toEqual({ kind: 'unavailable', label: '판매 종료' });
    expect(purchaseCtaState({ ...base, soldOut: true, restockOption: red, restockRequested: true }))
      .toEqual({ kind: 'restock', variantId: null, optionName: null, requested: true });
    expect(purchaseCtaState({ ...base, restockOption: red })).toEqual({ kind: 'restock', variantId: 'red', optionName: '빨강', requested: false });
    expect(purchaseCtaState(base)).toEqual({ kind: 'buy' });
  });

  /* 옵션 신청의 신청됨 표시는 그 옵션의 대기 신청으로만 정해진다 — 굿즈 단위 신청과 섞지 않는다. */
  it('옵션 신청 상태는 그 옵션의 대기 신청만 본다', () => {
    expect(purchaseCtaState({ ...base, restockOption: red, restockVariantIds: ['red'] })).toMatchObject({ requested: true });
    expect(purchaseCtaState({ ...base, restockOption: red, restockVariantIds: ['other'], restockRequested: true })).toMatchObject({ requested: false });
  });
});

describe('GoodRailBuyBox', () => {
  it('합계와 [카트 50][구매 226] 버튼을 같은 컨트롤러 함수에 묶는다', () => {
    const html = renderToStaticMarkup(<GoodRailBuyBox purchase={controller({ quantity: 2, subtotal: 24000 })} />);

    expect(html).toContain('<section aria-label="빠른 구매" class="wc-pdp-railbox">');
    expect(html).toContain('<strong class="wc-pdp-railbox__amount">₩24,000</strong>');
    expect(html).toContain('<button aria-label="장바구니에 담기" class="wc-pdp-railbox__cart" type="button">');
    expect(html).toContain('<button class="wc-pdp-railbox__buy" type="button">구매하기</button>');
  });

  it('옵션 전에는 CTA 를 잠그고 합계 자리에 안내 문구를 작은 서체로 둔다', () => {
    const html = renderToStaticMarkup(<GoodRailBuyBox purchase={controller({ selectionRequired: true, inert: true, subtotal: 0 })} />);

    expect(html).toContain('<strong class="wc-pdp-railbox__amount is-note">옵션 선택 후 표시</strong>');
    expect(html).toMatch(/class="wc-pdp-railbox__cart" disabled=""/);
    expect(html).toMatch(/class="wc-pdp-railbox__buy" disabled=""/);
  });

  /* 담는 동안(카트 반영 중)에는 disabled 로 바꾸지 않는다 — 누른 버튼이 포커스를 잃으면 담기 결과 모달이 body 를
     복귀 대상으로 기억해, 닫은 뒤 포커스가 사라진다(L2 QA l2-qa-4). 상태는 aria-disabled 로 알리고 클릭은 inert 가 막는다. */
  it('담는 동안에는 CTA 를 aria-disabled 로 잠그고 포커스를 지킨다(옵션 전 잠금은 그대로 disabled)', () => {
    const busy = renderToStaticMarkup(<GoodRailBuyBox purchase={controller({ inert: true, inFlight: true, quantity: 1, subtotal: 12000 })} />);

    expect(busy).toContain('<button aria-disabled="true" aria-label="장바구니에 담기" class="wc-pdp-railbox__cart" type="button">');
    expect(busy).toContain('<button aria-disabled="true" class="wc-pdp-railbox__buy" type="button">구매하기</button>');
    expect(busy).not.toMatch(/wc-pdp-railbox__(cart|buy)" disabled=""/);
  });

  it('품절이면 두 버튼 자리를 재입고 알림 하나로 바꾼다', () => {
    const html = renderToStaticMarkup(<GoodRailBuyBox purchase={controller({ good: { ...good, stock: 'soldout', stockQty: 0 }, soldOut: true })} />);

    expect(html).toContain('재입고 알림 받기');
    expect(html).toContain('data-variant=""');
    expect(html).not.toContain('wc-pdp-railbox__ctas');
  });

  it('고른 옵션만 품절이면 레일 박스도 그 옵션의 재입고 알림과 그 옵션 합계다', () => {
    const red = { id: 'red', name: '빨강', price: 15000, stockQty: 0, code: 'RED', attributes: {}, isDefault: false };
    const blue = { ...red, id: 'blue', name: '파랑', price: 12000, stockQty: 3, isDefault: true };
    const html = renderToStaticMarkup(<GoodRailBuyBox purchase={controller({ good: { ...good, options: [blue, red] }, restockOption: red, selectionRequired: true, inert: true, subtotal: 0 })} />);

    expect(html).toContain('<strong class="wc-pdp-railbox__amount">₩15,000</strong>');
    expect(html).toContain('data-option="빨강" data-variant="red"');
    expect(html).not.toContain('wc-pdp-railbox__ctas');
  });
});

describe('GoodPurchasePanel 담는 동안의 CTA', () => {
  it('카트 반영 중에는 장바구니·구매하기를 aria-disabled 로 잠그고 disabled 는 옵션 전처럼 실제로 막을 때만 쓴다', () => {
    const busy = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ inert: true, inFlight: true, quantity: 1, subtotal: 12000 })} />);
    expect(busy).toMatch(/<button aria-disabled="true" class="wc-btn wc-buy-panel__cart" type="button">/);
    expect(busy).toMatch(/<button aria-disabled="true" class="wc-btn primary wc-buy-panel__buy" type="button">/);

    const locked = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ selectionRequired: true, inert: true, subtotal: 0 })} />);
    expect(locked).toMatch(/<button class="wc-btn wc-buy-panel__cart" disabled="" type="button">/);
    expect(locked).toMatch(/<button class="wc-btn primary wc-buy-panel__buy" disabled="" type="button">/);
    expect(locked).not.toContain('aria-disabled="true" class="wc-btn wc-buy-panel__cart"');
  });
});

describe('activeGalleryIndex', () => {
  it('스크롤 위치에서 가장 가까운 슬라이드를 고른다', () => {
    expect(activeGalleryIndex(0, 649, 3)).toBe(0);
    expect(activeGalleryIndex(700, 649, 3)).toBe(1);
    expect(activeGalleryIndex(1298, 649, 3)).toBe(2);
  });

  /* 마운트 직후에는 폭을 못 잰다. 0으로 나눠 NaN 인덱스를 만들면 활성 도트가 사라진다. */
  it('측정 전이거나 범위를 벗어나면 안전한 인덱스를 낸다', () => {
    expect(activeGalleryIndex(300, 0, 3)).toBe(0);
    expect(activeGalleryIndex(99999, 649, 3)).toBe(2);
    expect(activeGalleryIndex(-50, 649, 3)).toBe(0);
  });
});

describe('GoodPurchasePanel', () => {
  it('단일 옵션은 선택기를 숨기고 기본값이 아닌 옵션명만 표시한다', () => {
    const option = {id:'blue',name:'파랑',price:12000,stockQty:3,code:'BLUE',attributes:{색상:'파랑'},isDefault:true};
    const html = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({good:{...good,options:[option]},selectedOption:option})} />);
    expect(html).not.toContain('<select');
    expect(html).toContain('파랑');
    const defaultOption = {...option,name:'기본 옵션',attributes:{}};
    const defaultHtml = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({good:{...good,options:[defaultOption]},selectedOption:defaultOption})} />);
    expect(defaultHtml).not.toContain('<select');
    expect(defaultHtml).not.toContain('wc-buy-panel__option');
  });

  /* LD-5 — #427 수용 기준("품절 옵션은 선택 불가")을 번복했다. 품절 옵션도 `· 품절`로 보이고 고를 수 있다. */
  it('품절 옵션도 `· 품절`로 보이고 고를 수 있으며, 닫힌 예약판매 옵션만 고르지 못한다', () => {
    const options = [
      {id:'blue',name:'파랑',price:12000,stockQty:0,code:'BLUE',attributes:{},isDefault:true},
      {id:'red',name:'빨강',price:15000,stockQty:2,code:'RED',attributes:{},isDefault:false},
      {id:'pre',name:'예약',price:16000,stockQty:0,code:'PRE',attributes:{},isDefault:false,supply:{mode:'preorder' as const,state:'closed' as const,availableQty:0,
        policyId:'00000000-0000-4000-8000-000000000009',policyRevision:1,startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-10-21T00:00:00Z',
        expectedShipDate:'2026-11-20',calculatedAt:'2026-10-22T00:00:00Z',nextChangeAt:null}},
    ];
    const html = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({good:{...good,options},selectedOption:options[1]})} />);
    expect(html).toMatch(/<option value="blue">파랑 · ₩12,000 · 품절<\/option>/);
    expect(html).toMatch(/<option value="red" selected="">빨강 · ₩15,000<\/option>/);
    expect(html).toMatch(/<option value="pre" disabled="">예약 · ₩16,000 · 예약 접수 종료<\/option>/);
    expect(html).toContain('wc-buy-panel__ctas');
    /* R-04 §3.5 — 고른 옵션이 있으면 빈 옵션(placeholder) 행을 두지 않는다. 첫 옵션이 고른 옵션이다. */
    expect(html).not.toContain('옵션을 선택해주세요');
    expect(html).toMatch(/<select>(<option value="blue">)/);
  });

  /* 고른 품절 옵션(재입고 알림 대상)도 고른 옵션이라 빈 옵션이 없다. 고른 옵션이 사라졌을 때만 빈 옵션이 선택된 채 남는다. */
  it('빈 옵션은 고른 옵션이 없을 때만 둔다', () => {
    const options = [
      {id:'blue',name:'파랑',price:12000,stockQty:0,code:'BLUE',attributes:{},isDefault:true},
      {id:'red',name:'빨강',price:15000,stockQty:0,code:'RED',attributes:{},isDefault:false},
    ];
    const soldOut = { ...good, stock: 'soldout' as const, stockQty: 0, options };
    const chosen = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ good: soldOut, soldOut: true, restockOption: options[0], selectionRequired: true, inert: true, subtotal: 0 })} />);
    expect(chosen).not.toContain('옵션을 선택해주세요');
    expect(chosen).toMatch(/<option value="blue" selected="">파랑 · ₩12,000 · 품절<\/option>/);
    expect(chosen).toContain('<strong class="wc-buy-panel__total-amount">₩12,000</strong>');

    const gone = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ good: { ...good, options: [{ ...options[0], stockQty: 3 }, options[1]] }, selectionRequired: true, inert: true, subtotal: 0 })} />);
    expect(gone).toContain('<option value="" disabled="" selected="">옵션을 선택해주세요</option>');
  });

  /* PD-10 — 고른 품절 옵션: 셀렉트는 그 옵션을 가리키고, CTA 쌍 대신 그 옵션의 재입고 알림, 합계는 그 옵션 가격. */
  it('품절 옵션을 고르면 CTA 가 그 옵션의 재입고 알림으로 바뀌고 합계는 그 옵션 가격이다', () => {
    const options = [
      {id:'blue',name:'파랑',price:12000,stockQty:3,code:'BLUE',attributes:{},isDefault:true},
      {id:'red',name:'빨강',price:15000,stockQty:0,code:'RED',attributes:{},isDefault:false},
    ];
    const html = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({
      good:{...good,options}, selectedOption: undefined, restockOption: options[1], selectionRequired: true, inert: true, subtotal: 0,
    })} />);
    expect(html).toMatch(/<option value="red" selected="">빨강 · ₩15,000 · 품절<\/option>/);
    expect(html).toContain('<button class="wc-restock-cta" data-option="빨강" data-variant="red" type="button">재입고 알림 받기</button>');
    expect(html).not.toContain('wc-buy-panel__ctas');
    expect(html).toContain('<strong class="wc-buy-panel__total-amount">₩15,000</strong>');
    expect(html).not.toContain('옵션 선택 후 표시');

    const requested = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({
      good:{...good,options}, restockOption: options[1], restockVariantIds: ['red'], selectionRequired: true, inert: true, subtotal: 0,
    })} />);
    expect(requested).toContain('data-variant="red" type="button">재입고 알림 신청됨</button>');
  });

  it('합계는 단가가 아니라 수량을 반영한 금액이다', () => {
    const html = renderToStaticMarkup(
      <GoodPurchasePanel purchase={controller({ quantity: 3, subtotal: purchaseSubtotal(good.price, 3) })} />,
    );

    expect(html).toContain('총 금액');
    expect(html).toContain('₩36,000');
    expect(html).toContain('value="3"');
  });

  it('품절이면 CTA 쌍 대신 재입고 알림만 남고 합계는 가격으로 보인다', () => {
    const html = renderToStaticMarkup(
      <GoodPurchasePanel purchase={controller({ good: { ...good, stock: 'soldout', stockQty: 0 }, soldOut: true, selectionRequired: true, inert: true, subtotal: 0 })} />,
    );

    expect(html).toContain('재입고 알림 받기');
    expect(html).not.toContain('wc-buy-panel__ctas');
    expect(html).toContain('<strong class="wc-buy-panel__total-amount">₩12,000</strong>');
    expect(html).not.toContain('옵션 선택 후 표시');
  });

  /* PD-12 — '품절임박/품절'은 운영자가 고르는 재고 표시라 실재고와 연동되지 않는다. 라벨을 두지 않는다. */
  it('재고 표시 라벨(품절임박·품절)을 패널에 두지 않는다', () => {
    const low = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ good: { ...good, stock: 'low', stockQty: 2 } })} />);
    const soldOut = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ good: { ...good, stock: 'soldout', stockQty: 0 }, soldOut: true })} />);

    expect(low).not.toContain('품절임박');
    expect(soldOut).not.toMatch(/<p class="wc-buy-panel__state">품절<\/p>/);
    /* 판매 기간 같은 판매 상태는 그대로 글로 먼저 알린다. */
    expect(renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ unavailableLabel: '판매 시작 전' })} />))
      .toContain('<p class="wc-buy-panel__state">판매 시작 전</p>');
  });

  /* 서버 확인 전에는 "완료"라고 하지 않는다. 카트가 낸 오류가 있으면 그것이 먼저다. */
  it('상태 문구를 live region 으로 알린다', () => {
    const html = renderToStaticMarkup(
      <GoodPurchasePanel purchase={controller({ message: '현재 재고보다 많이 담을 수 없습니다.' })} />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('현재 재고보다 많이 담을 수 없습니다.');
  });

  /* QA l2-qa-2 — 실패·거절 안내가 성공색으로 그려지던 결함. 성공(담았어요)만 기본 상태 줄이고 나머지는 실패 표시다. */
  it('상태 줄은 담기 성공만 성공 표시이고 카트·검증 오류는 실패 표시(is-error)다', () => {
    const status = (html: string) => /<p aria-atomic="true" aria-live="polite" class="([^"]*)" role="status">([^<]*)<\/p>/.exec(html)?.slice(1);

    expect(status(renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ message: CART_ADDED_STATUS })} />)))
      .toEqual(['wc-buy-panel__status', CART_ADDED_STATUS]);
    expect(status(renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ message: '현재 재고보다 많이 담을 수 없습니다.' })} />)))
      .toEqual(['wc-buy-panel__status is-error', '현재 재고보다 많이 담을 수 없습니다.']);
    expect(status(renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ message: '아크릴 블록: 각인 문구을(를) 1~100자로 입력해주세요.' })} />)))
      .toEqual(['wc-buy-panel__status is-error', '아크릴 블록: 각인 문구을(를) 1~100자로 입력해주세요.']);
    /* 비어 있으면 기본 상태 줄 그대로(빈 줄은 CSS 가 자리를 접는다). */
    expect(status(renderToStaticMarkup(<GoodPurchasePanel purchase={controller()} />))).toEqual(['wc-buy-panel__status', '']);
  });

  it('추가상품은 선택형이며 선택한 상품의 옵션과 독립 수량을 표시한다', () => {
    const extraOption = { id: 'extra-blue', name: '파랑', price: 3000, stockQty: 4, code: 'EXTRA-BLUE', attributes: { 색상: '파랑' }, isDefault: false };
    const unavailableOption = { ...extraOption, id: 'extra-red', name: '빨강', stockQty: 0 };
    const extra = { ...good, id: 'g14', name: '추가 스티커', price: 3000, options: [extraOption, unavailableOption] };
    const html = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({
      subtotal: 18000,
      additionalChoices: [{ goodId: extra.id, name: extra.name, good: extra, selected: true, selectedOption: extraOption, quantity: 2 }],
      toggleAdditional: vi.fn(), selectAdditionalOption: vi.fn(), setAdditionalQuantity: vi.fn(),
    })} />);
    expect(html).toContain('추가 구성 굿즈');
    expect(html).toContain('(선택)');
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).toContain('추가 스티커 옵션');
    expect(html).toContain('aria-label="추가 스티커 추가 수량"');
    expect(html).toMatch(/<option[^>]*value="extra-red"[^>]*disabled=""/);
    expect(html).toContain('₩18,000');
  });

  /*
   * QA l2-qa-3 — 할 수 있는 일이 재입고 알림뿐인 상태에서 직접 입력(필수)·추가 구성 체크박스가 그대로 남아, 체크해도 합계가
   * 움직이지 않는 반응 없는 컨트롤이었다. 재입고 상태는 두 칸을 접고, 고른 옵션만 품절이면 돌아갈 길을 한 줄로 알린다.
   */
  describe('재입고 알림만 할 수 있는 상태의 구매 전용 칸 (QA l2-qa-3)', () => {
    const blue = { id: 'blue', name: '파랑', price: 12000, stockQty: 3, code: 'BLUE', attributes: {}, isDefault: true };
    const red = { id: 'red', name: '빨강', price: 15000, stockQty: 0, code: 'RED', attributes: {}, isDefault: false };
    const extraOption = { id: 'extra-blue', name: '파랑', price: 3000, stockQty: 4, code: 'EXTRA-BLUE', attributes: {}, isDefault: true };
    const extra: Good = { ...good, id: 'g14', name: '추가 스티커', price: 3000, options: [extraOption],
      transactionOffer: { goodId: 'g14', volume: null, delivery: null, collectReady: false, collector: null,
        production: { version: 1, goodId: 'g14', revision: 1, leadDays: 3, dayBasis: 'business', closedDates: [], publicNote: '스티커는 주문 후 인쇄합니다.' } } };
    const engraved: Good = { ...good, options: [blue, red], customInputs: { enabled: true, revision: 1, fields: [{ id: 'engrave', name: '각인 문구', active: true }] } };
    const choices: AdditionalPurchaseChoice[] = [{ goodId: extra.id, name: extra.name, good: extra, selected: true, selectedOption: extraOption, quantity: 2 }];
    const NOTE = '품절 옵션은 재입고 알림만 신청할 수 있어요. 직접 입력 옵션·추가 구성 굿즈는 판매 중인 옵션을 고르면 보여요.';

    it('고른 옵션만 품절이면 직접 입력·추가 구성(과 그 거래 조건)을 접고 판매 중인 옵션을 고르면 보인다고 알린다', () => {
      const html = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({
        good: engraved, restockOption: red, selectionRequired: true, inert: true, subtotal: 0,
        additionalChoices: choices, toggleAdditional: vi.fn(), customInputValues: { g13: { engrave: '적어 둔 문구' } }, setCustomInputValue: vi.fn(),
      })} />);

      expect(html).not.toContain('직접 입력 옵션</legend>');
      expect(html).not.toContain('good-custom-g13-engrave');
      expect(html).not.toContain('aria-label="추가 구성 굿즈"');
      expect(html).not.toContain('스티커는 주문 후 인쇄합니다.');
      expect(html).toContain(`<p class="wc-buy-panel__state">${NOTE}</p>`);
      /* 안내는 셀렉트 바로 아래(예약판매 안내와 같은 자리)이고, 수량·합계·그 옵션의 재입고 CTA 는 그대로다. */
      expect(html.indexOf(NOTE)).toBeGreaterThan(html.indexOf('</select>'));
      expect(html.indexOf(NOTE)).toBeLessThan(html.indexOf('wc-buy-panel__row'));
      expect(html).toContain('<strong class="wc-buy-panel__total-amount">₩15,000</strong>');
      expect(html).toContain('data-option="빨강" data-variant="red"');
    });

    it('판매 중인 옵션이면 같은 칸을 그대로 보이고 안내는 없다', () => {
      const html = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({
        good: engraved, selectedOption: blue, additionalChoices: choices, toggleAdditional: vi.fn(), setAdditionalQuantity: vi.fn(),
        customInputValues: { g13: { engrave: '적어 둔 문구' } }, setCustomInputValue: vi.fn(),
      })} />);

      expect(html).toContain('직접 입력 옵션</legend>');
      expect(html).toContain('value="적어 둔 문구"');
      expect(html).toContain('aria-label="추가 구성 굿즈"');
      expect(html).toContain('스티커는 주문 후 인쇄합니다.');
      expect(html).not.toContain('품절 옵션은 재입고 알림만');
    });

    it('모든 옵션이 품절이면 칸을 접되 돌아갈 옵션이 없으니 안내하지 않는다', () => {
      const html = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({
        good: { ...engraved, stock: 'soldout', stockQty: 0, options: [{ ...blue, stockQty: 0 }, red] }, soldOut: true, restockOption: { ...blue, stockQty: 0 },
        selectionRequired: true, inert: true, subtotal: 0, additionalChoices: choices, toggleAdditional: vi.fn(),
      })} />);

      expect(html).not.toContain('직접 입력 옵션</legend>');
      expect(html).not.toContain('aria-label="추가 구성 굿즈"');
      expect(html).not.toContain('품절 옵션은 재입고 알림만');
      expect(html).toContain('data-variant=""');
    });

    it('접을 칸이 없으면 안내도 없고, 접은 칸만 이름으로 말한다', () => {
      const plain = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({ good: { ...good, options: [blue, red] }, restockOption: red, selectionRequired: true, inert: true, subtotal: 0 })} />);
      expect(plain).not.toContain('품절 옵션은 재입고 알림만');

      expect(foldedPurchaseInputsNote([])).toBeNull();
      expect(foldedPurchaseInputsNote(['직접 입력 옵션'])).toBe('품절 옵션은 재입고 알림만 신청할 수 있어요. 직접 입력 옵션은 판매 중인 옵션을 고르면 보여요.');
      expect(foldedPurchaseInputsNote(['추가 구성 굿즈'])).toBe('품절 옵션은 재입고 알림만 신청할 수 있어요. 추가 구성 굿즈는 판매 중인 옵션을 고르면 보여요.');
      expect(foldedPurchaseInputsNote(['직접 입력 옵션', '추가 구성 굿즈'])).toBe(NOTE);
    });
  });

  it('없어진 추가 선택을 숨기지 않고 해제할 체크박스와 구매 불가 상태를 남긴다', () => {
    const html = renderToStaticMarkup(<GoodPurchasePanel purchase={controller({
      inert: true, selectionRequired: true,
      additionalChoices: [{ goodId: 'gone', name: '이전 추가상품', selected: true, quantity: 1 }],
      toggleAdditional: vi.fn(),
    })} />);
    expect(html).toContain('이전 추가상품 · 현재 구매 불가');
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).toContain('옵션 선택 후 표시');
  });
});
