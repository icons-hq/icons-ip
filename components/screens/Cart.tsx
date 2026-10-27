'use client';

import Link from 'next/link';
import { PendingOrderResolution } from '@/components/checkout/PendingOrderResolution';
import { useMemo, useState, useTransition, type FormEvent } from 'react';
import {
  applyCouponAction,
  applyCouponCodeAction,
  clearCouponAction,
  type CouponActionResult,
} from '@/app/cart/coupon-actions';
import { CartEmptyState } from '@/components/cart/CartEmptyState';
import { CartSubheader } from '@/components/cart/CartSubheader';
import { useCart, useReleaseUnpaidCartOrders } from '@/components/shell/CartProvider';
import { Icon } from '@/components/ui/Icon';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { QuantityStepper } from '@/components/wc/QuantityStepper';
import { WcButton } from '@/components/wc/WcButton';
import type { CatalogSnapshot } from '@/lib/catalog';
import { goodsImageBackground } from '@/lib/goods-image';
import {
  couponBenefitLabel,
  couponConditionLabel,
  couponDisplayState,
  couponErrorNeedsPendingOrder,
  couponExpiryLabel,
  type UserCouponSummary,
} from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';
import type { Good, Ip } from '@/lib/data';
import { krw } from '@/lib/format';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { goodsCustomInputProblem, type GoodsCustomInputSelection } from '@/lib/goods-custom-inputs';
import { cartItemKey } from '@/lib/cart';
import { cartOptionGood, goodAtQuotedPrice, optionLabel } from '@/lib/goods-options';
import { goodsSalesQuoteProblem } from '@/lib/goods-sales';
import { shippingFeeLabel } from '@/lib/shipping';
import { useGoodsSalesPrecheckoutQuote, useShippingQuote } from '@/components/shop/useShippingQuote';
import { ShippingGroupSummary } from '@/components/shop/ShippingGroupSummary';
import { shippingGroupLabel } from '@/lib/fulfillment';
import { goodsShipDateLabel, preorderSupplyLabel, type GoodsVariantSupply } from '@/lib/goods-preorders';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { goodsSaleUnavailableLabel } from '@/lib/goods-sale-period';

interface CartLine {
  goodId: string;
  variantId: string;
  customInputs?:GoodsCustomInputSelection;
  optionName?: string | null;
  qty: number;
  good?: Good;
  ip?: Ip;
  supply?: GoodsVariantSupply;
}

function isSoldOut(good: Good) {
  return good.stock === 'soldout' || good.stockQty <= 0;
}

/** 주문을 막는 라인인지. 카탈로그에서 사라진 굿즈·품절·재고 초과가 여기 걸린다. */
function isUnavailable(line: CartLine) {
  if (!line.good) return true;
  return Boolean(goodsSaleUnavailableLabel(line.good.salePeriod)) || isSoldOut(line.good) || line.qty > line.good.stockQty || Boolean(goodsCustomInputProblem(line.good.customInputs,line.customInputs));
}

function lineStateLabel(good: Good, qty: number) {
  const saleLabel = goodsSaleUnavailableLabel(good.salePeriod); if (saleLabel) return saleLabel;
  if (isSoldOut(good)) return '품절';
  if (qty > good.stockQty) return `재고 ${good.stockQty}개만 남음`;
  if (good.stock === 'low') return `재고 ${good.stockQty}개 남음`;
  return null;
}

/* 행 = [썸네일 64(모바일 80) · 브랜드·이름·단가·상태] 다음 줄에 회색 옵션 밴드 [옵션·직접 입력 | 수량 | ×],
   그 아래 오른쪽에 줄 금액(CT-04 · 레퍼런스 실측). 표시 배치만 바꾼다 — 수량·삭제 호출과 금액 계산은 그대로다. */
