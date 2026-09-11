'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useCart } from '@/components/shell/CartProvider';
import { RestockCta } from '@/components/shop/RestockCta';
import { QuantityStepper } from '@/components/wc/QuantityStepper';
import { WcButton } from '@/components/wc/WcButton';
import type { Good, GoodOption } from '@/lib/data';
import { goodsPurchaseConditionProblem, initialGoodOption, optionLabel } from '@/lib/goods-options';
import { krw } from '@/lib/format';
import { STOCK_LABEL } from '@/lib/goods-display';
import { goodsShipDateLabel, preorderSupplyLabel, preorderUnavailableLabel } from '@/lib/goods-preorders';

/*
 * 굿즈 상세의 구매 블록 (R-04 §3.6~3.8 · DESIGN `pdp-buybox`·`cta-pair`·`restock-cta`).
 *
 * 여러 옵션은 명시적으로 선택하고 단일 옵션은 자동 선택한다.
 * 상태는 이 훅 하나가 갖고, 정보 칼럼 패널과 고정 구매바가 같은 컨트롤러를 나눠 쓴다.
 * 두 표면이 각자 수량을 들면 아래 바로 산 개수와 위에서 고른 개수가 갈린다.
 *
 * 금액·재고의 최종 판정은 언제나 서버다. 여기 계산은 "지금 담으면 얼마인가"를
 * 미리 보여 주기 위한 표시용 파생이고, 본품과 추가상품은 한 번의 카트
 * 반영을 거쳐 기존 place_order의 가격·수량·재고 판정을 통과한다.
 */

export const CART_ADDED_STATUS = '장바구니에 담았어요.';

/** 품절 판정은 재고 수량이 아니라 판매 상태다 — 운영자가 내린 굿즈는 수량과 무관하다. */
export function isGoodSoldOut(good: Pick<Good, 'stock'>) {
  return good.stock === 'soldout';
}

/** 실시간 합계. 소수·음수 수량은 표시 단계에서 걸러 0 이하로 내려가지 않게 한다. */
export function purchaseSubtotal(price: number, quantity: number) {
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) return 0;
  return Math.max(0, Math.trunc(price)) * Math.max(0, Math.trunc(quantity));
}

/**
 * 담기 결과 수량.
 *
 * 이미 담긴 수량에 더한다 — 상세에서 2개를 담고 다시 3개를 담으면 5개다.
 * 재고 상한으로 자르지 않는다: 상한 판정은 CartProvider 와 DB 가 하고, 여기서
 * 조용히 잘라 버리면 "3개 담기를 눌렀는데 1개만 담긴" 이유를 아무도 말하지 않는다.
 */
export function mergedCartQuantity(currentQuantity: number, addedQuantity: number) {
  return Math.max(0, Math.trunc(currentQuantity)) + Math.max(1, Math.trunc(addedQuantity));
}

export type PurchaseBlockReason = 'disabled' | 'soldout' | 'not_ready' | 'pending' | 'stock' | null;

export interface PurchaseBlockState {
  disabled: boolean;
  soldOut: boolean;
  ready: boolean;
  pending: boolean;
  nextQuantity: number;
  stockQty: number;
}

/**
 * 구매 행동을 막는 이유. 없으면 null 이다.
 *
 * 이유를 하나로 모으는 것은 버튼의 비활성 조건과 "눌렀을 때 무슨 일이 일어나는가"가
 * 어긋나지 않게 하기 위해서다. `stock` 만은 버튼을 잠그지 않는다 — 재고를 넘겼다는
 * 사실은 카트가 자기 오류 문구로 말해야 사용자가 이유를 안다.
 */
export function purchaseBlockReason(state: PurchaseBlockState): PurchaseBlockReason {
  if (state.disabled) return 'disabled';
  if (state.soldOut) return 'soldout';
  if (!state.ready) return 'not_ready';
  if (state.pending) return 'pending';
  if (state.nextQuantity > state.stockQty) return 'stock';
  return null;
}

