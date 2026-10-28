'use client';

import { useState, useTransition, type KeyboardEvent } from 'react';
import {
  applyCouponAction,
  applyCouponCodeAction,
  clearCouponAction,
  type CouponActionResult,
} from '@/app/cart/coupon-actions';
import { PendingOrderResolution } from '@/components/checkout/PendingOrderResolution';
import type { CouponQuote } from '@/lib/coupon-targeting';
import {
  couponBenefitLabel,
  couponConditionLabel,
  couponDisplayState,
  couponErrorNeedsPendingOrder,
  couponExpiryLabel,
  mapCouponActionError,
  type UserCouponSummary,
} from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';
import { krw } from '@/lib/format';

/* 쿠폰 select·코드 입력 — 장바구니와 주문서가 함께 쓴다 (R-05 §1.5 문법 · S7 · R25).
 *
 * 상태는 전부 서버(cart_coupon_selections 한 행)에 있다. 액션이 장바구니·주문서를 함께
 * 재검증하므로 지금 화면이 같은 응답으로 다시 그려지고, 새 선택이 견적 재조회 키가 되어
 * 금액을 다시 받는다. CartProvider 에는 아무것도 넣지 않는다(DESIGN.md §11 동결).
 *
 * 주문서는 화면 전체가 주문 form 이라 여기서 form 을 열지 않는다 — 코드 칸의 Enter 는
 * 주문 제출 대신 코드 적용으로 돌린다(IME 조합 중 Enter 는 그대로).
 *
 * 운영 주문서 계약(legacy)은 주문 1건에 굿즈 쿠폰 1장이다. 배송비 쿠폰은 선택 RPC 가
 * 받지 않으므로(coupon_checkout_required) 목록에서 빼고 사실대로 알린다. 거래 런타임은
 * 주문서에서 배송비 쿠폰·중복 적용을 따로 고른다. */

export type CouponPickerSurface = 'cart' | 'checkout';

export interface CouponPickerProps {
  surface: CouponPickerSurface;
  couponState: CartCouponState;
  appliedCoupon: UserCouponSummary | null;
  /** 지금 화면의 서버 견적이 계산한 쿠폰 결과. 선택과 다른 쿠폰의 견적이면 조건 안내를 하지 않는다. */
  quote?: CouponQuote | null;
  /** 주문서에서 배송비 쿠폰·중복 적용을 따로 고르는 계약(거래 런타임)인지. */
  shippingCouponsAtCheckout?: boolean;
  disabled?: boolean;
}

const LEGACY_SHIPPING_COUPON_COPY = '배송비 쿠폰은 지금 주문에 쓸 수 없어요.';
const EMPTY_COPY = '사용할 수 있는 쿠폰이 없어요. 쿠폰 코드가 있으면 아래에 입력해주세요.';

function couponDescription(surface: CouponPickerSurface, shippingCouponsAtCheckout: boolean): string {
  if (surface === 'checkout') return '장바구니에서 고른 쿠폰이 이어져요. 바꾸면 결제 금액을 다시 계산해요.';
  return shippingCouponsAtCheckout
    ? '굿즈 쿠폰을 미리 선택할 수 있어요. 중복 적용과 배송비 쿠폰은 주문서에서 확인해주세요.'
    : '보유 쿠폰 1장을 고르거나 코드를 입력해주세요. 주문서에서도 바꿀 수 있어요.';
}

/** 쿠폰 칸에서 따로 알릴 견적 사유. 첫구매 선점은 화면의 주문 차단 문구가 진행 중 주문 링크와 함께 알린다. */
function quoteNotice(applied: UserCouponSummary | null, quote: CouponQuote | null | undefined): string | null {
  if (!applied || !quote || quote.userCouponId !== applied.id || !quote.reason) return null;
  if (couponErrorNeedsPendingOrder(quote.reason)) return null;
  if (quote.eligibleSubtotal < applied.coupon.minSubtotal) {
    return `쿠폰 대상 굿즈 금액이 최소 주문 금액(${krw(applied.coupon.minSubtotal)})에 못 미쳐 지금은 할인이 적용되지 않아요.`;
  }
  return mapCouponActionError(quote.reason);
}