function CartLineRow({ line }: { line: CartLine }) {
  const { pending, remove, setQuantity } = useCart();
  const { good, goodId, variantId, ip, qty, optionName, supply,customInputs } = line;

  if (!good) {
    return (
      <li className="wc-cart__line wc-cart__line--unavailable">
        <span aria-hidden className="wc-cart__line-media" />
        <div className="wc-cart__line-info">
          <p className="wc-cart__line-name">판매 종료된 굿즈 ({goodId})</p>
          <p className="wc-cart__line-state">판매 종료</p>
        </div>
        <div className="wc-cart__line-band">
          <div className="wc-cart__line-detail" />
          <button
            aria-label={`판매 종료된 굿즈 ${goodId} 삭제`}
            className="wc-cart__remove"
            disabled={pending}
            onClick={() => void remove(goodId, variantId,customInputs)}
            type="button"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </li>
    );
  }

  const soldOut = isSoldOut(good) || Boolean(goodsSaleUnavailableLabel(good.salePeriod));
  const stateLabel = goodsSaleUnavailableLabel(good.salePeriod) ?? (supply?.mode === 'preorder' ? preorderSupplyLabel(supply) : lineStateLabel(good, qty));
  const href = `/shop/${goodId}`;

  return (
    <li className={`wc-cart__line${isUnavailable(line) ? ' wc-cart__line--unavailable' : ''}`}>
      {/* 바로 옆 이름 링크와 목적지가 같다 — 접근성 트리에서는 숨긴다(ProductCard 와 같은 규칙). */}
      <Link
        aria-hidden
        className="wc-cart__line-media"
        href={href}
        style={{ background: goodsImageBackground(good.img) }}
        tabIndex={-1}
      />
      <div className="wc-cart__line-info">
        <p className="wc-cart__line-brand">{ip?.title ?? 'ICONS'}</p>
        <Link className="wc-cart__line-name" href={href}>{good.name}</Link>
        <PriceBlock showDiscountRate={good.showDiscountRate} compareAtPrice={good.compareAtPrice} price={good.price} />
        {goodsCustomInputProblem(good.customInputs,customInputs) && <p className="wc-cart__line-state">{goodsCustomInputProblem(good.customInputs,customInputs)} <Link href={href}>내용 다시 확인</Link></p>}
        {stateLabel ? <p className="wc-cart__line-state">{stateLabel}</p> : null}
        {supply?.mode === 'preorder' ? <p className="wc-cart__line-state">{goodsShipDateLabel(supply.expectedShipDate)}</p> : null}
      </div>
      <div className="wc-cart__line-band">
        <div className="wc-cart__line-detail">
          {optionName ? <p className="wc-cart__line-option">{optionName}</p> : null}
          <GoodsCustomInputsSummary selection={customInputs} />
        </div>
        {/* 품절 라인은 늘릴 수도 줄일 수도 없다 — 스테퍼 대신 삭제만 남긴다. */}
        {soldOut ? null : (
          <QuantityStepper
            label={`${good.name} 수량`}
            max={good.stockQty}
            onChange={(next) => void setQuantity(goodId, next, good.stockQty, variantId,customInputs)}
            value={qty}
          />
        )}
        <button
          aria-label={`${good.name} 장바구니에서 삭제`}
          className="wc-cart__remove"
          disabled={pending}
          onClick={() => void remove(goodId, variantId,customInputs)}
          type="button"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <p className="wc-cart__line-total">{krw(good.price * qty)}</p>
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
  eligibleSubtotal,
}: {
  appliedCoupon: UserCouponSummary | null;
  couponState: CartCouponState;
  eligibleSubtotal: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState(false);
  const [code, setCode] = useState('');

  const selectableCoupons = couponState.coupons.filter((held) => (
    held.coupon.benefitKind !== 'shipping' && (couponDisplayState(held) === 'usable' || held.id === appliedCoupon?.id)
  ));

  function runAction(action: () => Promise<CouponActionResult>) {
    setMessage(null);
    setPendingOrder(false);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? null : result.message ?? null);
      setPendingOrder(!result.ok && result.pendingOrder === true);
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
      setPendingOrder(false);
      return;
    }
    runAction(async () => {
      const result = await applyCouponCodeAction(code);
      if (result.ok) setCode('');
      return result;
    });
  }

  const belowMinimum = Boolean(
    appliedCoupon && eligibleSubtotal !== null && eligibleSubtotal < appliedCoupon.coupon.minSubtotal,
  );

  return (
    <div className="wc-cart__coupon-slot">
      <p className="wc-cart__coupon-title" id="cart-coupon-title">쿠폰</p><p>굿즈 쿠폰을 미리 선택할 수 있어요. 중복 적용과 배송비 쿠폰은 주문서에서 확인해주세요.</p>

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
          쿠폰 대상 굿즈의 최소 주문 금액 미달로 지금은 할인이 적용되지 않아요.
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

      {message ? <p className="wc-cart__coupon-warning" role="alert">{message}{pendingOrder ? <PendingOrderResolution /> : null}</p> : null}
    </div>
  );
}