/** 데스크톱 플로팅 미니 바는 하부 탭 영역이 보일 때만 뜬다. 미리보기에는 없다. */
export function isMiniBuybarVisible(state: { panelsInView: boolean; embedded: boolean }) {
  return state.panelsInView && !state.embedded;
}

/**
 * 바로구매의 이동 판정. 클라이언트 성공 신호는 확정의 진실원이 아니다 —
 * 카트 반영이 서버에서 정착(pending 해제)된 뒤, 오류가 없을 때만 체크아웃으로 간다.
 * 실패했는데 이동하면 방금 담은 수량이 빠진 카트로 결제 화면에 서는 셈이다.
 */
export function buyNowNavigation(state: {
  requested: boolean;
  cartPending: boolean;
  cartError: string | null;
}): 'navigate' | 'wait' | 'abort' {
  if (!state.requested) return 'abort';
  if (state.cartPending) return 'wait';
  return state.cartError ? 'abort' : 'navigate';
}

export interface GoodPurchaseController {
  good: Good;
  selectedOption: GoodOption | undefined;
  selectOption: (id: string) => void;
  selectionRequired: boolean;
  quantity: number;
  setQuantity: (next: number) => void;
  subtotal: number;
  soldOut: boolean;
  restockRequested: boolean;
  disabled: boolean;
  inert: boolean;
  message: string | null;
  addToCart: () => void;
  buyNow: () => void;
  additionalChoices?: AdditionalPurchaseChoice[];
  toggleAdditional?: (goodId: string, selected: boolean) => void;
  selectAdditionalOption?: (goodId: string, variantId: string) => void;
  setAdditionalQuantity?: (goodId: string, quantity: number) => void;
  cartError?: boolean;
  refreshCart?: () => void;
  busy?: boolean;
  unavailableLabel?: string | null;
}

interface AdditionalSelection { goodId: string; name: string; variantId?: string; quantity: number }
export interface AdditionalPurchaseChoice {
  goodId: string;
  name: string;
  good?: Good;
  selected: boolean;
  selectedOption?: GoodOption;
  quantity: number;
}

