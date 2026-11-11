'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/components/shell/CartProvider';
import type { AddToCartResultItem } from '@/components/shop/AddToCartResultDialog';
import type { Good } from '@/lib/data';
import { initialGoodOption } from '@/lib/goods-options';
import { addWishGoodToCart, wishCartState } from '@/lib/wishlist-cart';

/*
 * 위시 카드의 '장바구니 담기' (LFS 패리티 2차 L6 · MY-06, 10/14 S14·S15).
 *
 * 수량을 고르지 않는 한 개 담기다. 목록 카드의 `listing.showCart` 운영 설정과 무관하게 늘 보인다 — 위시는
 * "다시 사러 온" 화면이라 담기가 이 화면의 주 행동이다. 판정과 담기는 lib/wishlist-cart 가 하고(굿즈 상세와 같은
 * addSelection 계약), 반영이 확정돼야 onAdded 로 담기 결과 모달을 연다(모달·포털은 화면이 든다).
 * 실패면 열지 않고 카드 아래에 이유를 남긴다. 담을 수 없는 상태는 disabled 대신 aria-disabled 다 — 담은 직후
 * 재고 한도에 닿아도 모달을 닫았을 때 포커스가 이 버튼으로 돌아올 수 있어야 한다.
 */
export function WishlistCartButton({ good, onAdded }: { good: Good; onAdded: (items: AddToCartResultItem[]) => void }) {
  const cart = useCart();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const option = initialGoodOption(good);
  const state = wishCartState(good, {
    quantityInCart: option ? cart.getQuantity(good.id, option.id) : 0,
    ready: cart.ready,
    working: busy,
    pending: cart.pending,
  });

  if (state.kind === 'choose') {
    return (
      <Link aria-label={state.ariaLabel} className="wc-btn wc-wish__cart" href={state.href}>
        {state.label}
      </Link>
    );
  }

  async function add() {
    if (state.kind !== 'add' || state.unavailable) return;
    setFailed(false);
    setBusy(true);
    const ok = await addWishGoodToCart(cart.addSelection, good, state, onAdded);
    setBusy(false);
    setFailed(!ok);
  }

  return (
    <>
      <button
        aria-busy={busy || undefined}
        aria-disabled={state.unavailable ? 'true' : undefined}
        aria-label={state.ariaLabel}
        className="wc-btn wc-wish__cart"
        onClick={() => void add()}
        type="button"
      >
        {state.label}
      </button>
      {failed ? (
        <p className="wc-wish__cart-error" role="status">
          {cart.error ?? '장바구니에 담지 못했어요. 잠시 후 다시 시도해주세요.'}
        </p>
      ) : null}
    </>
  );
}
