'use client';

import { useState, useTransition, type KeyboardEvent } from 'react';
import { claimCouponCodeAction } from '@/app/my/coupons/actions';
import { PendingOrderCouponNotices, pendingOrderCouponOptionSuffix } from '@/components/checkout/PendingOrderCouponNotices';
import type { CouponQuote } from '@/lib/coupon-targeting';
import {
  couponBenefitLabel,
  couponConditionLabel,
  couponErrorNeedsPendingOrder,
  couponExpiryLabel,
  couponSelectable,
  mapCouponActionError,
} from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';

/*
 * 바로구매 주문서의 쿠폰 칸(ADR-0030). 장바구니 쿠폰 선택(cart_coupon_selections)은 바꾸지 않고, 이 주문서에서만 쓸 쿠폰을
 * 고른다 — 선택은 화면 상태이고 주문을 만들 때 DB가 소유·조건을 다시 판정한다. 같은 쿠폰이 장바구니에 선택돼 있으면
 * 결제 확정(카드)·접수(무통장) 때 장바구니 선택이 풀린다. 모양은 장바구니·주문서 쿠폰 칸(CouponPicker)과 같다.
 *
 * 코드 입력은 쿠폰함 등록(claim_coupon_code)만 한다 — 등록되면 목록에 나타나고 고객이 고른다. 배송비 쿠폰은 legacy 주문서가
 * 받지 않으므로 목록에서 빼고 사실대로 알린다.
 */
export function CheckoutDirectCoupon({
  couponState,
  selectedUserCouponId,
  onSelect,
  quote = null,
  disabled = false,
}: {
  couponState: CartCouponState;
  selectedUserCouponId: string | null;
  onSelect: (userCouponId: string | null) => void;
  quote?: CouponQuote | null;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const locked = pending || disabled;
  const selected = couponState.coupons.find((held) => held.id === selectedUserCouponId) ?? null;
  /* 진행 중인(결제 대기) 주문이 잡은 쿠폰도 고를 수 있다 — 접수하는 순간 이 주문이 그 주문을 닫고 쓴다(QA1 S-D2-08). */
  const usable = couponState.coupons.filter((held) => couponSelectable(held) || held.id === selectedUserCouponId);
  const selectable = usable.filter((held) => held.coupon.benefitKind !== 'shipping');
  const shippingCoupons = usable.length - selectable.length;
  const notice = selected && quote && quote.userCouponId === selected.id && quote.reason && !couponErrorNeedsPendingOrder(quote.reason)
    ? mapCouponActionError(quote.reason) : null;

  function claim() {
    if (locked) return;
    const typed = code;
    if (!typed.trim()) {
      setMessage({ ok: false, text: '쿠폰 코드를 입력해주세요.' });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await claimCouponCodeAction(typed);
      setMessage({ ok: result.ok, text: result.ok ? '쿠폰함에 등록했어요. 위 목록에서 골라 주세요.' : result.message });
      if (result.ok) setCode('');
    });
  }

  function handleCodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent?.isComposing === true) return;
    event.preventDefault();
    claim();
  }

  return (
    <div aria-labelledby="direct-coupon-title" className="wc-cart__coupon-slot" role="group">
      <p className="wc-cart__coupon-title" id="direct-coupon-title">쿠폰</p>
      <p className="wc-cart__coupon-desc">이 주문에만 쓸 쿠폰을 골라요. 장바구니에서 고른 쿠폰은 바뀌지 않아요.</p>
      {selectable.length > 0 ? (
        <>
          <label className="wc-cart__coupon-label" htmlFor="direct-coupon-select">보유 쿠폰</label>
          <select
            className="wc-cart__coupon-select"
            disabled={locked}
            id="direct-coupon-select"
            onChange={(event) => onSelect(event.target.value || null)}
            value={selected?.id ?? ''}
          >
            <option value="">쿠폰 선택 안 함</option>
            {selectable.map((held) => (
              <option key={held.id} value={held.id}>{held.coupon.name} · {couponBenefitLabel(held.coupon)}{pendingOrderCouponOptionSuffix(held)}</option>
            ))}
          </select>
        </>
      ) : couponState.unavailable ? (
        <p className="wc-cart__coupon-warning" role="alert">보유 쿠폰을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p>
      ) : (
        <p className="wc-cart__coupon-desc">사용할 수 있는 쿠폰이 없어요. 쿠폰 코드가 있으면 아래에 등록해주세요.</p>
      )}
      {shippingCoupons > 0 ? <p className="wc-cart__coupon-desc">배송비 쿠폰 {shippingCoupons}장은 지금 주문에 쓸 수 없어요.</p> : null}
      <PendingOrderCouponNotices coupons={selectable} surface="checkout" />
      {selected ? (
        <dl className="wc-cart__coupon-detail">
          <div><dt>혜택</dt><dd>{couponBenefitLabel(selected.coupon)}</dd></div>
          <div><dt>유효기간</dt><dd>{couponExpiryLabel(selected)}</dd></div>
          <div><dt>사용조건</dt><dd>{couponConditionLabel(selected.coupon)}</dd></div>
        </dl>
      ) : null}
      {notice ? <p className="wc-cart__coupon-warning" role="alert">{notice}</p> : null}
      {selected ? (
        <button className="wc-cart__coupon-clear" disabled={locked} onClick={() => onSelect(null)} type="button">적용 해제</button>
      ) : null}
      <div className="wc-cart__coupon-code">
        <label className="wc-sr-only" htmlFor="direct-coupon-code">쿠폰 코드</label>
        <input
          autoComplete="off"
          className="wc-cart__coupon-input"
          disabled={locked}
          id="direct-coupon-code"
          name="couponCode"
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={handleCodeKeyDown}
          placeholder="쿠폰 코드 등록"
          type="text"
          value={code}
        />
        <button className="wc-cart__coupon-apply" disabled={locked} onClick={claim} type="button">쿠폰 등록</button>
      </div>
      {message ? (
        <p className={message.ok ? 'wc-cart__coupon-desc' : 'wc-cart__coupon-warning'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
