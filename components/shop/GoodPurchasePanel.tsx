'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { useCart } from '@/components/shell/CartProvider';
import { RestockBellGlyph } from '@/components/shop/RestockBellGlyph';
import { RestockCta } from '@/components/shop/RestockCta';
import { QuantityStepper } from '@/components/wc/QuantityStepper';
import { WcButton } from '@/components/wc/WcButton';
import type { Good, GoodOption } from '@/lib/data';
import { defaultGoodOption, goodsPurchaseConditionProblem, initialGoodOption, isSelectableGoodOption, optionLabel, selectableGoodOptionId, soldOutPreviewPrice } from '@/lib/goods-options';
import { goodsAggregationUnavailableLabel } from '@/lib/goods-aggregation';
import { prepareGoodsCustomInputSelection } from '@/lib/goods-custom-inputs';
import { GoodsCustomInputsFields } from './GoodsCustomInputs';
import { krw } from '@/lib/format';
import { goodsShipDateLabel, preorderSupplyLabel, preorderUnavailableLabel } from '@/lib/goods-preorders';
import { goodsSaleUnavailableLabel } from '@/lib/goods-sale-period';
import { goodsPurchaseVolumePreview } from '@/lib/goods-transaction-presentation';
import { GoodsTransactionTerms } from './GoodsTransactionTerms';
import { FULFILLMENT_METHOD_LABELS } from '@/lib/goods-fulfillment';
import { GiftPurchaseEntry } from '@/components/gifts/GiftPurchaseEntry';
import { SubscriptionPurchaseEntry } from '@/components/subscriptions/SubscriptionPurchaseEntry';
import type { AddToCartResultItem } from './AddToCartResultDialog';

/*
 * 굿즈 상세의 구매 블록 (R-04 §3.6~3.8 · DESIGN `pdp-buybox`·`cta-pair`·`restock-cta`).
 *
 * 첫 선택은 첫 구매 가능 옵션이고, 품절 옵션도 `· 품절`로 고를 수 있다 — 고르면 CTA 가 그 옵션의
 * 재입고 알림으로 바뀐다(PD-10 · LD-5). 모든 옵션이 품절이면 첫 옵션을 고른 채 열고 CTA 는 굿즈 단위
 * 재입고 알림이다.
 * 상태는 이 훅 하나가 갖고, 정보 칼럼 패널과 고정 구매바가 같은 컨트롤러를 나눠 쓴다.
 * 두 표면이 각자 수량을 들면 아래 바로 산 개수와 위에서 고른 개수가 갈린다.
 *
 * 금액·재고의 최종 판정은 언제나 서버다. 여기 계산은 "지금 담으면 얼마인가"를
 * 미리 보여 주기 위한 표시용 파생이고, 본품과 추가굿즈는 한 번의 카트
 * 반영을 거쳐 기존 place_order의 가격·수량·재고 판정을 통과한다.
 */

export const CART_ADDED_STATUS = '장바구니에 담았어요.';

/** 품절 판정은 재고 수량이 아니라 판매 상태다 — 운영자가 내린 굿즈는 수량과 무관하다. */
export function isGoodSoldOut(good: Pick<Good, 'stock'>) {
  return good.stock === 'soldout';
}

/** 모바일 바가 구매 시트를 열 수 있는가 — 판매 불가면 비활성 안내, 품절이면 재입고 알림이 바를 대신한다. */
export function purchaseSheetAvailable(purchase: Pick<GoodPurchaseController, 'unavailableLabel' | 'soldOut'>): boolean {
  return !purchase.unavailableLabel && !purchase.soldOut;
}

/** 정기배송·선물 진입 가용성. 굿즈 상세가 한 번 묻고 본문 패널·구매 시트에 같은 값을 내린다. */
export interface OtherPurchaseAvailability {
  subscription: boolean;
  gift: boolean;
}

