import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PriceBlock } from './PriceBlock';

describe('PriceBlock', () => {
  it('shows a bare amount when there is no comparison price', () => {
    const html = renderToStaticMarkup(<PriceBlock price={12000} />);

    expect(html).toContain('₩12,000');
    expect(html).not.toContain('<s ');
    expect(html).not.toContain('wc-price__original');
    expect(html).not.toContain('wc-price__rate');
    expect(html).not.toContain('%');
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
});