export function Cart({
  catalog,
  couponState,
  transactionMode = 'legacy',
  giftAvailable = false,
}: {
  catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>;
  couponState: CartCouponState;
  transactionMode?: 'legacy' | 'transaction' | 'unavailable';
  giftAvailable?: boolean;
}) {
  const { count, error, items, mode, pending, ready, legacyItems = [], removeLegacyItem, refresh } = useCart();
  const transactionActive = transactionMode === 'transaction';
  /* 결제를 마치지 않은 이전 주문이 쿠폰·구매 한도를 잡고 있으면 견적 전에 닫는다(ADR-0026). */
  const released = useReleaseUnpaidCartOrders();
  const shipping = useShippingQuote(items, ready && released && transactionMode === 'legacy', couponState.selectedUserCouponId ?? '');
  const precheckout = useGoodsSalesPrecheckoutQuote(items, ready && released && transactionActive);
  const productQuote = transactionActive ? precheckout : shipping;
  const sales = productQuote.sales;

  const lines = useMemo<CartLine[]>(() => {
    const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
    const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
    const prices = new Map(sales?.lines.map(line => [cartItemKey(line.goodId, line.variantId), line]));

    return items.map((item) => {
      const good = goodAtQuotedPrice(cartOptionGood(goodsById.get(item.goodId), item.variantId), prices.get(cartItemKey(item.goodId, item.variantId)));
      const option = good?.options?.find(option => option.id === item.variantId);
      return {
        ...item,
        optionName: optionLabel(option, good?.options?.length ?? 0),
        good,
        supply: prices.get(cartItemKey(item.goodId, item.variantId))?.supply ?? option?.supply,
        ip: good ? ipsById.get(good.ip) : undefined,
      };
    });
  }, [catalog.goods, catalog.ips, items, sales]);

  const subtotal = sales?.subtotal ?? lines.reduce((total, line) => (
    total + (line.good ? line.good.price * line.qty : 0)
  ), 0);
  const unavailableCount = lines.filter(isUnavailable).length;
  /* 표시용 예상치다. 실제 청구액은 place_order가 같은 정책으로 다시 계산한다. */
  const shippingFee = shipping.quote?.totalFee ?? 0;
  const shippingFinal = shipping.quote?.checkoutAllowed === true && shipping.quote.finalTotalFee !== null;
  const shippingCanContinue = Boolean(shipping.quote && shipping.quote.groups.every(group => group.finalFee !== null || group.regionStatus === 'address_required'));
  const purchaseProblem = sales ? goodsSalesQuoteProblem(sales) : null;
  const couponSelectionChanged = !transactionActive && Boolean(shipping.sales && (shipping.sales.coupon?.userCouponId ?? null) !== couponState.selectedUserCouponId);
  const canCheckout = transactionMode !== 'unavailable' && unavailableCount === 0 && !pending && Boolean(sales) && !purchaseProblem
    && (transactionActive || shippingCanContinue && !couponSelectionChanged);

  const appliedCoupon = couponState.coupons.find(
    (held) => held.id === couponState.selectedUserCouponId,
  ) ?? null;
  const couponDiscount = shipping.sales?.coupon?.discount ?? 0;
  /* 예상 총액은 배송비가 확정된 기존 계약에서만 숫자다 — 요약 표와 모바일 주문 바가 같은 값을 보인다. */
  const estimatedTotal = !transactionActive && shippingFinal ? subtotal + shippingFee - couponDiscount : null;

  return (
    <div className="wc-root wc-cart">
      <GoodsSalePeriodRefresh goods={lines.flatMap(line => line.good ? [line.good] : [])} />
      <CartSubheader />
      <div className="wc-container">
        <h1 className="wc-cart__title">장바구니</h1>
        {ready ? (
          <p className="wc-cart__mode">{mode === 'server' ? '계정에 저장됨' : '이 기기에 저장됨'}</p>
        ) : null}

        {error ? <p className="wc-cart__error" role="alert">{error}</p> : null}
        {legacyItems.length > 0 ? <section aria-label="이전 장바구니 확인">
          <p>이전 장바구니를 현재 옵션에 연결하고 있습니다. 확인하지 못한 항목은 그대로 보관합니다.</p>
          <ul>{legacyItems.map((item) => <li key={item.goodId}>
            이전 굿즈 ({item.goodId}) · {item.qty}개
            <button className="wc-btn" disabled={pending} type="button" onClick={() => removeLegacyItem(item.goodId)}>이 항목 삭제</button>
          </li>)}</ul>
          <button className="wc-btn" disabled={pending} type="button" onClick={() => void refresh()}>다시 확인</button>
        </section> : null}

        {!ready ? (
          <p aria-live="polite" className="wc-cart__loading" role="status">
            {legacyItems.length && !pending ? '이전 장바구니를 확인해주세요.' : '장바구니를 불러오는 중이에요.'}
          </p>
        ) : lines.length === 0 ? (
          <CartEmptyState />
        ) : (
          <div className="wc-cart__layout">
            <div aria-busy={pending} className="wc-cart__list-col">
              {shipping.quote?.groups.map((group, index, groups) => (
                <section className="wc-shipping-group" key={group.originId} aria-label={`${shippingGroupLabel(index, groups.length)} 굿즈`}>
                  <h2>{shippingGroupLabel(index, groups.length)}</h2>
                  <ul className="wc-cart__list">
                    {lines.filter(line => line.good?.originId === group.originId).map(line => <CartLineRow key={cartItemKey(line.goodId, line.variantId,line.customInputs)} line={line} />)}
                  </ul>
                  {!transactionActive && <ShippingGroupSummary group={group} />}
                </section>
              ))}
              <ul className="wc-cart__list">
                {lines.filter(line => !shipping.quote?.groups.some(group => line.good?.originId === group.originId))
                  .map(line => <CartLineRow key={cartItemKey(line.goodId, line.variantId,line.customInputs)} line={line} />)}
              </ul>
            </div>

            <aside aria-label="주문 요약" className="wc-cart__aside">
              <table className="wc-cart__summary">
                <tbody>
                  <tr>
                    <th scope="row">{transactionActive ? '복수구매 할인 전 굿즈 금액' : '총 굿즈 금액'}</th>
                    <td>{krw(subtotal)}</td>
                  </tr>
                  <tr>
                    <th scope="row">쿠폰 할인</th>
                    <td>{transactionActive ? '주문서에서 확인' : `−${krw(couponDiscount)}`}</td>
                  </tr>
                  <tr>
                    <th scope="row">배송비</th>
                    <td>{transactionActive ? '배송지·선불/착불 선택 후 확정' : shippingFinal ? shippingFeeLabel(shippingFee) : shipping.quote ? '배송지 입력 후 확정' : '확인 중'}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">예상 총액</th>
                    {/* 금액이면 26/700 으로 키우고(CT-01), 안내 문구면 금액 서체로 키우지 않는다. */}
                    <td className={estimatedTotal !== null ? 'wc-cart__total' : 'wc-cart__total wc-cart__total--pending'}>
                      {estimatedTotal !== null ? krw(estimatedTotal) : transactionActive ? '주문서에서 할인·배송비 확인 후 표시' : '배송비 확인 후 표시'}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="wc-cart__summary-note">{transactionActive ? '복수구매 할인과 수량별 배송비는 주문서에서 계산합니다. 착불 배송비는 수령 시 별도로 납부합니다.' : '출고지별 배송비를 합산합니다. 주문을 만들 때 서버가 최종 금액을 확인합니다.'}</p>
              {transactionMode === 'unavailable' && <p role="alert">주문 조건을 확인하지 못했습니다. 새로고침 후 다시 확인해주세요.</p>}
              {productQuote.loading ? <p role="status">{transactionActive ? '현재 가격과 구매 조건을 확인하고 있어요.' : '현재 가격과 배송비를 확인하고 있어요.'}</p> : null}
              {productQuote.error ? <div role="alert"><p>{productQuote.error}</p><button type="button" onClick={productQuote.refresh}>{transactionActive ? '가격·구매 조건 다시 확인' : '가격·배송비 다시 확인'}</button></div> : null}
              {purchaseProblem ? <p className="wc-cart__error" role="alert">{purchaseProblem}
                {!transactionActive && couponErrorNeedsPendingOrder(shipping.sales?.coupon?.reason) ? <PendingOrderResolution /> : null}
              </p> : null}
              {sales?.goods.filter(good => good.memberRemainingQty !== null).map(good => <p key={good.goodId}>
                {catalog.goods.find(item => item.id === good.goodId)?.name} · 회원 추가 구매 가능 {good.memberRemainingQty}개
              </p>)}

              {mode === 'server' ? (
                <>{couponState.unavailable ? <p className="wc-cart__coupon-warning" role="alert">보유 쿠폰을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : null}<CartCouponSection
                  appliedCoupon={appliedCoupon}
                  couponState={couponState}
                  eligibleSubtotal={!transactionActive && shipping.sales?.coupon?.userCouponId === appliedCoupon?.id ? shipping.sales?.coupon?.eligibleSubtotal ?? null : null}
                /></>
              ) : (
                <div className="wc-cart__coupon-slot">
                  <p className="wc-cart__coupon-title">쿠폰</p>
                  <p className="wc-cart__coupon-desc">로그인하면 보유 쿠폰을 적용할 수 있어요.</p>
                </div>
              )}

              {couponSelectionChanged ? <p className="wc-cart__coupon-warning" role="alert">다른 화면에서 선택한 쿠폰이 변경되었습니다. <button type="button" onClick={() => window.location.reload()}>현재 쿠폰 다시 확인</button></p> : null}

              {unavailableCount > 0 ? (
                <p className="wc-cart__warning" role="alert">
                  주문할 수 없는 굿즈 {unavailableCount}개를 삭제하거나 수량을 조정해주세요.
                </p>
              ) : null}

              {/* 데스크톱은 요약 박스 안 312×56, 모바일은 이 묶음이 하단 고정 바가 된다(CT-03). 모바일 바는 예상 총액이
                  확정된 동안 금액을 싣고(레퍼런스 "₩금액 주문하기"), 아니면 데스크톱과 같은 수량 문구다 — 화면에 보이는 문구
                  하나만 접근 이름이 된다(나머지는 display:none). */}
              <div className="wc-cart__cta-bar">
                <WcButton
                  className={`wc-cart__checkout${estimatedTotal !== null ? ' wc-cart__checkout--amount' : ''}`}
                  disabled={!canCheckout}
                  href="/checkout"
                  variant="primary"
                >
                  <span className="wc-cart__checkout-count">{`${count}개 굿즈 주문하기`}</span>
                  {estimatedTotal !== null ? <span className="wc-cart__checkout-amount">{`${krw(estimatedTotal)} 주문하기`}</span> : null}
                </WcButton>
              </div>
              {giftAvailable ? <Link className="wc-cart__gift" href="/gifts/new">장바구니에서 선물 준비</Link> : null}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