function optionAvailabilitySuffix(good: Good, option: GoodOption) {
  const label = goodsSaleUnavailableLabel(good.salePeriod) ?? preorderSupplyLabel(option.supply) ?? (option.stockQty <= 0 ? '품절' : null);
  return label ? ` · ${label}` : '';
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
  /** 담기·구매할 선택 — 지금 살 수 있는 옵션만 여기에 온다. */
  selectedOption: GoodOption | undefined;
  /** 고른 옵션이 재고만 떨어진 품절 옵션이면 그 옵션 — 재입고 알림 대상이다(PD-10). 담기·구매 대상이 아니다. */
  restockOption?: GoodOption;
  selectOption: (id: string) => void;
  selectionRequired: boolean;
  quantity: number;
  setQuantity: (next: number) => void;
  subtotal: number;
  volumeDiscountTotal?: number;
  soldOut: boolean;
  /** 굿즈 단위(모든 옵션) 재입고 알림이 대기 중인가. */
  restockRequested: boolean;
  /** 옵션 단위 재입고 알림이 대기 중인 옵션 id(PD-11). */
  restockVariantIds?: readonly string[];
  disabled: boolean;
  inert: boolean;
  message: string | null;
  addToCart: () => void;
  buyNow: () => void;
  additionalChoices?: AdditionalPurchaseChoice[];
  toggleAdditional?: (goodId: string, selected: boolean) => void;
  selectAdditionalOption?: (goodId: string, variantId: string) => void;
  setAdditionalQuantity?: (goodId: string, quantity: number) => void;
  customInputValues?: Record<string,Record<string,string>>;
  setCustomInputValue?: (goodId:string,fieldId:string,value:string)=>void;
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
  restockVariantIds = [],
  initialVariantId,
}: {
  disabled?: boolean;
  good: Good;
  additionalGoods?: readonly Good[];
  restockRequested?: boolean;
  restockVariantIds?: readonly string[];
  /** 주소의 `?variant=`(PD-14). 지금 고를 수 있는 옵션(재입고 알림을 받을 품절 옵션 포함)일 때만 첫 선택이 된다. */
  initialVariantId?: string | null;
}): GoodPurchaseController {
  const router = useRouter();
  const cart = useCart();
  const [quantity, setQuantityState] = useState(1);
  const [customInputValues,setCustomInputValues] = useState<Record<string,Record<string,string>>>({});
  const [selectedId, setSelectedId] = useState(() => selectableGoodOptionId(good, initialVariantId) ?? defaultGoodOption(good)?.id);
  /* 고른 옵션(PD-10 · LD-5). 살 수 있으면 selectedOption(담기·구매 대상), 재고만 떨어졌으면 restockOption
     (재입고 알림 대상)이다. 담기·구매는 selectedOption 만 본다 — 품절 옵션을 골라도 선택이 비어 있는 것과
     같아서 inert 이고 commit 이 거절한다. 새로고침으로 재고가 바뀌면 같은 옵션이 두 자리를 오간다. */
  const chosenOption = good.options?.find(option => option.id === selectedId && isSelectableGoodOption(option))
    ?? (selectedId === undefined ? defaultGoodOption(good) : undefined);
  const selectedOption = chosenOption && chosenOption.stockQty > 0 ? chosenOption : undefined;
  const restockOption = chosenOption && chosenOption.stockQty <= 0 ? chosenOption : undefined;
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
    ?? (noCommonPayment ? '함께 선택한 굿즈에서 사용할 수 있는 결제수단이 없습니다.' : null);
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
    const selections = new Map(selectedGoods.map(item=>[item.id,prepareGoodsCustomInputSelection(item.customInputs,customInputValues[item.id] ?? {})]));
    for (const item of selectedGoods) {
      const prepared=selections.get(item.id)!;
      if (!prepared.ok) {setStatus(`${item.name}: ${prepared.error}`);return false;}
    }
    const inputsFor=(id:string)=>{const prepared=selections.get(id)!;return prepared.ok && prepared.selection ? {customInputs:prepared.selection} : {};};
    committingRef.current = true;
    try {
      return await cart.addSelection(good.id, [
        { goodId: good.id, variantId: selectedOption.id, qty: quantity, stockQty, ...inputsFor(good.id) },
        ...chosenAdditions.map((choice) => ({ goodId: choice.goodId, variantId: choice.selectedOption!.id,
          qty: choice.quantity, stockQty: choice.selectedOption!.stockQty, ...inputsFor(choice.goodId) })),
      ]);
    } finally { committingRef.current = false; }
  };

  const volumePreview = selectionRequired ? null : goodsPurchaseVolumePreview([{ good, option: selectedOption, quantity },
    ...chosenAdditions.flatMap(choice => choice.good ? [{ good: choice.good, option: choice.selectedOption, quantity: choice.quantity }] : [])]);
  return {
    good,
    selectedOption,
    restockOption,
    selectionRequired,
    selectOption: (id: string) => {
      if (!good.options?.some(option => option.id === id && isSelectableGoodOption(option))) return;
      setSelectedId(id); setQuantityState(1); setStatus(null);
    },
    quantity,
    setQuantity: (next: number) => {
      setStatus(null);
      setQuantityState(next);
    },
    subtotal: selectionRequired ? 0 : volumePreview?.netSubtotal
      ?? (purchaseSubtotal(selectedOption?.price ?? good.price, quantity) + chosenAdditions.reduce((sum, choice) => sum + purchaseSubtotal(choice.selectedOption?.price ?? 0, choice.quantity), 0)),
    volumeDiscountTotal: volumePreview?.volumeDiscountTotal,
    soldOut,
    restockRequested,
    restockVariantIds,
    disabled,
    inert,
    /* 카트가 낸 오류가 먼저다 — 담기에 실패한 화면에 "담았어요"가 남으면 안 된다. */
    message: conditionProblem ?? cart.error ?? status,
    additionalChoices,
    customInputValues,
    setCustomInputValue:(goodId,fieldId,value)=>{setStatus(null);setCustomInputValues(current=>({...current,[goodId]:{...current[goodId],[fieldId]:value}}));},
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
    unavailableLabel: goodsAggregationUnavailableLabel(good) ?? goodsSaleUnavailableLabel(good.salePeriod) ?? preorderUnavailableLabel(good.options, soldOut),
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

/**
 * 담기 결과 모달을 여는 시점 (PD-02).
 *
 * 담기 함수는 카트 반영이 확정된 뒤에만 성공 문구(CART_ADDED_STATUS)를 남기고, 실패는 카트·검증
 * 오류 문구를 남긴다. 그래서 "담기를 누른 뒤 성공 문구가 온 때"만 열고, 다른 문구가 오면
 * 기다림을 접는다 — 클라이언트 낙관 상태로 "담았어요"를 띄우지 않는다(DESIGN §9).
 */
export function addToCartResultStep(state: { awaiting: boolean; message: string | null }): 'idle' | 'wait' | 'open' | 'fail' {
  if (!state.awaiting) return 'idle';
  if (state.message === CART_ADDED_STATUS) return 'open';
  return state.message ? 'fail' : 'wait';
}

/** 지금 담기를 누르면 카트에 들어갈 줄. 담기 함수와 같은 선택(본품 + 고른 추가 구성)을 요약한다. */
export function addedCartItems(purchase: Pick<GoodPurchaseController, 'good' | 'selectedOption' | 'quantity' | 'additionalChoices'>): AddToCartResultItem[] {
  return [
    { name: purchase.good.name, option: optionLabel(purchase.selectedOption, purchase.good.options?.length ?? 0), quantity: purchase.quantity },
    ...(purchase.additionalChoices ?? [])
      .filter((choice) => choice.selected && choice.selectedOption)
      .map((choice) => ({ name: choice.name, option: optionLabel(choice.selectedOption, choice.good?.options?.length ?? 0), quantity: choice.quantity })),
  ];
}

/**
 * 담기 결과 모달 상태. 컨트롤러의 담기 함수는 그대로 부르고, 누른 순간의 선택만 따로 들고
 * 있다가 성공 문구가 오면 그 요약으로 모달을 연다. 패널·데스크톱 레일 박스·모바일 시트가
 * 이 훅이 감싼 담기 하나를 함께 쓴다.
 */
export function useAddToCartResult(purchase: GoodPurchaseController) {
  const [awaitingItems, setAwaitingItems] = useState<AddToCartResultItem[] | null>(null);
  const [items, setItems] = useState<AddToCartResultItem[] | null>(null);
  /* 렌더 중 상태 보정(이전 값 비교 패턴) — effect 로 미루면 모달이 한 프레임 늦게 뜬다. */
  const step = addToCartResultStep({ awaiting: awaitingItems !== null, message: purchase.message });
  if (step === 'open') {
    setItems(awaitingItems);
    setAwaitingItems(null);
  } else if (step === 'fail') {
    setAwaitingItems(null);
  }

  return {
    items,
    close: () => setItems(null),
    addToCart: () => {
      if (purchase.inert) return;
      setAwaitingItems(addedCartItems(purchase));
      purchase.addToCart();
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
  return <section aria-label="추가 구성 굿즈" style={{ borderTop: '1px solid var(--wc-hairline)', marginTop: 20, paddingTop: 20 }}>
    <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>추가 구성 굿즈 <span style={{ fontWeight: 400 }}>(선택)</span></h3>
    <p className="wc-buy-panel__state">원하는 굿즈와 수량을 함께 담을 수 있습니다.</p>
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
              {option.name} · {krw(option.price)}{optionAvailabilitySuffix(choice.good!, option)}
            </option>)}
          </select>
        </label> : optionLabel(choice.selectedOption, 1) ? <p className="wc-buy-panel__state">{choice.selectedOption?.name}</p> : null}
        {!choice.selectedOption && (choice.good.options?.length ?? 0) <= 1 ? <p className="wc-buy-panel__state">현재 구매할 수 없는 옵션입니다. 추가 선택을 해제해주세요.</p> : null}
        {choice.selectedOption?.supply?.mode === 'preorder' ? <p className="wc-buy-panel__state">예약판매 · {goodsShipDateLabel(choice.selectedOption.supply.expectedShipDate)}</p> : null}
        <GoodsCustomInputsFields goodId={choice.goodId} config={choice.good.customInputs} values={purchase.customInputValues?.[choice.goodId]} disabled={purchase.disabled || purchase.busy} onChange={(id,value)=>purchase.setCustomInputValue?.(choice.goodId,id,value)} />
        <div className="wc-buy-panel__row">
          <span>추가 수량</span>
          <QuantityStepper label={`${choice.name} 추가 수량`} max={Math.max(1, choice.selectedOption?.stockQty ?? 1)}
            value={choice.quantity} onChange={(next) => purchase.setAdditionalQuantity?.(choice.goodId, next)} />
        </div>
      </div> : null}
    </fieldset>)}
  </section>;
}

