'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useCart } from '@/components/shell/CartProvider';
import { Icon } from '@/components/ui/Icon';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Good, Ip } from '@/lib/data';
import { krw } from '@/lib/format';

interface CartLine {
  goodId: string;
  qty: number;
  good?: Good;
  ip?: Ip;
}

function CartQuantity({
  line,
  pending,
  onSetQuantity,
}: {
  line: CartLine;
  pending: boolean;
  onSetQuantity: (qty: number) => void;
}) {
  const { good, qty } = line;
  if (!good) return null;

  const soldout = good.stock === 'soldout' || good.stockQty <= 0;
  const insufficient = !soldout && qty > good.stockQty;
  const canAdd = !soldout && qty < good.stockQty;
  const nextLowerQty = insufficient ? good.stockQty : qty - 1;

  return (
    <div className="cart-quantity" aria-label={`${good.name} 수량`}>
      <button
        type="button"
        aria-label={`${good.name} 수량 줄이기`}
        disabled={pending || soldout}
        onClick={() => onSetQuantity(nextLowerQty)}
      >
        −
      </button>
      <span className="mono" aria-live="polite">{qty}</span>
      <button
        type="button"
        aria-label={`${good.name} 수량 늘리기`}
        disabled={pending || !canAdd}
        onClick={() => onSetQuantity(qty + 1)}
      >
        +
      </button>
    </div>
  );
}

function CartLineItem({ line }: { line: CartLine }) {
  const { pending, remove, setQuantity } = useCart();
  const { good, ip, qty, goodId } = line;

  if (!good) {
    return (
      <article className="cart-line cart-line--invalid">
        <div className="cart-line-art cart-line-art--invalid" aria-hidden>
          <Icon name="bag" size={28} />
        </div>
        <div className="cart-line-copy">
          <span className="cart-line-state cart-line-state--danger">판매 종료</span>
          <h2>판매 종료된 굿즈 ({goodId})</h2>
          <p>현재 카탈로그에서 판매 정보를 확인할 수 없어요.</p>
        </div>
        <button
          type="button"
          className="cart-remove"
          aria-label={`판매 종료된 굿즈 ${goodId} 삭제`}
          disabled={pending}
          onClick={() => void remove(goodId)}
        >
          <Icon name="close" size={18} />
          <span>삭제</span>
        </button>
      </article>
    );
  }

  const soldout = good.stock === 'soldout' || good.stockQty <= 0;
  const insufficient = !soldout && qty > good.stockQty;
  const unavailable = soldout || insufficient;
  const statusLabel = soldout
    ? '품절'
    : insufficient
      ? `재고 ${good.stockQty}개만 남음`
      : good.stock === 'low'
        ? `재고 ${good.stockQty}개 남음`
        : `재고 ${good.stockQty}개`;
  const statusClass = unavailable
    ? ' cart-line-state--danger'
    : good.stock === 'low'
      ? ' cart-line-state--low'
      : '';

  return (
    <article className={`cart-line${unavailable ? ' cart-line--unavailable' : ''}`}>
      <div
        className="cart-line-art"
        aria-label={`${good.name} 이미지`}
        role="img"
        style={{ background: good.img, backgroundPosition: 'center', backgroundSize: 'cover' }}
      >
        <span aria-hidden className="sheen" />
      </div>
      <div className="cart-line-copy">
        <div className="cart-line-meta">
          <span className="mono">{ip?.title ?? 'ICONS'}</span>
          <span aria-hidden>·</span>
          <span>{good.type}</span>
        </div>
        <h2>{good.name}</h2>
        <p className={`cart-line-state${statusClass}`}>{statusLabel}</p>
        <div className="cart-line-actions">
          <CartQuantity
            line={line}
            pending={pending}
            onSetQuantity={(nextQty) => void setQuantity(goodId, nextQty, good.stockQty)}
          />
          <span className="cart-line-total mono">{krw(good.price * qty)}</span>
        </div>
      </div>
      <button
        type="button"
        className="cart-remove"
        aria-label={`${good.name} 장바구니에서 삭제`}
        disabled={pending}
        onClick={() => void remove(goodId)}
      >
        <Icon name="close" size={18} />
        <span>삭제</span>
      </button>
    </article>
  );
}

export function Cart({
  catalog,
}: {
  catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>;
}) {
  const { items, count, ready, mode, pending, error } = useCart();

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
  const unavailableCount = lines.filter(({ good, qty }) => (
    !good || good.stock === 'soldout' || good.stockQty <= 0 || qty > good.stockQty
  )).length;

  return (
    <main className="cart-page">
      <header className="cart-header">
        <div className="wrap">
          <div className="eyebrow rise" style={{ color: 'var(--amber)' }}>사요 · 장바구니</div>
          <div className="cart-header-row rise">
            <h1 className="h-xl">담아둔 굿즈</h1>
            <span className="cart-mode mono">
              {!ready ? '장바구니 확인 중' : mode === 'server' ? '계정에 저장됨' : '이 기기에 저장됨'}
            </span>
          </div>
          <p className="cart-header-copy">수량과 재고를 확인하고 다음 단계를 준비해요.</p>
        </div>
      </header>

      <section className="cart-section">
        <div className="wrap">
          {error && <div className="cart-alert" role="alert">{error}</div>}

          {!ready ? (
            <div className="cart-loading" role="status" aria-live="polite">
              <span className="cart-loading-dot" aria-hidden />
              장바구니를 불러오는 중이에요.
            </div>
          ) : lines.length === 0 ? (
            <div className="cart-empty card">
              <div className="cart-empty-icon"><Icon name="bag" size={30} /></div>
              <h2>아직 담은 굿즈가 없어요</h2>
              <p>굿즈샵에서 최애의 물건을 찾아보세요.</p>
              <Link className="btn btn-holo" href="/shop">굿즈 보러 가기</Link>
            </div>
          ) : (
            <div className="cart-layout">
              <div className="cart-list" aria-busy={pending}>
                <div className="cart-list-head">
                  <h2>장바구니</h2>
                  <span className="mono">{count}개</span>
                </div>
                {lines.map((line) => <CartLineItem key={line.goodId} line={line} />)}
              </div>

              <aside className="cart-summary card" aria-label="주문 요약">
                <h2>주문 요약</h2>
                <div className="cart-summary-row">
                  <span>굿즈 금액</span>
                  <strong className="mono">{krw(subtotal)}</strong>
                </div>
                <div className="cart-summary-row cart-summary-row--dim">
                  <span>배송비</span>
                  <span>무료</span>
                </div>
                <div className="cart-summary-total">
                  <span>예상 결제 금액</span>
                  <strong className="mono">{krw(subtotal)}</strong>
                </div>
                {unavailableCount > 0 && (
                  <p className="cart-summary-warning" role="alert">
                    주문할 수 없는 굿즈 {unavailableCount}개를 삭제하거나 수량을 조정해주세요.
                  </p>
                )}
                {unavailableCount === 0 && !pending ? (
                  <Link className="btn cart-checkout" href="/checkout">체크아웃</Link>
                ) : (
                  <button className="btn cart-checkout" type="button" disabled>체크아웃</button>
                )}
                <p className="money-caption">로그인 후 배송지를 확인하고 안전하게 결제합니다.</p>
                <Link className="btn btn-ghost" href="/shop">굿즈 더 보기</Link>
              </aside>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
