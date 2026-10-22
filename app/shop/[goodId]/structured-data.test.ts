import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Good } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { EMPTY_GOODS_NOTICE } from '@/lib/goods-notice';
import {
  absoluteHttpUrl,
  breadcrumbJsonLd,
  cssBackgroundImageUrl,
  goodDescriptionText,
  goodImageUrls,
  goodOfferAvailability,
  goodOfferPrices,
  jsonLdText,
  productJsonLd,
  siteOrigin,
} from './structured-data';

const ORIGIN = 'https://iconsip.test';
const good: Good = {
  id: 'g13', name: '아크릴 블록', ip: 'hong-sil-quest', type: '아크릴', price: 12000, badge: null, stock: 'ok', stockQty: 8,
  img: 'url("/generated/goods/g13.png") center / cover no-repeat, linear-gradient(#111, #222)',
  options: [{ id: '00000000-0000-4000-8000-000000000501', name: '기본 옵션', code: 'G13', price: 12000, stockQty: 8, isDefault: true, attributes: {} }],
};
const detail: GoodDetailContent = {
  good,
  ip: { id: 'hong-sil-quest', title: '홍실 퀘스트', sub: '', v: { key: 'character', label: '캐릭터 IP', color: '#FFD84D' }, glyph: '홍실',
    bg: 'linear-gradient(#300008, #FF2E63)', fans: 0, goods: 3, cards: 0, featured: false, tagline: '', synopsis: '' },
  description: '<p>붉은 실 &amp; 아크릴</p><script>alert(1)</script><p>두 번째   문단</p>',
  descriptionFormat: 'html',
  gallery: ['url("https://cdn.example/g13-1.webp") center / cover no-repeat', 'linear-gradient(#000, #fff)', 'url("/generated/goods/g13.png")'],
  detailImageUrl: null,
  notice: EMPTY_GOODS_NOTICE,
};

afterEach(() => { vi.unstubAllEnvs(); });

