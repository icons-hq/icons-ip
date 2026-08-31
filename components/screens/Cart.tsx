'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition, type FormEvent } from 'react';
import {
  applyCouponAction,
  applyCouponCodeAction,
  clearCouponAction,
  type CouponActionResult,
} from '@/app/cart/coupon-actions';
import { useCart } from '@/components/shell/CartProvider';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/wc/EmptyState';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { QuantityStepper } from '@/components/wc/QuantityStepper';
import { WcButton } from '@/components/wc/WcButton';
import type { CatalogSnapshot } from '@/lib/catalog';
import {
  couponBenefitLabel,
  couponConditionLabel,
  couponDisplayState,
  couponExpiryLabel,
  couponPreviewDiscount,
  type UserCouponSummary,
} from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';
import type { Good, Ip } from '@/lib/data';
import { krw, krwAmountWords } from '@/lib/format';
import { freeShippingRemainder, shippingFeeFor, shippingFeeLabel } from '@/lib/shipping';

interface CartLine {
  goodId: string;
  qty: number;
  good?: Good;
  ip?: Ip;
}

function isSoldOut(good: Good) {
  return good.stock === 'soldout' || good.stockQty <= 0;
}

/** 주문을 막는 라인인지. 카탈로그에서 사라진 굿즈·품절·재고 초과가 여기 걸린다. */
function isUnavailable(line: CartLine) {
  if (!line.good) return true;
  return isSoldOut(line.good) || line.qty > line.good.stockQty;
}

function lineStateLabel(good: Good, qty: number) {
  if (isSoldOut(good)) return '품절';
  if (qty > good.stockQty) return `재고 ${good.stockQty}개만 남음`;
  if (good.stock === 'low') return `재고 ${good.stockQty}개 남음`;
  return null;
}

function CartLineRow({ line }: { line: CartLine }) {
  const { pending, remove, setQuantity } = useCart();
  const { good, goodId, ip, qty } = line;

  if (!good) {
    return (
      <li className="wc-cart__line wc-cart__line--unavailable">
        <span aria-hidden className="wc-cart__line-media" />
        <div className="wc-cart__line-info">
          <p className="wc-cart__line-name">판매 종료된 굿즈 ({goodId})</p>
          <p className="wc-cart__line-state">판매 종료</p>
        </div>
        <button
          aria-label={`판매 종료된 굿즈 ${goodId} 삭제`}
          className="wc-cart__remove"
          disabled={pending}
          onClick={() => void remove(goodId)}
          type="button"
        >
          <Icon name="close" size={18} />
        </button>
      </li>
    );
  }

  const soldOut = isSoldOut(good);
  const stateLabel = lineStateLabel(good, qty);
  const href = `/shop/${goodId}`;

  return (
    <li className={`wc-cart__line${isUnavailable(line) ? ' wc-cart__line--unavailable' : ''}`}>
      {/* 바로 옆 이름 링크와 목적지가 같다 — 접근성 트리에서는 숨긴다(ProductCard 와 같은 규칙). */}
      <Link
        aria-hidden
        className="wc-cart__line-media"
        href={href}
        style={{ background: good.img }}
        tabIndex={-1}
      />
      <div className="wc-cart__line-info">
        <p className="wc-cart__line-brand">{ip?.title ?? 'ICONS'}</p>
        <Link className="wc-cart__line-name" href={href}>{good.name}</Link>
        <PriceBlock compareAtPrice={good.compareAtPrice} price={good.price} />
        {stateLabel ? <p className="wc-cart__line-state">{stateLabel}</p> : null}
      </div>
      <div className="wc-cart__line-controls">
        {/* 품절 라인은 늘릴 수도 줄일 수도 없다 — 스테퍼 대신 삭제만 남긴다. */}
        {soldOut ? null : (
          <QuantityStepper
            label={`${good.name} 수량`}
            max={good.stockQty}
            onChange={(next) => void setQuantity(goodId, next, good.stockQty)}
            value={qty}
          />
        )}
        <p className="wc-cart__line-total">{krw(good.price * qty)}</p>
      </div>
      <button
        aria-label={`${good.name} 장바구니에서 삭제`}
        className="wc-cart__remove"
        disabled={pending}
        onClick={() => void remove(goodId)}
        type="button"
      >
        <Icon name="close" size={18} />
      </button>
    </li>
  );
}

