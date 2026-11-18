import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Good, GoodOption } from '@/lib/data';
import type { GoodsVariantSupply } from '@/lib/goods-preorders';
import type { ShopListQuery, ShopListResult } from '@/lib/shop-catalog';
import { CollectionBrowser } from './CollectionBrowser';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/shop/AddToCartButton', () => ({ AddToCartButton: () => null }));

/* review-b m7 — 검색·IP관 카드도 목록·홈과 같은 칩(예약판매·무료배송·캡슐토이)을 가격 아래에 단다. 같은 굿즈가 화면마다 다르게 보이지 않게 한다. */
const openSupply: GoodsVariantSupply = {
  mode: 'preorder', availableQty: 3, policyId: '11111111-1111-4111-8111-111111111111', policyRevision: 1, state: 'open',
  startsAt: '2026-11-10T00:00:00.000Z', endsAt: '2026-12-10T00:00:00.000Z', expectedShipDate: '2026-12-20',
  calculatedAt: '2026-11-17T00:00:00.000Z', nextChangeAt: '2026-12-10T00:00:00.000Z',
};
const option = (id: string, patch: Partial<GoodOption> = {}): GoodOption => ({ id, name: '기본', code: id, price: 15200, stockQty: 5, isDefault: true, attributes: {}, ...patch });
const good = (id: string, patch: Partial<Good> = {}): Good => ({
  id, name: `굿즈 ${id}`, ip: 'brand', type: '키링', price: 15200, badge: null, stock: 'ok', stockQty: 5, img: 'linear-gradient(#111, #222)', ...patch,
});

const goods: Good[] = [
  good('preorder', { options: [option('pre', { supply: openSupply })] }),
  good('free', { shippingFeeType: 'free', badge: 'NEW' }),
  good('capsule', { optionSaleMode: 'random', options: [option('rand', { name: '랜덤' })] }),
  good('sale', { compareAtPrice: 16000, showDiscountRate: true }),
];
const query: ShopListQuery = { ips: [], types: [], priceMin: null, priceMax: null, sort: 'relevance', view: 'search' };
const result: ShopListResult = {
  goods, filteredTotal: goods.length, total: goods.length, priceCeil: 20000,
  ipFacets: [{ value: 'brand', label: '브랜드', count: goods.length }], typeFacets: [{ value: '예약판매', label: '예약판매', count: 1 }],
};

function card(html: string, name: string) {
  const start = html.indexOf(`>${name}</a>`);
  expect(start, name).toBeGreaterThan(-1);
  const from = html.lastIndexOf('<article', start);
  return html.slice(from, html.indexOf('</article>', start));
}

describe('CollectionBrowser product cards', () => {
  const html = renderToStaticMarkup(
    <CollectionBrowser countNoun="결과" hrefFor={() => '/search?q=키링'} query={query} result={result} sorts={['relevance']} />,
  );

  it('draws the same chips as listing and home cards', () => {
    expect(card(html, '굿즈 preorder')).toContain('<span class="wc-x-chip wc-x-chip--preorder">예약판매</span>');
    expect(card(html, '굿즈 free')).toContain('<span class="wc-x-chip wc-x-chip--freeShipping">무료배송</span>');
    expect(card(html, '굿즈 free')).toContain('<span class="wc-x-chip wc-x-chip--tag">NEW</span>');
    expect(card(html, '굿즈 capsule')).toContain('<span class="wc-x-chip wc-x-chip--random">캡슐토이</span>');
    expect(card(html, '굿즈 sale')).not.toContain('wc-x-chip');
  });

  it('예약판매 facet 이 있으면 타입 그룹을, 없으면 사이드바·시트 탭 모두 그리지 않는다', () => {
    expect(html).toContain('타입 (0)');
    const none = renderToStaticMarkup(
      <CollectionBrowser countNoun="결과" hrefFor={() => '/search?q=키링'} query={query} result={{ ...result, typeFacets: [] }} sorts={['relevance']} />,
    );
    expect(none).not.toContain('타입');
  });

  it('예약판매가 없는 스코프에 남은 type 값은 필터 개수·배지로 세지 않는다', () => {
    const stale: ShopListQuery = { ...query, types: ['예약판매'] };
    const none = renderToStaticMarkup(
      <CollectionBrowser countNoun="결과" hrefFor={() => '/search?q=키링'} query={stale} result={{ ...result, typeFacets: [] }} sorts={['relevance']} />,
    );
    expect(none).not.toContain('적용됨');
    expect(none).not.toContain('wc-filter-trigger__count');
    const withFacet = renderToStaticMarkup(
      <CollectionBrowser countNoun="결과" hrefFor={() => '/search?q=키링'} query={stale} result={result} sorts={['relevance']} />,
    );
    expect(withFacet).toContain('필터, 1개 적용됨');
  });

  it('keeps the discount rate on the price line and drops the old SALE badge', () => {
    expect(card(html, '굿즈 sale')).toContain('<span class="wc-price__rate">5%</span>');
    expect(html).not.toContain('>SALE<');
  });
});
