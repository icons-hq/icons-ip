import { krw } from '@/lib/format';

export interface PriceBlockProps {
  price: number;
  priceMax?: number;
  compareAtPrice?: number | null;
  className?: string;
}

export function PriceBlock({ className, compareAtPrice, price, priceMax }: PriceBlockProps) {
  /* compareAtPrice가 판매가와 같거나 더 싼 경우까지 세일로 치면 `0%`나 음수 할인율이
     노출된다. 정가가 판매가보다 높을 때만 할인 표기로 넘어간다. */
  const ranged = priceMax != null && priceMax > price;
  const onSale = !ranged && compareAtPrice != null && compareAtPrice > price;
  const rate = onSale ? Math.round((1 - price / compareAtPrice) * 100) : 0;

  return (
    <div className={`wc-price${className ? ` ${className}` : ''}`}>
      {onSale ? <s className="wc-price__original">{krw(compareAtPrice)}</s> : null}
      <div className="wc-price__row">
        {onSale ? <span className="wc-price__rate">{`${rate}%`}</span> : null}
        <span className="wc-price__amount">{ranged ? `${krw(price)} ~ ${krw(priceMax)}` : krw(price)}</span>
      </div>
    </div>
  );
}
