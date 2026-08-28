'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCart } from '@/components/shell/CartProvider';
import { RestockCta } from '@/components/shop/RestockCta';
import { QuantityStepper } from '@/components/wc/QuantityStepper';
import { WcButton } from '@/components/wc/WcButton';
import type { Good } from '@/lib/data';
import { krw } from '@/lib/format';
import { STOCK_LABEL } from '@/lib/goods-display';

/*
 * 굿즈 상세의 구매 블록 (R-04 §3.6~3.8 · DESIGN `pdp-buybox`·`cta-pair`·`restock-cta`).
 *
 * 옵션(variant) 도메인이 없으므로 셀렉트 행은 만들지 않는다 — 수량과 합계뿐이다.
 * 상태는 이 훅 하나가 갖고, 정보 칼럼 패널과 고정 구매바가 같은 컨트롤러를 나눠 쓴다.
 * 두 표면이 각자 수량을 들면 아래 바로 산 개수와 위에서 고른 개수가 갈린다.
 *
 * 금액·재고의 최종 판정은 언제나 서버다. 여기 계산은 "지금 담으면 얼마인가"를
 * 미리 보여 주기 위한 표시용 파생이고, 담기·주문 경로는 기존 카트 계약
 * (CartProvider.setQuantity → cart actions → place_order)을 그대로 쓴다.
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

export interface GoodPurchaseController {
  good: Good;
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
}

export function useGoodPurchase({
  disabled = false,
  good,
  restockRequested = false,
}: {
  disabled?: boolean;
  good: Good;
  restockRequested?: boolean;
}): GoodPurchaseController {
  const router = useRouter();
  const cart = useCart();
  const [quantity, setQuantityState] = useState(1);
  const [status, setStatus] = useState<string | null>(null);

  const soldOut = isGoodSoldOut(good);
  const nextQuantity = mergedCartQuantity(cart.getQuantity(good.id), quantity);
  const blocked = purchaseBlockReason({
    disabled,
    nextQuantity,
    pending: cart.pending,
    ready: cart.ready,
    soldOut,
    stockQty: good.stockQty,
  });
  const inert = blocked !== null && blocked !== 'stock';

  const commit = async () => {
    await cart.setQuantity(good.id, nextQuantity, good.stockQty);
    return blocked === null;
  };

  return {
    good,
    quantity,
    setQuantity: (next: number) => {
      setStatus(null);
      setQuantityState(next);
    },
    subtotal: purchaseSubtotal(good.price, quantity),
    soldOut,
    restockRequested,
    disabled,
    inert,
    /* 카트가 낸 오류가 먼저다 — 담기에 실패한 화면에 "담았어요"가 남으면 안 된다. */
    message: cart.error ?? status,
    addToCart: () => {
      if (inert) return;
      setStatus(null);
      void commit().then((ok) => { if (ok) setStatus(CART_ADDED_STATUS); });
    },
    /* 바로구매는 장바구니 화면을 건너뛸 뿐이다. 담기와 같은 카트 계약을 거쳐
       기존 주문 경로(체크아웃 → placeOrderAction → place_order)로 들어간다. */
    buyNow: () => {
      if (inert) return;
      setStatus(null);
      void commit().then((ok) => { if (ok) router.push('/checkout'); });
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

/** 정보 칼럼의 구매 패널. 품절이면 CTA 자리만 재입고 알림으로 바뀐다(R-04 §4). */
export function GoodPurchasePanel({ purchase }: { purchase: GoodPurchaseController }) {
  const { disabled, good, inert, message, quantity, restockRequested, setQuantity, soldOut, subtotal } = purchase;
  const stockLabel = STOCK_LABEL[good.stock];

  return (
    <div className="wc-buy-panel">
      {stockLabel ? <p className="wc-buy-panel__state">{stockLabel}</p> : null}
      <div className="wc-buy-panel__row">
        <span className="wc-buy-panel__label">수량</span>
        {/* 재고가 0인데 판매중인 데이터는 없다. 그래도 max 0 이면 스테퍼가 0에 잠겨
            수량을 고를 수 없는 컨트롤이 되므로 최소 1은 남긴다. */}
        <QuantityStepper max={Math.max(1, good.stockQty)} onChange={setQuantity} value={quantity} />
      </div>
      <div className="wc-buy-panel__total">
        <span className="wc-buy-panel__total-label">총 금액</span>
        <strong className="wc-buy-panel__total-amount">{krw(subtotal)}</strong>
      </div>
      {soldOut ? (
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

  const actions = soldOut ? (
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
        {soldOut ? (
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