export interface PurchaseTotalDisplay {
  label: string;
  amount: string;
  /** 금액이 아니라 안내 문구(옵션 선택 전·판매 상태)면 false — 큰 금액 서체를 쓰지 않는다. */
  numeric: boolean;
}

/**
 * 합계 행의 라벨·값. 본문 패널과 데스크톱 레일 박스가 같은 값을 보인다.
 * 고른 품절 옵션(모든 옵션이 품절이면 첫 옵션이 고른 채 열린다)은 그 옵션 가격이고, 고를 옵션이 없는
 * 품절 굿즈도 "옵션 선택 후 표시" 대신 가격으로 합계를 보인다(PD-08).
 */
export function purchaseTotalDisplay(purchase: Pick<GoodPurchaseController, 'good' | 'unavailableLabel' | 'selectionRequired' | 'subtotal' | 'soldOut' | 'quantity' | 'restockOption'>): PurchaseTotalDisplay {
  const label = purchase.unavailableLabel ? '판매 상태' : purchase.good.transactionOffer ? '예상 굿즈 금액' : '총 금액';
  if (purchase.unavailableLabel) return { label, amount: purchase.unavailableLabel, numeric: false };
  /* 고른 품절 옵션은 그 옵션 가격으로 합계를 보인다(레퍼런스도 품절 옵션을 고른 채 합계를 보인다, 11 §6 B9). */
  if (purchase.restockOption) return { label, amount: krw(purchaseSubtotal(purchase.restockOption.price, purchase.quantity)), numeric: true };
  if (purchase.selectionRequired && purchase.soldOut) {
    return { label, amount: krw(purchaseSubtotal(soldOutPreviewPrice(purchase.good), purchase.quantity)), numeric: true };
  }
  if (purchase.selectionRequired) return { label, amount: '옵션 선택 후 표시', numeric: false };
  return { label, amount: krw(purchase.subtotal), numeric: true };
}

