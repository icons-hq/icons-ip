import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { PdpPrice, pdpPriceView } from './PdpPrice';

/* 화면에 보이는 마크업만 남긴다 — 숨은 라벨을 빼면 목록 카드의 PriceBlock 과 같아야 한다. */
const visible = (html: string) => html.replace(/<span class="wc-sr-only">[^<]*<\/span>/g, '');

describe('PdpPrice', () => {
  it.each([
    { price: 12000 },
    { price: 12000, compareAtPrice: 18000 },
    { price: 12000, compareAtPrice: 18000, showDiscountRate: false },
    { price: 12000, priceMax: 15000, compareAtPrice: 18000 },
    { price: 12000, compareAtPrice: 12000 },
    { price: 12000, compareAtPrice: null },
  ])('보이는 가격 표기는 PriceBlock 과 같다: %o', (props) => {
    expect(visible(renderToStaticMarkup(<PdpPrice {...props} />))).toBe(renderToStaticMarkup(<PriceBlock {...props} />));
  });

  it('할인 중이면 정가·할인율·할인가, 아니면 가격으로 읽힌다', () => {
    expect(pdpPriceView({ price: 12000, compareAtPrice: 18000 })).toEqual({ original: '₩18,000', rate: '33%', amount: '₩12,000', amountLabel: '할인가' });
    expect(pdpPriceView({ price: 12000, compareAtPrice: 18000, showDiscountRate: false })).toMatchObject({ original: null, rate: null, amountLabel: '가격' });
    expect(pdpPriceView({ price: 12000, priceMax: 15000 })).toMatchObject({ amount: '₩12,000 ~ ₩15,000', amountLabel: '가격' });
  });
});
