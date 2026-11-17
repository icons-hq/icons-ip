import { krw } from '@/lib/format';

export interface PriceBlockProps {
  price: number;
  priceMax?: number;
  compareAtPrice?: number | null;
  /** Controls presentation only; sale prices and order calculations stay unchanged. */
  showDiscountRate?: boolean;
  className?: string;
  /**
   * 'stack'(기본)은 취소선 정가 위에 할인율·판매가 줄을 쌓는다(상세·장바구니·위시 등 옛 표면 그대로).
   * 'inline'은 상품 카드용 한 줄이다 — 정가를 그리지 않고 할인율과 판매가만 보인다(X SQUARE Figma).
   * 표시만 다르고 가격·할인율 계산은 같다.
   */
  variant?: 'stack' | 'inline';
}

export function PriceBlock({ className, compareAtPrice, price, priceMax, showDiscountRate = true, variant = 'stack' }: PriceBlockProps) {
  /* compareAtPrice가 판매가와 같거나 더 싼 경우까지 세일로 치면 `0%`나 음수 할인율이
     노출된다. 정가가 판매가보다 높을 때만 할인 표기로 넘어간다. */
  const ranged = priceMax != null && priceMax > price;
  const onSale = showDiscountRate && !ranged && compareAtPrice != null && compareAtPrice > price;
  const rate = onSale ? Math.round((1 - price / compareAtPrice) * 100) : 0;

  const inline = variant === 'inline';

  return (
    <div className={`wc-price${inline ? ' wc-price--inline' : ''}${className ? ` ${className}` : ''}`}>
      {onSale && !inline ? <s className="wc-price__original">{krw(compareAtPrice)}</s> : null}
      <div className="wc-price__row">
        {onSale ? <span className="wc-price__rate">{`${rate}%`}</span> : null}
        <span className="wc-price__amount">{ranged ? `${krw(price)} ~ ${krw(priceMax)}` : krw(price)}</span>
      </div>
    </div>
  );
}
