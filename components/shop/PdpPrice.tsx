import { krw } from '@/lib/format';

/*
 * 굿즈 상세의 가격 블록 (PD-15 · R-04 §3.3).
 *
 * 화면은 목록 카드의 PriceBlock 과 같다(같은 클래스·같은 할인 표기 규칙). 다른 점은 보조기기
 * 라벨뿐이다 — 취소선 금액과 판매 금액이 나란히 "₩18,000 33% ₩12,000"으로만 읽히면 어느 쪽을
 * 내는지 알 수 없다. 레퍼런스처럼 시각 라벨은 숨기고(R-04 §3.3 라벨은 화면에 보이지 않는다)
 * 정가·할인율·할인가를 읽어 준다. 할인 표기를 끈 굿즈(#543)는 할인가가 실제 결제가여도
 * '정가'라 부르면 틀리므로 중립어 '가격'을 쓴다.
 */
export function pdpPriceView({ compareAtPrice, price, priceMax, showDiscountRate = true }: {
  price: number;
  priceMax?: number;
  compareAtPrice?: number | null;
  showDiscountRate?: boolean;
}) {
  /* PriceBlock 과 같은 판정 — 정가가 판매가보다 높을 때만, 가격 범위가 아닐 때만 할인으로 본다. */
  const ranged = priceMax != null && priceMax > price;
  const onSale = showDiscountRate && !ranged && compareAtPrice != null && compareAtPrice > price;
  return {
    original: onSale ? krw(compareAtPrice) : null,
    rate: onSale ? `${Math.round((1 - price / compareAtPrice) * 100)}%` : null,
    amount: ranged ? `${krw(price)} ~ ${krw(priceMax)}` : krw(price),
    amountLabel: onSale ? '할인가' : '가격',
  };
}

export function PdpPrice({ className, ...price }: {
  className?: string;
  price: number;
  priceMax?: number;
  compareAtPrice?: number | null;
  showDiscountRate?: boolean;
}) {
  const view = pdpPriceView(price);

  return (
    <div className={`wc-price${className ? ` ${className}` : ''}`}>
      {view.original ? <><span className="wc-sr-only">정가</span><s className="wc-price__original">{view.original}</s></> : null}
      <div className="wc-price__row">
        {view.rate ? <><span className="wc-sr-only">할인율</span><span className="wc-price__rate">{view.rate}</span></> : null}
        <span className="wc-sr-only">{view.amountLabel}</span>
        <span className="wc-price__amount">{view.amount}</span>
      </div>
    </div>
  );
}
