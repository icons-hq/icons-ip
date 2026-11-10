import sanitizeHtml from 'sanitize-html';
import type { Good } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { goodDetailHref } from '@/lib/goods-display';
import { goodsPurchaseConditionProblem } from '@/lib/goods-options';
import { goodsSaleUnavailableLabel } from '@/lib/goods-sale-period';

/*
 * 굿즈 상세의 구조화 데이터 (PD-17 · 11 §7 SEO).
 *
 * JSON-LD Product·BreadcrumbList 와 Open Graph 이미지·가격을 만든다. 공개 상세 로더가 미공개·
 * 판매 제한 굿즈를 이미 404 로 돌리므로(lib/catalog getCatalogGoodDetail) 여기 오는 굿즈는 전부
 * 공개 굿즈다 — 노출 규칙을 이 모듈에서 다시 정하지 않는다. 가격·재고 상태는 화면과 같은 공개
 * 카탈로그 값이고 결제 금액의 근거가 아니다.
 */

const DESCRIPTION_MAX = 500;

/** 구조화 데이터·OG 의 절대 주소 기준. 운영 SITE_URL 을 따르고, 없으면 운영 도메인이다. */
export function siteOrigin(): string {
  return (process.env.SITE_URL?.trim() || 'https://iconsip.com').replace(/\/+$/, '');
}

/** CSS 배경 축약값(`url("…") center / cover`)에서 첫 이미지 주소. 이미지가 없는 gradient 는 null. */
export function cssBackgroundImageUrl(background: string | null | undefined): string | null {
  const match = background?.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i);
  const url = match ? (match[1] ?? match[2] ?? match[3] ?? '').trim() : '';
  return url || null;
}

/** 상대 주소(`/generated/…`)는 사이트 기준으로 펼치고, http(s) 가 아닌 주소(data: 등)는 버린다. */
export function absoluteHttpUrl(url: string, origin: string): string | null {
  try {
    const resolved = new URL(url, `${origin}/`);
    return resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.toString() : null;
  } catch {
    return null;
  }
}

/** 대표 이미지 → 추가 이미지 순서의 절대 이미지 주소(중복 제거). */
export function goodImageUrls(detail: Pick<GoodDetailContent, 'good' | 'gallery'>, origin: string): string[] {
  const urls = [detail.good.img, ...detail.gallery]
    .map(cssBackgroundImageUrl)
    .flatMap((url) => (url ? [absoluteHttpUrl(url, origin)] : []))
    .filter((url): url is string => url !== null);
  return [...new Set(urls)];
}

function decodeBasicEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name] ?? _);
}

/** 상세 설명의 평문 요약. HTML 설명은 태그를 떼고, 비어 있으면 메타 설명 문장을 쓴다. */
export function goodDescriptionText(detail: Pick<GoodDetailContent, 'good' | 'description' | 'descriptionFormat'>): string {
  const raw = detail.description ?? '';
  /* 태그마다 앞에 공백을 두고 떼어 낸다 — 문단·목록 경계가 사라져 앞뒤 낱말이 붙지 않게. */
  const text = (detail.descriptionFormat === 'html'
    ? decodeBasicEntities(sanitizeHtml(raw.replace(/</g, ' <'), { allowedTags: [], allowedAttributes: {} }))
    : raw).replace(/\s+/g, ' ').trim();
  if (!text) return goodMetaDescription(detail.good.name);
  return [...text].length > DESCRIPTION_MAX ? `${[...text].slice(0, DESCRIPTION_MAX - 1).join('')}…` : text;
}

export function goodMetaDescription(name: string): string {
  return `${name} 굿즈의 구성, 고시정보, 리뷰, 배송과 교환·반품 안내를 확인하세요.`;
}

/** 공개 카탈로그 기준 가격 범위. 옵션이 있으면 옵션 판매가, 없으면 굿즈 판매가다. */
export function goodOfferPrices(good: Pick<Good, 'price' | 'options'>): { low: number; high: number; count: number } {
  const prices = good.options?.length ? good.options.map((option) => option.price) : [good.price];
  return { low: Math.min(...prices), high: Math.max(...prices), count: prices.length };
}

/**
 * 상품 Open Graph 태그(PD-17 · 레퍼런스 `og:type=product`·`og:price:*`).
 * Next metadata 의 openGraph.type 에는 product 가 없고 `other`는 `<meta name>`으로 그려져 수집기가 읽지 않는다 —
 * 그래서 이 태그만 `property` 속성으로 페이지가 직접 낸다(React 가 <head>로 올린다). 가격은 JSON-LD 의 최저가와 같다.
 */
export function productOpenGraphTags(good: Pick<Good, 'price' | 'options'>): Array<{ property: string; content: string }> {
  return [
    { property: 'og:type', content: 'product' },
    { property: 'og:price:amount', content: String(goodOfferPrices(good).low) },
    { property: 'og:price:currency', content: 'KRW' },
  ];
}

/** 지금 살 수 있는가. 판매 상태·판매 기간·구매 조건·옵션 재고가 화면의 구매 가능 판정과 같다. */
export function goodOfferAvailability(good: Good): string {
  const purchasableOptions = good.options?.filter((option) => option.stockQty > 0) ?? [];
  const sellable = good.stock !== 'soldout'
    && !goodsSaleUnavailableLabel(good.salePeriod)
    && !goodsPurchaseConditionProblem(good)
    && (good.options ? purchasableOptions.length > 0 : good.stockQty > 0);
  if (!sellable) return 'https://schema.org/OutOfStock';
  return purchasableOptions.length > 0 && purchasableOptions.every((option) => option.supply?.mode === 'preorder')
    ? 'https://schema.org/PreOrder'
    : 'https://schema.org/InStock';
}

export function productJsonLd(detail: GoodDetailContent, origin: string) {
  const { good, ip } = detail;
  const url = `${origin}${goodDetailHref(good.id)}`;
  const prices = goodOfferPrices(good);
  const availability = goodOfferAvailability(good);
  const images = goodImageUrls(detail, origin);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: good.name,
    ...(images.length ? { image: images } : {}),
    description: goodDescriptionText(detail),
    url,
    ...(ip ? { brand: { '@type': 'Brand', name: ip.title } } : {}),
    offers: prices.low === prices.high
      ? { '@type': 'Offer', url, price: prices.low, priceCurrency: 'KRW', availability }
      : { '@type': 'AggregateOffer', url, lowPrice: prices.low, highPrice: prices.high, offerCount: prices.count, priceCurrency: 'KRW', availability },
  };
}

export function breadcrumbJsonLd(detail: Pick<GoodDetailContent, 'good'>, origin: string) {
  const crumbs = [
    { name: '홈', item: `${origin}/` },
    { name: '굿즈샵', item: `${origin}/shop` },
    { name: detail.good.name, item: `${origin}${goodDetailHref(detail.good.id)}` },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, ...crumb })),
  };
}

/** `<script type="application/ld+json">` 본문. `<`를 유니코드 이스케이프해 운영 입력 문자열이 스크립트를 닫지 못하게 한다(Next JSON-LD 가이드). */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