export function useGoodPurchase({
  disabled = false,
  good,
  additionalGoods = [],
  restockRequested = false,
}: {
  disabled?: boolean;
  good: Good;
  additionalGoods?: readonly Good[];
  restockRequested?: boolean;
}): GoodPurchaseController {
  const router = useRouter();
  const cart = useCart();
  const [quantity, setQuantityState] = useState(1);
  const [selectedId, setSelectedId] = useState(() => initialGoodOption(good)?.id);
  const selectedOption = good.options?.find(option => option.id === selectedId && option.stockQty > 0)
    ?? (selectedId === undefined ? initialGoodOption(good) : undefined);
  const [additionalSelections, setAdditionalSelections] = useState<AdditionalSelection[]>([]);
  const additionalChoices: AdditionalPurchaseChoice[] = additionalGoods.map((extra) => {
    const selection = additionalSelections.find((item) => item.goodId === extra.id);
    return { goodId: extra.id, name: extra.name, good: extra, selected: Boolean(selection), quantity: selection?.quantity ?? 1,
      selectedOption: extra.options?.find((option) => option.id === selection?.variantId && option.stockQty > 0) };
  });
  // Preserve a disappeared selection until the customer explicitly removes it.
  for (const selection of additionalSelections) {
    if (!additionalChoices.some((choice) => choice.goodId === selection.goodId)) {
      additionalChoices.push({ goodId: selection.goodId, name: selection.name, selected: true, quantity: selection.quantity });
    }
  }
  const chosenAdditions = additionalChoices.filter((choice) => choice.selected);
  const selectionRequired = !selectedOption || chosenAdditions.some((choice) => !choice.selectedOption);
  const stockQty = selectedOption?.stockQty ?? 0;
  const [status, setStatus] = useState<string | null>(null);
  /* 바로구매 요청은 세대 번호로 든다 — 소비 표시는 ref 에 적어 effect 가 상태를 되쓰지
     않는다(리셋 setState 는 캐스케이딩 렌더 lint 에 걸리고, 실제로도 파생이 아니라 소비다). */
  const [checkoutGen, setCheckoutGen] = useState(0);
  const handledCheckoutGenRef = useRef(0);
  const committingRef = useRef(false);

  const cartPending = cart.pending;
  const cartError = cart.error;
  useEffect(() => {
    const navigation = buyNowNavigation({
      requested: checkoutGen !== handledCheckoutGenRef.current,
      cartPending,
      cartError,
    });
    if (navigation === 'wait' || checkoutGen === handledCheckoutGenRef.current) return;
    handledCheckoutGenRef.current = checkoutGen;
    if (navigation === 'navigate') router.push('/checkout');
  }, [checkoutGen, cartPending, cartError, router]);

  const soldOut = isGoodSoldOut(good);
  const unavailableAddition = chosenAdditions.find((choice) => !choice.good || choice.good.stock === 'soldout' || goodsPurchaseConditionProblem(choice.good));
  const selectedGoods = [good, ...chosenAdditions.flatMap((choice) => choice.good ? [choice.good] : [])];
  const noCommonPayment = !selectedGoods.every((item) => item.allowCardPayment !== false)
    && !selectedGoods.every((item) => item.allowBankTransfer !== false);
  const conditionProblem = goodsPurchaseConditionProblem(good)
    ?? (unavailableAddition ? `${unavailableAddition.name}의 판매 상태가 변경되었습니다. 추가 선택을 해제하고 다시 확인해주세요.` : null)
    ?? (noCommonPayment ? '함께 선택한 상품에서 사용할 수 있는 결제수단이 없습니다.' : null);
  const nextQuantity = mergedCartQuantity(selectedOption ? cart.getQuantity(good.id, selectedOption.id) : 0, quantity);
  const blocked = purchaseBlockReason({
    disabled: disabled || Boolean(conditionProblem),
    nextQuantity,
    pending: cart.pending,
    ready: cart.ready,
    soldOut,
    stockQty,
  });
  const inert = selectionRequired || (blocked !== null && blocked !== 'stock');

  const commit = async () => {
    if (!selectedOption || selectionRequired || committingRef.current) return false;
    committingRef.current = true;
    try {
      return await cart.addSelection(good.id, [
        { goodId: good.id, variantId: selectedOption.id, qty: quantity, stockQty },
        ...chosenAdditions.map((choice) => ({ goodId: choice.goodId, variantId: choice.selectedOption!.id,
          qty: choice.quantity, stockQty: choice.selectedOption!.stockQty })),
      ]);
    } finally { committingRef.current = false; }
  };

  return {
    good,
    selectedOption,
    selectionRequired,
    selectOption: (id: string) => {
      if (!good.options?.some(option => option.id === id && option.stockQty > 0)) return;
      setSelectedId(id); setQuantityState(1); setStatus(null);
    },
    quantity,
    setQuantity: (next: number) => {
      setStatus(null);
      setQuantityState(next);
    },
    subtotal: selectionRequired ? 0 : purchaseSubtotal(selectedOption?.price ?? good.price, quantity)
      + chosenAdditions.reduce((sum, choice) => sum + purchaseSubtotal(choice.selectedOption?.price ?? 0, choice.quantity), 0),
    soldOut,
    restockRequested,
    disabled,
    inert,
    /* 카트가 낸 오류가 먼저다 — 담기에 실패한 화면에 "담았어요"가 남으면 안 된다. */
    message: conditionProblem ?? cart.error ?? status,
    additionalChoices,
    toggleAdditional: (goodId, selected) => {
      setStatus(null);
      if (!selected) { setAdditionalSelections((items) => items.filter((item) => item.goodId !== goodId)); return; }
      const extra = additionalGoods.find((item) => item.id === goodId);
      if (!extra) return;
      setAdditionalSelections((items) => items.some((item) => item.goodId === goodId) ? items : [...items,
        { goodId, name: extra.name, variantId: initialGoodOption(extra)?.id, quantity: 1 }]);
    },
    selectAdditionalOption: (goodId, variantId) => {
      if (!additionalGoods.find((item) => item.id === goodId)?.options?.some((option) => option.id === variantId && option.stockQty > 0)) return;
      setStatus(null);
      setAdditionalSelections((items) => items.map((item) => item.goodId === goodId ? { ...item, variantId, quantity: 1 } : item));
    },
    setAdditionalQuantity: (goodId, next) => {
      setStatus(null);
      setAdditionalSelections((items) => items.map((item) => item.goodId === goodId ? { ...item, quantity: next } : item));
    },
    cartError: Boolean(cart.error),
    busy: cart.pending,
    unavailableLabel: preorderUnavailableLabel(good.options, soldOut),
    refreshCart: () => { setStatus(null); void cart.refresh(); },
    addToCart: () => {
      if (inert) return;
      setStatus(null);
      void commit().then((ok) => { if (ok) setStatus(CART_ADDED_STATUS); });
    },
    /* 바로구매는 장바구니 화면을 건너뛸 뿐이다. 담기와 같은 카트 계약을 거쳐
       기존 주문 경로(체크아웃 → placeOrderAction → place_order)로 들어간다.
       이동은 즉시 하지 않는다 — buyNowNavigation 이 카트 정착·오류를 본 뒤 결정한다. */
    buyNow: () => {
      if (inert) return;
      setStatus(null);
      void commit().then((ok) => { if (ok) setCheckoutGen((gen) => gen + 1); });
    },
  };
}