export function CouponPicker({
  surface,
  couponState,
  appliedCoupon,
  quote = null,
  shippingCouponsAtCheckout = false,
  disabled = false,
}: CouponPickerProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState(false);
  const [code, setCode] = useState('');
  const locked = pending || disabled;
  const ids = { title: `${surface}-coupon-title`, select: `${surface}-coupon-select`, code: `${surface}-coupon-code` };

  const usable = couponState.coupons.filter((held) => couponDisplayState(held) === 'usable' || held.id === appliedCoupon?.id);
  const selectableCoupons = usable.filter((held) => held.coupon.benefitKind !== 'shipping');
  const heldShippingCoupons = shippingCouponsAtCheckout ? 0 : usable.length - selectableCoupons.length;
  const notice = quoteNotice(appliedCoupon, quote);

  function runAction(action: () => Promise<CouponActionResult>) {
    setMessage(null);
    setPendingOrder(false);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? null
        : result.shippingCoupon && !shippingCouponsAtCheckout ? LEGACY_SHIPPING_COUPON_COPY
          : result.message ?? null);
      setPendingOrder(!result.ok && result.pendingOrder === true);
    });
  }

  function handleSelect(nextId: string) {
    if (nextId === (appliedCoupon?.id ?? '')) return;
    runAction(() => (nextId ? applyCouponAction(nextId) : clearCouponAction()));
  }

  function applyCode() {
    if (locked) return;
    const typed = code;
    if (!typed.trim()) {
      setMessage('쿠폰 코드를 입력해주세요.');
      setPendingOrder(false);
      return;
    }
    runAction(async () => {
      const result = await applyCouponCodeAction(typed);
      if (result.ok) setCode('');
      return result;
    });
  }

  function handleCodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent?.isComposing === true) return;
    event.preventDefault();
    applyCode();
  }

  return (
    <div aria-labelledby={ids.title} className="wc-cart__coupon-slot" role="group">
      <p className="wc-cart__coupon-title" id={ids.title}>쿠폰</p>
      <p className="wc-cart__coupon-desc">{couponDescription(surface, shippingCouponsAtCheckout)}</p>

      {selectableCoupons.length > 0 ? (
        <>
          <label className="wc-cart__coupon-label" htmlFor={ids.select}>보유 쿠폰</label>
          <select
            className="wc-cart__coupon-select"
            disabled={locked}
            id={ids.select}
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
        </>
      ) : (
        <p className="wc-cart__coupon-desc">{EMPTY_COPY}</p>
      )}
      {heldShippingCoupons > 0 ? (
        <p className="wc-cart__coupon-desc">배송비 쿠폰 {heldShippingCoupons}장은 지금 주문에 쓸 수 없어요.</p>
      ) : null}

      {appliedCoupon ? (
        <dl className="wc-cart__coupon-detail">
          <div><dt>혜택</dt><dd>{couponBenefitLabel(appliedCoupon.coupon)}</dd></div>
          <div><dt>유효기간</dt><dd>{couponExpiryLabel(appliedCoupon)}</dd></div>
          <div><dt>사용조건</dt><dd>{couponConditionLabel(appliedCoupon.coupon)}</dd></div>
        </dl>
      ) : null}

      {notice ? <p className="wc-cart__coupon-warning" role="alert">{notice}</p> : null}

      {appliedCoupon ? (
        <button
          className="wc-cart__coupon-clear"
          disabled={locked}
          onClick={() => runAction(() => clearCouponAction())}
          type="button"
        >
          적용 해제
        </button>
      ) : null}

      <div className="wc-cart__coupon-code">
        <label className="wc-sr-only" htmlFor={ids.code}>쿠폰 코드</label>
        <input
          autoComplete="off"
          className="wc-cart__coupon-input"
          disabled={locked}
          id={ids.code}
          name="couponCode"
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={handleCodeKeyDown}
          placeholder="쿠폰 코드 직접 입력"
          type="text"
          value={code}
        />
        <button className="wc-cart__coupon-apply" disabled={locked} onClick={applyCode} type="button">
          쿠폰 적용
        </button>
      </div>

      {message ? <p className="wc-cart__coupon-warning" role="alert">{message}{pendingOrder ? <PendingOrderResolution /> : null}</p> : null}
    </div>
  );
}