describe('PDP 구조화 데이터 (PD-17)', () => {
  it('운영 SITE_URL 을 절대 주소 기준으로 쓰고 없으면 운영 도메인이다', () => {
    vi.stubEnv('SITE_URL', 'https://preview.iconsip.test/');
    expect(siteOrigin()).toBe('https://preview.iconsip.test');
    vi.stubEnv('SITE_URL', '');
    expect(siteOrigin()).toBe('https://iconsip.com');
  });

  it('CSS 배경값에서 이미지 주소만 꺼내 절대 주소로 펼친다', () => {
    expect(cssBackgroundImageUrl(good.img)).toBe('/generated/goods/g13.png');
    expect(cssBackgroundImageUrl("url('https://cdn.example/a.webp') center")).toBe('https://cdn.example/a.webp');
    expect(cssBackgroundImageUrl('linear-gradient(#111, #222)')).toBeNull();
    expect(absoluteHttpUrl('/generated/goods/g13.png', ORIGIN)).toBe('https://iconsip.test/generated/goods/g13.png');
    expect(absoluteHttpUrl('data:image/png;base64,AAAA', ORIGIN)).toBeNull();
    /* 대표 → 추가 이미지 순서, gradient 는 건너뛰고 같은 주소는 한 번만. */
    expect(goodImageUrls(detail, ORIGIN)).toEqual(['https://iconsip.test/generated/goods/g13.png', 'https://cdn.example/g13-1.webp']);
  });

  it('HTML 설명은 태그·스크립트를 떼고 평문으로 줄이며 비면 메타 설명을 쓴다', () => {
    expect(goodDescriptionText(detail)).toBe('붉은 실 & 아크릴 두 번째 문단');
    expect(goodDescriptionText({ ...detail, description: '  ', descriptionFormat: 'plain' }))
      .toBe('아크릴 블록 굿즈의 구성, 고시정보, 리뷰, 배송과 교환·반품 안내를 확인하세요.');
    expect([...goodDescriptionText({ ...detail, description: '가'.repeat(900), descriptionFormat: 'plain' })]).toHaveLength(500);
  });

  it('Product 에 이름·이미지·설명·브랜드(IP)·가격·통화·재고 상태를 싣는다', () => {
    const product = productJsonLd(detail, ORIGIN);

    expect(product).toMatchObject({
      '@context': 'https://schema.org', '@type': 'Product', name: '아크릴 블록', url: 'https://iconsip.test/shop/g13',
      image: ['https://iconsip.test/generated/goods/g13.png', 'https://cdn.example/g13-1.webp'],
      brand: { '@type': 'Brand', name: '홍실 퀘스트' },
      offers: { '@type': 'Offer', price: 12000, priceCurrency: 'KRW', availability: 'https://schema.org/InStock', url: 'https://iconsip.test/shop/g13' },
    });
    expect(productJsonLd({ ...detail, ip: null }, ORIGIN)).not.toHaveProperty('brand');
  });

  it('옵션 가격이 다르면 AggregateOffer 로 최저·최고가를 낸다', () => {
    const options = [
      { id: 'a', name: 'A', code: 'A', price: 12000, stockQty: 3, isDefault: true, attributes: {} },
      { id: 'b', name: 'B', code: 'B', price: 15000, stockQty: 0, isDefault: false, attributes: {} },
    ];
    expect(goodOfferPrices({ price: 12000, options })).toEqual({ low: 12000, high: 15000, count: 2 });
    expect(productJsonLd({ ...detail, good: { ...good, options } }, ORIGIN).offers)
      .toMatchObject({ '@type': 'AggregateOffer', lowPrice: 12000, highPrice: 15000, offerCount: 2, priceCurrency: 'KRW' });
  });

  it('재고 상태는 화면의 구매 가능 판정과 같다', () => {
    expect(goodOfferAvailability(good)).toBe('https://schema.org/InStock');
    expect(goodOfferAvailability({ ...good, stock: 'soldout' })).toBe('https://schema.org/OutOfStock');
    expect(goodOfferAvailability({ ...good, options: [{ ...good.options![0], stockQty: 0 }] })).toBe('https://schema.org/OutOfStock');
    expect(goodOfferAvailability({ ...good, salePeriod: { state: 'ended', startsAt: null, endsAt: '2026-10-01T00:00:00Z', calculatedAt: '2026-10-22T00:00:00Z', nextChangeAt: null } }))
      .toBe('https://schema.org/OutOfStock');
    expect(goodOfferAvailability({ ...good, allowCardPayment: false, allowBankTransfer: false })).toBe('https://schema.org/OutOfStock');
    const preorder = { ...good.options![0], supply: { mode: 'preorder' as const, state: 'open' as const, availableQty: 5, policyId: null, policyRevision: null,
      startsAt: null, endsAt: null, expectedShipDate: '2026-11-20', calculatedAt: '2026-10-22T00:00:00Z', nextChangeAt: null } };
    expect(goodOfferAvailability({ ...good, options: [preorder] })).toBe('https://schema.org/PreOrder');
  });

  it('BreadcrumbList 는 홈 → 굿즈샵 → 굿즈다', () => {
    expect(breadcrumbJsonLd(detail, ORIGIN).itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: '홈', item: 'https://iconsip.test/' },
      { '@type': 'ListItem', position: 2, name: '굿즈샵', item: 'https://iconsip.test/shop' },
      { '@type': 'ListItem', position: 3, name: '아크릴 블록', item: 'https://iconsip.test/shop/g13' },
    ]);
  });

  it('스크립트 본문은 운영 입력 문자열이 스크립트를 닫지 못하게 < 를 이스케이프한다', () => {
    const text = jsonLdText({ name: '</script><script>alert(1)</script>' });
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual({ name: '</script><script>alert(1)</script>' });
  });
});