const CART_ICON = 'M3 5h2.2l2 9.2h9.1l1.9-6.9H6.6';

function CartGlyph() {
  return (
    <svg aria-hidden fill="none" height="20" viewBox="0 0 22 22" width="22">
      <path d={CART_ICON} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
      <circle cx="9" cy="18" fill="currentColor" r="1.4" />
      <circle cx="15.5" cy="18" fill="currentColor" r="1.4" />
    </svg>
  );
}

function AdditionalChoices({ purchase }: { purchase: GoodPurchaseController }) {
  if (!purchase.additionalChoices?.length) return null;
  return <section aria-label="추가상품" style={{ borderTop: '1px solid var(--wc-hairline)', marginTop: 20, paddingTop: 20 }}>
    <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>추가상품 <span style={{ fontWeight: 400 }}>(선택)</span></h3>
    <p className="wc-buy-panel__state">원하는 상품과 수량을 함께 담을 수 있습니다.</p>
    {purchase.additionalChoices.map((choice) => <fieldset key={choice.goodId} disabled={purchase.disabled || purchase.busy}
      style={{ minWidth: 0, border: 0, borderBottom: '1px solid var(--wc-hairline)', margin: 0, padding: '12px 0' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, lineHeight: 1.5 }}>
        <input type="checkbox" checked={choice.selected} style={{ marginTop: 4 }}
          onChange={(event) => purchase.toggleAdditional?.(choice.goodId, event.target.checked)} />
        <span>{choice.name}{choice.good ? ` · ${krw(choice.selectedOption?.price ?? choice.good.price)}${!choice.selectedOption && choice.good.priceMax && choice.good.priceMax > choice.good.price ? '부터' : ''}` : ' · 현재 구매 불가'}</span>
      </label>
      {choice.selected && choice.good ? <div style={{ marginTop: 12 }}>
        {(choice.good.options?.length ?? 0) > 1 ? <label className="wc-buy-panel__option">
          <span>{choice.name} 옵션</span>
          <select value={choice.selectedOption?.id ?? ''} onChange={(event) => purchase.selectAdditionalOption?.(choice.goodId, event.target.value)}>
            <option value="" disabled>옵션을 선택해주세요</option>
            {choice.good.options?.map((option) => <option key={option.id} value={option.id} disabled={option.stockQty <= 0}>
              {option.name} · {krw(option.price)}{preorderSupplyLabel(option.supply) ? ` · ${preorderSupplyLabel(option.supply)}` : option.stockQty <= 0 ? ' · 품절' : ''}
            </option>)}
          </select>
        </label> : optionLabel(choice.selectedOption, 1) ? <p className="wc-buy-panel__state">{choice.selectedOption?.name}</p> : null}
        {!choice.selectedOption && (choice.good.options?.length ?? 0) <= 1 ? <p className="wc-buy-panel__state">현재 구매할 수 없는 옵션입니다. 추가 선택을 해제해주세요.</p> : null}
        {choice.selectedOption?.supply?.mode === 'preorder' ? <p className="wc-buy-panel__state">예약판매 · {goodsShipDateLabel(choice.selectedOption.supply.expectedShipDate)}</p> : null}
        <div className="wc-buy-panel__row">
          <span>추가 수량</span>
          <QuantityStepper label={`${choice.name} 추가 수량`} max={Math.max(1, choice.selectedOption?.stockQty ?? 1)}
            value={choice.quantity} onChange={(next) => purchase.setAdditionalQuantity?.(choice.goodId, next)} />
        </div>
      </div> : null}
    </fieldset>)}
  </section>;
}