export type PurchaseCtaState =
  | { kind: 'unavailable'; label: string }
  | { kind: 'restock'; variantId: string | null; optionName: string | null; requested: boolean }
  | { kind: 'buy' };

/**
 * CTA 자리에 무엇을 둘지 (PD-10 · DESIGN `restock-cta`). 본문 패널(모바일 시트 안 포함)과 데스크톱 레일
 * 박스가 같은 판정을 쓴다. 판매 불가 안내 → 굿즈 전체 품절(굿즈 단위 = 모든 옵션 재입고 알림, 현행 규칙)
 * → 고른 옵션만 품절(그 옵션의 재입고 알림) → 담기·구매 순이다.
 */
export function purchaseCtaState(purchase: Pick<GoodPurchaseController, 'good' | 'unavailableLabel' | 'soldOut' | 'restockRequested' | 'restockOption' | 'restockVariantIds'>): PurchaseCtaState {
  if (purchase.unavailableLabel) return { kind: 'unavailable', label: purchase.unavailableLabel };
  if (purchase.soldOut) return { kind: 'restock', variantId: null, optionName: null, requested: purchase.restockRequested };
  if (purchase.restockOption) {
    return {
      kind: 'restock',
      variantId: purchase.restockOption.id,
      optionName: optionLabel(purchase.restockOption, purchase.good.options?.length ?? 0),
      requested: purchase.restockVariantIds?.includes(purchase.restockOption.id) ?? false,
    };
  }
  return { kind: 'buy' };
}

/**
 * 그 사이 바뀐 판매 상태로 재입고 신청이 거절된 뒤(RestockCta 의 onStaleState) 그 버튼을 둔 표면이 할 일.
 *
 * RestockCta 가 화면을 다시 받으면 신청 버튼 자리가 담기·구매로 바뀌며 버튼이 사라진다. 그 버튼에 있던 포커스는
 * body(구매 시트 안이면 다이얼로그 밖)로 빠지므로, CTA 가 바뀐 뒤에도 포커스를 잃은 채면 같은 표면의 새 CTA 로
 * 옮긴다(앞 선택자부터). 사용자가 이미 다른 곳에 포커스를 두었으면 건드리지 않는다. 이유 문구는 사라지는 버튼이
 * 아니라 이 표면에 남는 상태 줄이 든다.
 */
export function useRestockStaleState(rootRef: RefObject<HTMLElement | null>, ctaKind: PurchaseCtaState['kind'], focusSelectors: readonly string[]) {
  const handoffRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selectors = focusSelectors.join('\n');
  useEffect(() => {
    if (!handoffRef.current || ctaKind === 'restock') return;
    handoffRef.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    for (const selector of selectors.split('\n')) {
      const target = rootRef.current?.querySelector<HTMLElement>(selector);
      if (target) {
        target.focus();
        return;
      }
    }
  }, [ctaKind, rootRef, selectors]);

  return {
    notice,
    onStale: (text: string) => {
      handoffRef.current = true;
      setNotice(text);
    },
    clear: () => setNotice(null),
  };
}

