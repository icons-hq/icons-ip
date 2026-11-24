import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PriceBlock } from './PriceBlock';

describe('PriceBlock', () => {
  it('hides only the original and rate when the operator disables discount display', () => {
    const html = renderToStaticMarkup(<PriceBlock showDiscountRate={false} compareAtPrice={12000} price={9000} />);
    expect(html).toContain('₩9,000');
    expect(html).not.toContain('₩12,000');
    expect(html).not.toContain('wc-price__rate');
    expect(html).not.toContain('<s ');
  });
  it('shows a bare amount when there is no comparison price', () => {
    const html = renderToStaticMarkup(<PriceBlock price={12000} />);

    expect(html).toContain('₩12,000');
    expect(html).not.toContain('<s ');
    expect(html).not.toContain('wc-price__original');
    expect(html).not.toContain('wc-price__rate');
    expect(html).not.toContain('%');
  });

  /* MD-0049 — 옵션 가격이 다르면 범위 대신 최저가만 보이고, 보조기기에는 '최저가'를 앞에 읽힌다. */
  it('shows only the lowest option price without a misleading discount rate', () => {
    const html = renderToStaticMarkup(<PriceBlock price={12000} priceMax={15000} compareAtPrice={16000} />);
    expect(html).toContain('<span class="wc-sr-only">최저가 </span><span class="wc-price__amount">₩12,000</span>');
    expect(html).not.toContain('₩15,000');
    expect(html).not.toContain('wc-price__rate');
  });

  it('shows the struck original, the rate and the sale amount', () => {
    const html = renderToStaticMarkup(<PriceBlock compareAtPrice={12000} price={9000} />);

    expect(html).toContain('<s class="wc-price__original">₩12,000</s>');
    expect(html).toContain('<span class="wc-price__rate">25%</span>');
    expect(html).toContain('<span class="wc-price__amount">₩9,000</span>');
  });

  /* 정가가 판매가와 같거나 더 싼 데이터가 들어오면 `0%`·음수 할인율이 그대로 노출된다.
     세일 표기는 정가가 실제로 더 비쌀 때만 켠다. */
  it('does not treat a comparison price at or below the price as a sale', () => {
    for (const compareAtPrice of [9000, 8000]) {
      const html = renderToStaticMarkup(<PriceBlock compareAtPrice={compareAtPrice} price={9000} />);

      expect(html).not.toContain('<s ');
      expect(html).not.toContain('wc-price__original');
      expect(html).not.toContain('wc-price__rate');
      expect(html).not.toContain('%');
      expect(html).toContain('₩9,000');
    }
  });

  it('ignores a null comparison price', () => {
    const html = renderToStaticMarkup(<PriceBlock compareAtPrice={null} price={9000} />);

    expect(html).not.toContain('wc-price__original');
    expect(html).toContain('₩9,000');
  });

  /* 기본('stack')은 지금 그대로 — 상세·장바구니·위시가 쓰는 취소선 정가 + 할인율 + 판매가다. */
  it('keeps the stacked presentation by default', () => {
    const html = renderToStaticMarkup(<PriceBlock compareAtPrice={12000} price={9000} />);

    expect(html.startsWith('<div class="wc-price">')).toBe(true);
    expect(html).not.toContain('wc-price--inline');
    expect(html).toContain('<s class="wc-price__original">₩12,000</s>');
    expect(renderToStaticMarkup(<PriceBlock compareAtPrice={12000} price={9000} variant="stack" />)).toBe(html);
  });

  /* 'inline'(상품 카드)은 정가를 그리지 않고 할인율과 판매가만 한 줄로 보인다. 계산은 같다. */
  it('draws the inline variant without the struck original but with the same rate and amount', () => {
    const html = renderToStaticMarkup(<PriceBlock compareAtPrice={12000} price={9000} variant="inline" />);

    expect(html.startsWith('<div class="wc-price wc-price--inline">')).toBe(true);
    expect(html).not.toContain('<s ');
    expect(html).not.toContain('wc-price__original');
    expect(html).not.toContain('₩12,000');
    expect(html).toContain('<span class="wc-price__rate">25%</span>');
    expect(html).toContain('<span class="wc-price__amount">₩9,000</span>');
  });

  it('keeps the inline variant honest about ranges, hidden discounts and missing comparison prices', () => {
    const ranged = renderToStaticMarkup(<PriceBlock compareAtPrice={16000} price={12000} priceMax={15000} variant="inline" />);
    expect(ranged).toContain('<span class="wc-price__amount">₩12,000</span>');
    expect(ranged).not.toContain('₩15,000');
    expect(ranged).not.toContain('wc-price__rate');

    const hidden = renderToStaticMarkup(<PriceBlock compareAtPrice={12000} price={9000} showDiscountRate={false} variant="inline" />);
    expect(hidden).not.toContain('wc-price__rate');
    expect(hidden).toContain('₩9,000');

    const bare = renderToStaticMarkup(<PriceBlock price={9000} variant="inline" />);
    expect(bare).not.toContain('%');
    expect(bare).toContain('₩9,000');
  });

  it('passes extra class names through on both variants', () => {
    expect(renderToStaticMarkup(<PriceBlock className="x" price={9000} />)).toContain('class="wc-price x"');
    expect(renderToStaticMarkup(<PriceBlock className="x" price={9000} variant="inline" />)).toContain('class="wc-price wc-price--inline x"');
  });
});