/** 정보 칼럼의 구매 패널. 품절이면 CTA 자리만 재입고 알림으로 바뀐다(R-04 §4). */
export function GoodPurchasePanel({ purchase }: { purchase: GoodPurchaseController }) {
  const { disabled, good, inert, message, quantity, restockRequested, selectedOption, selectOption, selectionRequired, setQuantity, soldOut, subtotal } = purchase;
  const stockLabel = purchase.unavailableLabel ?? STOCK_LABEL[good.stock];
  const singleOptionLabel = good.options?.length === 1 ? optionLabel(good.options[0], 1) : null;
  const displayOption = selectedOption ?? (good.options?.length === 1 ? good.options[0] : undefined);

  return (
    <div className="wc-buy-panel">
      {stockLabel ? <p className="wc-buy-panel__state">{stockLabel}</p> : null}
      {good.orderQuantityLimitEnabled && good.minOrderQty && good.maxOrderQty ? <p className="wc-buy-panel__state">같은 상품의 옵션을 합산하여 주문당 {good.minOrderQty.toLocaleString('ko-KR')}–{good.maxOrderQty.toLocaleString('ko-KR')}개 구매할 수 있습니다.</p> : null}
      {good.memberPurchaseLimitEnabled && good.memberLifetimeQtyLimit ? <p className="wc-buy-panel__state">회원 누적 최대 {good.memberLifetimeQtyLimit.toLocaleString('ko-KR')}개 · 결제 대기 주문 포함</p> : null}
      {(good.options?.length ?? 0) > 1 ? (
        <label className="wc-buy-panel__option">
          <span>옵션</span>
          <select disabled={disabled || purchase.busy} onChange={event => selectOption(event.target.value)} value={selectedOption?.id ?? ''}>
            <option value="" disabled>옵션을 선택해주세요</option>
            {good.options!.map(option => (
              <option key={option.id} value={option.id} disabled={option.stockQty <= 0}>
                {`${option.name} · ${krw(option.price)}${preorderSupplyLabel(option.supply) ? ` · ${preorderSupplyLabel(option.supply)}` : option.stockQty <= 0 ? ' · 품절' : ''}`}
              </option>
            ))}
          </select>
        </label>
      ) : singleOptionLabel ? <p className="wc-buy-panel__option">{singleOptionLabel}</p> : null}
      {displayOption?.supply?.mode === 'preorder' ? <p className="wc-buy-panel__state">예약판매 · 주문 시 결제 · {goodsShipDateLabel(displayOption.supply.expectedShipDate)}</p> : null}
      <div className="wc-buy-panel__row" inert={purchase.busy || undefined}>
        <span className="wc-buy-panel__label">수량</span>
        {/* 재고가 0인데 판매중인 데이터는 없다. 그래도 max 0 이면 스테퍼가 0에 잠겨
            수량을 고를 수 없는 컨트롤이 되므로 최소 1은 남긴다. */}
        <QuantityStepper max={Math.max(1, selectedOption?.stockQty ?? (good.options ? 0 : good.stockQty))} onChange={setQuantity} value={quantity} />
      </div>
      <AdditionalChoices purchase={purchase} />
      <div className="wc-buy-panel__total">
        <span className="wc-buy-panel__total-label">총 금액</span>
        <strong className="wc-buy-panel__total-amount">{selectionRequired ? '옵션 선택 후 표시' : krw(subtotal)}</strong>
      </div>
      {purchase.unavailableLabel ? <WcButton disabled variant="primary">{purchase.unavailableLabel}</WcButton> : soldOut ? (
        <RestockCta disabled={disabled} goodId={good.id} initialRequested={restockRequested} />
      ) : (
        <div className="wc-buy-panel__ctas">
          <WcButton className="wc-buy-panel__cart" disabled={inert} onClick={purchase.addToCart}>
            장바구니
          </WcButton>
          <WcButton className="wc-buy-panel__buy" disabled={inert} onClick={purchase.buyNow} variant="primary">
            구매하기
          </WcButton>
        </div>
      )}
      {/* 서버 확인 전에는 "완료"라고 하지 않는다(DESIGN §9) — 카트 저장이 끝난 뒤에만 채운다. */}
      <p aria-atomic="true" aria-live="polite" className="wc-buy-panel__status" role="status">
        {message ?? ''}
      </p>
      {purchase.cartError && purchase.refreshCart ? <WcButton disabled={purchase.busy} onClick={purchase.refreshCart}>장바구니 새로고침</WcButton> : null}
    </div>
  );
}

