'use client';

import type { Good } from '@/lib/data';
import { useCart } from '@/components/shell/CartProvider';

/*
 * 담기 버튼 (#173). 굿즈샵 목록 카드와 상세페이지가 같은 재고·수량 제약을
 * 쓰도록 한 곳에 둔다. 둘이 갈라지면 상세에서만 재고를 넘겨 담는 길이 생긴다.
 */
export function AddToCartButton({ good, variant = 'card' }: { good: Good; variant?: 'card' | 'detail' }) {
  const { add, getQuantity, pending, ready } = useCart();
  const quantity = getQuantity(good.id);
  const sold = good.stock === 'soldout' || good.stockQty <= 0;
  const atStockLimit = quantity >= good.stockQty;
  const detail = variant === 'detail';
  const label = sold
    ? '품절'
    : !ready
      ? '준비 중'
      : quantity > 0
        ? `담김 · ${quantity}`
        : '담기';
  const ariaLabel = sold
    ? `${good.name} 품절`
    : !ready
      ? `${good.name} 장바구니 준비 중`
      : pending
        ? `${good.name} 장바구니 저장 중`
        : atStockLimit
          ? `${good.name}, 장바구니 ${quantity}개, 재고 한도 ${good.stockQty}개`
          : quantity > 0
            ? `${good.name}, 장바구니 ${quantity}개, 한 개 더 담기`
            : `${good.name} 장바구니에 한 개 담기`;

  return (
    <button
      aria-label={ariaLabel}
      className="shop-cart-button"
      disabled={sold || atStockLimit || !ready || pending}
      onClick={() => void add(good.id, good.stockQty)}
      type="button"
      style={{
        height: detail ? 48 : 36,
        padding: detail ? '0 28px' : '0 16px',
        borderRadius: 999,
        fontWeight: 700,
        fontSize: detail ? 15 : 12.5,
        background: quantity > 0 ? 'rgba(255,255,255,.05)' : 'var(--text)',
        color: sold || atStockLimit ? 'var(--faint)' : quantity > 0 ? 'var(--text)' : '#110D22',
        border: quantity > 0 ? '1px solid rgba(255,255,255,.25)' : 'none',
        opacity: sold || !ready ? 0.5 : 1,
        transition: 'transform .18s ease, background .25s ease',
      }}
    >
      {label}
    </button>
  );
}