const PANEL_CTA_FOCUS = ['.wc-buy-panel__ctas button:not([disabled])', 'select:not([disabled])'] as const;
const RAIL_CTA_FOCUS = ['.wc-pdp-railbox__ctas button:not([disabled])', 'button:not([disabled])'] as const;
const BAR_CTA_FOCUS = ['button:not([disabled])'] as const;
/* 시트를 연 바 버튼이 사라졌을 때 대신 받을 바 버튼 — 주 버튼(구매하기·재입고 알림)을 먼저, 없으면 바의 다른 버튼이다. */
const BAR_SHEET_RETURN_FOCUS = ['.wc-buybar__buy:not([disabled])', '.wc-buybar__restock button:not([disabled])', 'button:not([disabled])'] as const;

/**
 * 모바일 바의 시트 트리거가 시트가 열린 동안 바뀌었을 때의 포커스 복귀.
 *
 * 바는 고른 옵션의 품절 여부에 따라 [카트][구매하기]와 벨 트리거를 서로 다른 버튼으로 갈아 끼운다 — 시트 안에서 옵션을
 * 바꾸거나 그 사이 재입고로 화면을 다시 받으면 시트를 연 버튼이 문서에서 빠진다. 시트의 포커스 복귀(useOverlayA11y)는
 * 빠진 버튼을 겨눠 아무 일도 하지 않고 포커스는 body 로 떨어진다(다음 Tab 이 문서 맨 앞으로 간다). 그래서 시트가 닫힌 뒤
 * 연 버튼이 빠졌고 포커스를 잃은 채면 그 자리를 대신한 바 버튼으로 옮긴다 — 카트로 열었으면 새 카트, 아니면 주 버튼이다.
 * 연 버튼이 남아 있으면 시트가 원래대로 그 버튼으로 돌려주므로 건드리지 않는다.
 *
 * effect 는 시트의 정리(배경 inert 해제·포커스 복귀) 뒤에 돈다 — 한 커밋의 effect 정리는 모두 새 effect 보다 먼저다.
 * 같은 커밋에 담기 결과 모달이 뜨면(시트에서 담기 성공) 바가 모달 포털보다 앞 형제라 이 effect 가 모달의 effect 보다
 * 먼저 돌고, 모달은 여기서 옮긴 버튼을 복귀 대상으로 기억한다.
 */
export function useSheetTriggerFocusReturn(barRef: RefObject<HTMLElement | null>, sheetOpen: boolean) {
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (sheetOpen) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener || opener.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const selectors = opener.classList.contains('wc-buybar__cart') ? ['.wc-buybar__cart:not([disabled])', ...BAR_SHEET_RETURN_FOCUS] : BAR_SHEET_RETURN_FOCUS;
    for (const selector of selectors) {
      const target = barRef.current?.querySelector<HTMLElement>(selector);
      if (target) {
        target.focus();
        return;
      }
    }
  }, [barRef, sheetOpen]);
  return (event: MouseEvent<HTMLElement>) => {
    openerRef.current = event.currentTarget;
  };
}