/* 쿠폰 select·코드 입력 (R-05 §1.5 문법 · S7).
 * 여기 상태는 전부 서버(cart_coupon_selections)에 있다 — 액션이 끝나면
 * revalidatePath('/cart') 가 목록·선택을 새로 내려준다. CartProvider 에는
 * 아무것도 넣지 않는다(DESIGN.md §11 동결). */
function CartCouponSection({
  appliedCoupon,
  couponState,
  subtotal,
}: {
  appliedCoupon: UserCouponSummary | null;
  couponState: CartCouponState;
  subtotal: number;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const selectableCoupons = couponState.coupons.filter((held) => (
    couponDisplayState(held) === 'usable' || held.id === appliedCoupon?.id
  ));

  function runAction(action: () => Promise<CouponActionResult>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? null : result.message ?? null);
    });
  }

  function handleSelect(nextId: string) {
    if (nextId === (appliedCoupon?.id ?? '')) return;
    runAction(() => (nextId ? applyCouponAction(nextId) : clearCouponAction()));
  }

  function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim()) {
      setMessage('쿠폰 코드를 입력해주세요.');
      return;
    }
    runAction(async () => {
      const result = await applyCouponCodeAction(code);
      if (result.ok) setCode('');
      return result;
    });
  }

  const belowMinimum = Boolean(
    appliedCoupon && subtotal < appliedCoupon.coupon.minSubtotal,
  );

  return (
    <div className="wc-cart__coupon-slot">
      <p className="wc-cart__coupon-title" id="cart-coupon-title">쿠폰</p>

      <label className="wc-cart__coupon-label" htmlFor="cart-coupon-select">보유 쿠폰</label>
      <select
        className="wc-cart__coupon-select"
        disabled={pending}
        id="cart-coupon-select"
        onChange={(event) => handleSelect(event.target.value)}
        value={appliedCoupon?.id ?? ''}
      >
        <option value="">쿠폰 선택 안 함</option>
        {selectableCoupons.map((held) => (
          <option key={held.id} value={held.id}>
            {held.coupon.name} · {couponBenefitLabel(held.coupon)}
          </option>
        ))}
      </select>

      {appliedCoupon ? (
        <dl className="wc-cart__coupon-detail">
          <div><dt>혜택</dt><dd>{couponBenefitLabel(appliedCoupon.coupon)}</dd></div>
          <div><dt>유효기간</dt><dd>{couponExpiryLabel(appliedCoupon)}</dd></div>
          <div><dt>사용조건</dt><dd>{couponConditionLabel(appliedCoupon.coupon)}</dd></div>
        </dl>
      ) : null}

      {belowMinimum ? (
        <p className="wc-cart__coupon-warning" role="alert">
          최소 주문 금액 미달로 지금은 할인이 적용되지 않아요.
        </p>
      ) : null}

      {appliedCoupon ? (
        <button
          className="wc-cart__coupon-clear"
          disabled={pending}
          onClick={() => runAction(() => clearCouponAction())}
          type="button"
        >
          적용 해제
        </button>
      ) : null}

      <form className="wc-cart__coupon-code" onSubmit={handleCodeSubmit}>
        <label className="wc-sr-only" htmlFor="cart-coupon-code">쿠폰 코드</label>
        <input
          autoComplete="off"
          className="wc-cart__coupon-input"
          disabled={pending}
          id="cart-coupon-code"
          name="couponCode"
          onChange={(event) => setCode(event.target.value)}
          placeholder="쿠폰 코드 직접 입력"
          type="text"
          value={code}
        />
        <button className="wc-cart__coupon-apply" disabled={pending} type="submit">
          쿠폰 적용
        </button>
      </form>

      {message ? <p className="wc-cart__coupon-warning" role="alert">{message}</p> : null}
    </div>
  );
}