/**
 * 고정 구매바 2종.
 *
 * 모바일은 상시 노출 72px 바(R-04 §7.2), 데스크톱은 하부 탭 영역에서만 뜨는
 * 우하단 미니 바(§5.5)다. 레퍼런스의 모바일 바는 품절에도 "구매하기"로 남는
 * 상태 비반응 단일 버튼이지만(§10-7 결함), 여기서는 본문 CTA 와 같은 규칙으로
 * 재입고 알림으로 바뀐다.
 */
export function GoodBuyBars({
  miniVisible,
  purchase,
}: {
  miniVisible: boolean;
  purchase: GoodPurchaseController;
}) {
  const { disabled, good, inert, restockRequested, soldOut } = purchase;

  const actions = purchase.unavailableLabel ? <button className="wc-buybar__restock" type="button" disabled>{purchase.unavailableLabel}</button> : soldOut ? (
    <RestockCta className="wc-buybar__restock" disabled={disabled} goodId={good.id} initialRequested={restockRequested} />
  ) : (
    <>
      <button
        aria-label="장바구니에 담기"
        className="wc-buybar__cart"
        disabled={inert}
        onClick={purchase.addToCart}
        type="button"
      >
        <CartGlyph />
      </button>
      <button
        className="wc-buybar__buy"
        disabled={inert}
        onClick={purchase.buyNow}
        type="button"
      >
        구매하기
      </button>
    </>
  );

  return (
    <>
      <div className="wc-buybar">{actions}</div>
      {/* hidden 과 클래스를 함께 둔다 — 보조기기에서 사라지는 것과 화면에서 사라지는 것이
          같은 시점이어야 한다. */}
      <div className={`wc-buybar-mini${miniVisible ? ' is-visible' : ''}`} hidden={!miniVisible}>
        {purchase.unavailableLabel ? <button className="wc-buybar-mini__restock" type="button" disabled>{purchase.unavailableLabel}</button> : soldOut ? (
          <RestockCta className="wc-buybar-mini__restock" disabled={disabled} goodId={good.id} initialRequested={restockRequested} />
        ) : (
          <>
            <button
              aria-label="장바구니에 담기"
              className="wc-buybar-mini__cart"
              disabled={inert}
              onClick={purchase.addToCart}
              type="button"
            >
              <CartGlyph />
            </button>
            <button
              className="wc-buybar-mini__buy"
              disabled={inert}
              onClick={purchase.buyNow}
              type="button"
            >
              구매하기
            </button>
          </>
        )}
      </div>
    </>
  );
}