/** 정보 칼럼의 구매 패널. 품절이면(고른 옵션만 품절이어도) CTA 자리만 재입고 알림으로 바뀐다(R-04 §4). */
export function GoodPurchasePanel({ otherPurchases, purchase }: { otherPurchases?: OtherPurchaseAvailability; purchase: GoodPurchaseController }) {
  const { disabled, good, inert, message, quantity, restockOption, selectedOption, selectOption, setQuantity } = purchase;
  const total = purchaseTotalDisplay(purchase);
  const cta = purchaseCtaState(purchase);
  const panelRef = useRef<HTMLDivElement>(null);
  const stale = useRestockStaleState(panelRef, cta.kind, PANEL_CTA_FOCUS);
  /* 재입고 거절 안내는 상태 줄의 다음 문구(담기·검증·카트 오류)가 오면 물러난다 — 렌더 중 이전 값 비교로 지운다. */
  const [noticeMessage, setNoticeMessage] = useState(message);
  if (noticeMessage !== message) {
    setNoticeMessage(message);
    if (stale.notice) stale.clear();
  }
  const singleOptionLabel = good.options?.length === 1 ? optionLabel(good.options[0], 1) : null;
  const displayOption = selectedOption ?? (good.options?.length === 1 ? good.options[0] : undefined);
  const chosenOption = selectedOption ?? restockOption;

  return (
    <div className="wc-buy-panel" ref={panelRef}>
      {/* 판매 기간·예약 접수 같은 판매 상태만 글로 먼저 알린다. '품절임박/품절' 재고 라벨은 두지 않는다(PD-12) —
          운영자가 고르는 재고 표시라 실재고와 연동되지 않고(표시광고법 '품절임박' 실재고 연동 요건,
          docs/online-popup/01-report.md), 품절은 재입고 알림 CTA 가 글로 대신 말한다. */}
      {purchase.unavailableLabel ? <p className="wc-buy-panel__state">{purchase.unavailableLabel}</p> : null}
      {good.orderQuantityLimitEnabled && good.minOrderQty && good.maxOrderQty ? <p className="wc-buy-panel__state">{good.transactionOffer?.aggregation ? '같은 굿즈에서 나뉜 항목을' : '같은 굿즈의 옵션을'} 합산하여 주문당 {good.minOrderQty.toLocaleString('ko-KR')}–{good.maxOrderQty.toLocaleString('ko-KR')}개 구매할 수 있습니다.</p> : null}
      {good.memberPurchaseLimitEnabled && good.memberLifetimeQtyLimit ? <p className="wc-buy-panel__state">회원 누적 최대 {good.memberLifetimeQtyLimit.toLocaleString('ko-KR')}개 · 결제 대기 주문 포함</p> : null}
      {(good.options?.length ?? 0) > 1 ? (
        <label className="wc-buy-panel__option">
          <span>옵션</span>
          {/* 품절 옵션도 `· 품절`로 고를 수 있다 — 고르면 CTA 가 그 옵션의 재입고 알림이다(PD-10). 닫힌 예약판매
              옵션처럼 재입고 알림 대상이 아닌 옵션만 고르지 못한다. 첫 선택이 늘 있으므로(defaultGoodOption) 빈
              옵션(placeholder)은 고른 옵션이 없을 때만 둔다 — 새로고침으로 고른 옵션이 사라졌거나 고를 수 있는 옵션이
              하나도 없을 때다(R-04 §3.5, 레퍼런스에는 빈 옵션 행이 없다). */}
          <select disabled={disabled || purchase.busy} onChange={event => { stale.clear(); selectOption(event.target.value); }} value={chosenOption?.id ?? ''}>
            {chosenOption ? null : <option value="" disabled>옵션을 선택해주세요</option>}
            {good.options!.map(option => (
              <option key={option.id} value={option.id} disabled={!isSelectableGoodOption(option)}>
                {`${option.name} · ${krw(option.price)}${optionAvailabilitySuffix(good, option)}`}
              </option>
            ))}
          </select>
        </label>
      ) : singleOptionLabel ? <p className="wc-buy-panel__option">{singleOptionLabel}</p> : null}
      {displayOption?.supply?.mode === 'preorder' ? <p className="wc-buy-panel__state">예약판매 · 주문 시 결제 · {goodsShipDateLabel(displayOption.supply.expectedShipDate)}</p> : null}
      <GoodsCustomInputsFields goodId={good.id} config={good.customInputs} values={purchase.customInputValues?.[good.id]} disabled={disabled || purchase.busy} onChange={(id,value)=>purchase.setCustomInputValue?.(good.id,id,value)} />
      <div className="wc-buy-panel__row" inert={purchase.busy || undefined}>
        <span className="wc-buy-panel__label">수량</span>
        {/* 재고가 0인데 판매중인 데이터는 없다. 그래도 max 0 이면 스테퍼가 0에 잠겨
            수량을 고를 수 없는 컨트롤이 되므로 최소 1은 남긴다. */}
        <QuantityStepper max={Math.max(1, selectedOption?.stockQty ?? (good.options ? 0 : good.stockQty))} onChange={setQuantity} value={quantity} />
      </div>
      <AdditionalChoices purchase={purchase} />
      <GoodsTransactionTerms good={good} quantity={quantity} />
      {(purchase.additionalChoices ?? []).filter(choice => choice.selected && choice.good).map(choice => <GoodsTransactionTerms key={choice.goodId} good={choice.good!} quantity={choice.quantity} />)}
      {purchase.volumeDiscountTotal ? <p className="wc-buy-panel__state">선택 굿즈 복수구매 할인 예상 −{krw(purchase.volumeDiscountTotal)}</p> : null}
      <div className="wc-buy-panel__total">
        <span className="wc-buy-panel__total-label">{total.label}</span>
        <strong className="wc-buy-panel__total-amount">{total.amount}</strong>
      </div>
      {good.transactionOffer?.fulfillment ? <div className="wc-buy-panel__state"><p>제공 방식: {good.transactionOffer.fulfillment.methods.map(m => FULFILLMENT_METHOD_LABELS[m.method]).join(' · ')}</p>
        <p>{good.transactionOffer.fulfillment.publicNote}</p>{good.transactionOffer.fulfillment.mode === 'digital' ? <p>결제한 계정에서 구매한 파일을 받습니다. 파일 제공 후 취소 요청은 담당자가 검토합니다. 디지털 굿즈의 선물하기는 제공하지 않습니다.</p> : null}</div> : null}
      {good.transactionOffer ? <p className="wc-buy-panel__state">현재 선택한 굿즈 기준입니다. 장바구니 수량·쿠폰·적립금·배송비를 반영한 결제 금액은 주문서에서 확인해주세요.</p> : null}
      {cta.kind === 'unavailable' ? <WcButton disabled variant="primary">{cta.label}</WcButton> : cta.kind === 'restock' ? (
        <RestockCta disabled={disabled} goodId={good.id} initialRequested={cta.requested} onStaleState={stale.onStale} optionName={cta.optionName} variantId={cta.variantId} />
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
      {!disabled ? <div className="wc-buy-panel__other-purchases"><SubscriptionPurchaseEntry available={otherPurchases?.subscription} goodId={good.id} />{good.transactionOffer?.fulfillment?.mode !== 'digital' ? <GiftPurchaseEntry available={otherPurchases?.gift} /> : null}</div> : null}
      {/* 서버 확인 전에는 "완료"라고 하지 않는다(DESIGN §9) — 카트 저장이 끝난 뒤에만 채운다. 재입고 신청이 바뀐
          판매 상태로 거절되면 그 이유도 여기 남는다(신청 버튼은 담기·구매로 바뀌며 사라진다). */}
      <p aria-atomic="true" aria-live="polite" className="wc-buy-panel__status" role="status">
        {stale.notice ?? message ?? ''}
      </p>
      {purchase.cartError && purchase.refreshCart ? <WcButton disabled={purchase.busy} onClick={purchase.refreshCart}>장바구니 새로고침</WcButton> : null}
    </div>
  );
}

/**
 * 모바일 고정 구매바 (R-04 §7.2 · DESIGN `mobile-buybar`).
 *
 * 72px 잉크 풀폭 바의 [장바구니]·[구매하기]는 구매 시트를 여는 트리거다(PD-01) — 실행은 시트 안
 * CTA 가 한다. 그래서 옵션을 아직 고르지 않았거나 카트가 준비 중이어도 잠그지 않는다. 잠그면
 * 다옵션 굿즈는 옵션을 고를 길이 없는 비활성 바만 남는다. 레퍼런스의 바는 품절에도 "구매하기"로
 * 남는 상태 비반응 버튼이지만(§10-7 결함 — 재현하지 않는다), 여기서는 바가 상태를 말한다. 모든 옵션이
 * 품절이면 바 전체가 굿즈 단위 재입고 알림이다. 고른 옵션만 품절이면(PD-10) 바는 벨 + '재입고 알림'으로
 * 바뀌되 여전히 시트 트리거다 — 시트에서 그 옵션의 재입고 알림을 신청하거나 다른 옵션을 고른다. 고른
 * 옵션은 담을 수 없으니 카트 존은 두지 않는다(로그인 뒤 그 옵션으로 돌아와도 바에서 이어서 신청할 길이 보인다).
 */
export function GoodBuyBars({
  onOpenSheet,
  purchase,
  sheetOpen,
}: {
  onOpenSheet: () => void;
  purchase: GoodPurchaseController;
  sheetOpen: boolean;
}) {
  const { disabled, good, restockRequested, soldOut } = purchase;
  const cta = purchaseCtaState(purchase);
  /* 바에서 직접 신청하는 버튼(RestockCta)은 모든 옵션 품절일 때뿐이다 — 고른 옵션만 품절일 때의 벨은 시트 트리거다. */
  const barRef = useRef<HTMLDivElement>(null);
  const stale = useRestockStaleState(barRef, purchase.unavailableLabel ? 'unavailable' : soldOut ? 'restock' : 'buy', BAR_CTA_FOCUS);
  /* 시트에서 옵션을 바꾸면 이 바의 트리거가 다른 버튼으로 바뀐다 — 닫을 때 포커스를 그 자리의 새 버튼으로 돌린다. */
  const rememberOpener = useSheetTriggerFocusReturn(barRef, sheetOpen);
  const openSheet = (event: MouseEvent<HTMLButtonElement>) => {
    rememberOpener(event);
    onOpenSheet();
  };

  return (
    <div className="wc-buybar" ref={barRef}>
      {purchase.unavailableLabel ? <button className="wc-buybar__buy" type="button" disabled>{purchase.unavailableLabel}</button> : soldOut ? (
        <RestockCta className="wc-buybar__restock" compact disabled={disabled} goodId={good.id} initialRequested={restockRequested} onStaleState={stale.onStale} />
      ) : cta.kind === 'restock' ? (
        <div className="wc-restock-cta wc-buybar__restock">
          <button
            aria-expanded={sheetOpen}
            aria-haspopup="dialog"
            className="wc-btn primary"
            disabled={disabled}
            onClick={openSheet}
            type="button"
          >
            <RestockBellGlyph />
            {cta.optionName ? <span className="wc-sr-only">{`${cta.optionName} 옵션 `}</span> : null}
            {cta.requested ? '재입고 알림 신청됨' : '재입고 알림 받기'}
          </button>
        </div>
      ) : (
        <>
          <button
            aria-expanded={sheetOpen}
            aria-haspopup="dialog"
            aria-label="장바구니에 담기"
            className="wc-buybar__cart"
            disabled={disabled}
            onClick={openSheet}
            type="button"
          >
            <CartGlyph />
          </button>
          <button
            aria-expanded={sheetOpen}
            aria-haspopup="dialog"
            className="wc-buybar__buy"
            disabled={disabled}
            onClick={openSheet}
            type="button"
          >
            구매하기
          </button>
        </>
      )}
      <p aria-atomic="true" aria-live="polite" className="wc-sr-only" role="status">{stale.notice ?? ''}</p>
    </div>
  );
}

/**
 * 데스크톱 레일 박스 (PD-03·PD-05 · 11 §3 Δ3 · §6 B15 · DESIGN `floating-buybar`).
 *
 * 하부 탭 섹션 우측 340 레일 안에서 화면 하단 근처에 붙어 있는 회색 박스다. 레일 안 sticky 라
 * 탭 섹션 범위에서만 보인다. 예전의 뷰포트 고정 미니 바는 짧은 상세에서 첫 화면부터 본문 CTA 와
 * 겹치고 문의 런처·푸터를 덮어 없앴다. 합계는 본문 패널과 같은 값이고, 담기·구매는 같은
 * 컨트롤러 함수를 부른다(담기 결과 모달도 같다).
 */
export function GoodRailBuyBox({ purchase }: { purchase: GoodPurchaseController }) {
  const { disabled, good, inert } = purchase;
  const total = purchaseTotalDisplay(purchase);
  const cta = purchaseCtaState(purchase);
  /* 실패 문구는 정보 칼럼 패널의 상태 줄(live region 하나)에만 나온다. 레일에서 누른 담기·구매가 실패하면
     박스 근처에는 아무 변화가 없으므로, 고칠 칸(빈 필수 입력 등)이나 그 상태 줄로 데려간다. 성공은
     담기 결과 모달·주문서 이동이 알린다. 렌더 중 상태 보정은 useAddToCartResult 와 같은 패턴이다. */
  const [awaiting, setAwaiting] = useState(false);
  const [revealCount, setRevealCount] = useState(0);
  const step = addToCartResultStep({ awaiting, message: purchase.message });
  if (step === 'open' || step === 'fail') {
    setAwaiting(false);
    if (step === 'fail') setRevealCount((count) => count + 1);
  }
  useEffect(() => {
    if (revealCount > 0) revealPurchasePanel();
  }, [revealCount]);
  const fromRail = (action: () => void) => () => {
    setAwaiting(true);
    action();
  };
  const railRef = useRef<HTMLElement>(null);
  const stale = useRestockStaleState(railRef, cta.kind, RAIL_CTA_FOCUS);

  return (
    <section aria-label="빠른 구매" className="wc-pdp-railbox" ref={railRef}>
      <div className="wc-pdp-railbox__total">
        <span className="wc-pdp-railbox__label">{total.label}</span>
        <strong className={`wc-pdp-railbox__amount${total.numeric ? '' : ' is-note'}`}>{total.amount}</strong>
      </div>
      {cta.kind === 'unavailable' ? <button className="wc-pdp-railbox__buy is-full" disabled type="button">{cta.label}</button> : cta.kind === 'restock' ? (
        <RestockCta className="wc-pdp-railbox__restock" compact disabled={disabled} goodId={good.id} initialRequested={cta.requested} onStaleState={stale.onStale} optionName={cta.optionName} variantId={cta.variantId} />
      ) : (
        <div className="wc-pdp-railbox__ctas">
          <button aria-label="장바구니에 담기" className="wc-pdp-railbox__cart" disabled={inert} onClick={fromRail(purchase.addToCart)} type="button">
            <CartGlyph />
          </button>
          <button className="wc-pdp-railbox__buy" disabled={inert} onClick={fromRail(purchase.buyNow)} type="button">구매하기</button>
        </div>
      )}
      {/* 박스(320×153)를 늘리지 않게 보조기기에만 둔다 — 재입고 신청이 바뀐 판매 상태로 거절된 이유다. */}
      <p aria-atomic="true" aria-live="polite" className="wc-sr-only" role="status">{stale.notice ?? ''}</p>
    </section>
  );
}

/* 정보 칼럼 패널의 고칠 칸(빈 필수 입력은 required 라 :invalid)이나 상태 줄로 스크롤하고, 칸이면 포커스한다. */
function revealPurchasePanel() {
  const panel = document.querySelector<HTMLElement>('.wc-pdp__purchase .wc-buy-panel');
  if (!panel) return;
  const field = panel.querySelector<HTMLElement>('input:invalid, textarea:invalid, select:invalid');
  const target = field ?? panel.querySelector<HTMLElement>('.wc-buy-panel__status') ?? panel;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  field?.focus({ preventScroll: true });
}