export function Cart({
  catalog,
  couponState,
}: {
  catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>;
  couponState: CartCouponState;
}) {
  const { count, error, items, mode, pending, ready } = useCart();

  const lines = useMemo<CartLine[]>(() => {
    const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
    const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));

    return items.map((item) => {
      const good = goodsById.get(item.goodId);
      return {
        ...item,
        good,
        ip: good ? ipsById.get(good.ip) : undefined,
      };
    });
  }, [catalog.goods, catalog.ips, items]);

  const subtotal = lines.reduce((total, line) => (
    total + (line.good ? line.good.price * line.qty : 0)
  ), 0);
  const unavailableCount = lines.filter(isUnavailable).length;
  /* 표시용 예상치다. 실제 청구액은 place_order가 같은 정책으로 다시 계산한다. */
  const shippingFee = shippingFeeFor(subtotal);
  const remainingForFreeShipping = freeShippingRemainder(subtotal);
  const canCheckout = unavailableCount === 0 && !pending;

  const appliedCoupon = couponState.coupons.find(
    (held) => held.id === couponState.selectedUserCouponId,
  ) ?? null;
  const couponDiscount = couponPreviewDiscount(appliedCoupon, subtotal);

  return (
    <div className="wc-root wc-cart">
      <div className="wc-container">
        <h1 className="wc-cart__title">장바구니</h1>
        {ready ? (
          <p className="wc-cart__mode">{mode === 'server' ? '계정에 저장됨' : '이 기기에 저장됨'}</p>
        ) : null}

        {error ? <p className="wc-cart__error" role="alert">{error}</p> : null}

        {!ready ? (
          <p aria-live="polite" className="wc-cart__loading" role="status">
            장바구니를 불러오는 중이에요.
          </p>
        ) : lines.length === 0 ? (
          <EmptyState
            action={<WcButton href="/shop" variant="primary">굿즈샵 둘러보기</WcButton>}
            className="wc-cart__empty"
            title="장바구니가 비어 있어요"
            titleAs="h2"
          />
        ) : (
          <div className="wc-cart__layout">
            <div aria-busy={pending} className="wc-cart__list-col">
              <ul className="wc-cart__list">
                {lines.map((line) => <CartLineRow key={line.goodId} line={line} />)}
              </ul>
            </div>

            <aside aria-label="주문 요약" className="wc-cart__aside">
              <table className="wc-cart__summary">
                <tbody>
                  <tr>
                    <th scope="row">총 굿즈 금액</th>
                    <td>{krw(subtotal)}</td>
                  </tr>
                  <tr>
                    <th scope="row">총 할인 금액</th>
                    <td>−{krw(couponDiscount)}</td>
                  </tr>
                  <tr>
                    <th scope="row">배송비</th>
                    <td>{shippingFeeLabel(shippingFee)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">예상 총액</th>
                    <td>{krw(subtotal + shippingFee - couponDiscount)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="wc-cart__summary-note">배송비는 결제 화면에서 확인할 수 있어요.</p>
              {/* 판매 종료 라인만 남은 카트는 소계가 0이다 — 담을 것도 없는데 무료배송을 권하지 않는다. */}
              {subtotal > 0 && remainingForFreeShipping > 0 ? (
                <p className="wc-cart__summary-note">
                  {krwAmountWords(remainingForFreeShipping)} 더 담으면 무료배송이에요.
                </p>
              ) : null}

              {mode === 'server' ? (
                <CartCouponSection
                  appliedCoupon={appliedCoupon}
                  couponState={couponState}
                  subtotal={subtotal}
                />
              ) : (
                <div className="wc-cart__coupon-slot">
                  <p className="wc-cart__coupon-title">쿠폰</p>
                  <p className="wc-cart__coupon-desc">로그인하면 보유 쿠폰을 적용할 수 있어요.</p>
                </div>
              )}

              {unavailableCount > 0 ? (
                <p className="wc-cart__warning" role="alert">
                  주문할 수 없는 굿즈 {unavailableCount}개를 삭제하거나 수량을 조정해주세요.
                </p>
              ) : null}

              <WcButton
                className="wc-cart__checkout"
                disabled={!canCheckout}
                href="/checkout"
                variant="primary"
              >
                {`${count}개 굿즈 주문하기`}
              </WcButton>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
