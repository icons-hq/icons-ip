'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useCart } from '@/components/shell/CartProvider';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/wc/EmptyState';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { QuantityStepper } from '@/components/wc/QuantityStepper';
import { WcButton } from '@/components/wc/WcButton';
import type { CatalogSnapshot } from '@/lib/catalog';
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

export function Cart({
  catalog,
}: {
  catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>;
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
                    {/* 쿠폰·프로모션이 아직 없어 항상 0이다. 자리를 비워두면 S7에서 표가 흔들린다. */}
                    <th scope="row">총 할인 금액</th>
                    <td>−{krw(0)}</td>
                  </tr>
                  <tr>
                    <th scope="row">배송비</th>
                    <td>{shippingFeeLabel(shippingFee)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">예상 총액</th>
                    <td>{krw(subtotal + shippingFee)}</td>
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

              <div className="wc-cart__coupon-slot">
                <p className="wc-cart__coupon-title">쿠폰</p>
                <p className="wc-cart__coupon-desc">쿠폰 적용은 곧 열려요.</p>
              </div>

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
