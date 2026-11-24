'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useStorePresentation } from '@/components/shell/StorePresentationProvider';
import { AddToCartButton } from '@/components/shop/AddToCartButton';
import type { Good } from '@/lib/data';
import type { GoodsListingAppearance } from '@/lib/store-presentation';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { goodsImageBackground } from '@/lib/goods-image';
import { reviewStarCount, reviewSummaryLabel, type GoodsReviewSummary } from '@/lib/goods-review-summary';
import type { GoodsSalePeriod } from '@/lib/goods-sale-period';
import { productCardUnavailableLabel, type ProductCardChip } from '@/lib/product-card-chips';

export type { ProductCardChip, ProductCardChipKind } from '@/lib/product-card-chips';

export interface ProductCardProps {
  href: string;
  name: string;
  brand?: string | null;
  price: number;
  priceMax?: number;
  compareAtPrice?: number | null;
  showDiscountRate?: boolean;
  /** 옛 배지 표기. `chips`가 없을 때만 쓰며 운영 배지('tag') 칩으로 바꿔 그린다 — 'SALE'은 버린다(할인은 가격 줄의 할인율이 대신한다). */
  badges?: string[];
  /** 가격 아래 칩 줄(`productCardChips` 결과). 넘기면 `badges`보다 앞서고 그대로 그린다 — 스토어 표시 설정(showTags)은 호출부가 이미 반영한 값이다. */
  chips?: readonly ProductCardChip[];
  soldOut?: boolean;
  salePeriod?: GoodsSalePeriod;
  /**
   * 판매 불가 문구(`productCardUnavailableLabel` 결과). 옵션 예약 상태를 싣지 않는 카드 뷰모델(홈·카테고리 추천·쇼핑 스토리)은
   * 서버가 채워 넘기고, 굿즈를 그대로 받는 카드는 넘기지 않아도 카드가 `salePeriod`·`cartGood`으로 같은 함수를 부른다.
   */
  unavailableLabel?: string | null;
  imageBackground?: string;
  image?: ReactNode;
  action?: ReactNode;
  className?: string;
  listSurface?: 'standard' | 'best' | 'story' | 'preview';
  listingAppearance?: GoodsListingAppearance;
  cartGood?: Good;
  imageShape?: 'square' | 'portrait';
  /** 성인 인증 전 방문자의 19금 굿즈 가림 카드(ADR-0024). 이미지·배지·담기·별점을 그리지 않고(이름·IP·가격은 보인다, MD-0048), action(찜 하트)은 넘긴 곳에서만 그린다. */
  masked?: boolean;
  /** 목록 카드 별점(CL-02) — 공개 리뷰가 있을 때만 넘어온다. 없으면 별점 줄을 그리지 않는다. */
  reviewSummary?: GoodsReviewSummary | null;
}

/*
 * 카드 전체를 링크로 덮지 않는다. 위시 하트 같은 action 이 링크 안에 들어가면 클릭이
 * 상세 이동까지 같이 일으키고, 링크 안의 버튼은 마크업으로도 잘못됐다.
 *
 * 이미지 링크는 접근성 트리에서 숨긴다. 안에 읽을 텍스트가 없어 접근 가능한 이름이
 * 빈 문자열이 되고(link-name, WCAG 2.4.4), 이름을 붙여도 바로 아래 이름 링크와 목적지가
 * 같아 스크린리더 링크 목록과 탭 순서에 상품마다 중복 항목이 하나씩 더 생긴다.
 * aria-hidden 안에 초점 가능한 요소를 두면 안 되므로 tabIndex 도 같이 뺀다.
 *
 * 품절 밴드는 그 숨긴 링크 안에 있어 스크린리더에 닿지 않는다. 이름 옆의 sr-only
 * '(품절)'·'(판매 예정)' 같은 문구가 그 상태를 대신 읽어주는 유일한 지점이다(WCAG 1.3.1).
 *
 * 가림 카드는 19 표지(썸네일 자리)와 IP·이름·가격을 그린다(MD-0048 — 썸네일만 가린다). 상세로 가는
 * 링크는 남긴다 — 상세가 인증 안내를 보여준다. 이미지는 서버에서 이미 지워져 오므로 여기서 숨기는 것은
 * 표시 정책일 뿐 보안 경계가 아니다.
 */
function MaskedProductCard({ action, className, href, name, price, priceMax, brand }: Pick<ProductCardProps, 'action' | 'className' | 'href' | 'name' | 'price' | 'priceMax' | 'brand'>) {
  return (
    <article className={`wc-product-card wc-product-card--masked${className ? ` ${className}` : ''}`}>
      <div className="wc-product-card__media">
        <Link aria-hidden className="wc-product-card__media-link" href={href} tabIndex={-1}>
          <div className="wc-product-card__image wc-product-card__adult-cover">
            <span className="wc-product-card__adult-mark">19</span>
          </div>
        </Link>
        {action ? <div className="wc-product-card__action">{action}</div> : null}
      </div>
      <div className="wc-product-card__info">
        {brand ? <p className="wc-product-card__brand">{brand}</p> : null}
        <h3 className="wc-product-card__name">
          <Link className="wc-product-card__name-link" href={href}>{name}</Link>
        </h3>
        <p className="wc-product-card__adult-note">성인 인증 후 볼 수 있어요</p>
        <PriceBlock price={price} priceMax={priceMax} variant="inline" />
      </div>
    </article>
  );
}

/* 옛 배지 문자열을 운영 배지 칩으로 바꾼다. SALE 은 파생 표기라 가격 줄의 할인율로 넘어가므로 버리고,
   BEST·NEW 는 스토어 표시 설정이 태그를 끈 목록 표면에서만 뺀다(기존 규칙 그대로). */
function badgeChips(badges: readonly string[] | undefined, hideListingTags: boolean): ProductCardChip[] {
  const seen = new Set<string>();
  const chips: ProductCardChip[] = [];
  for (const badge of badges ?? []) {
    const key = badge.trim().toUpperCase();
    if (!key || key === 'SALE' || seen.has(key)) continue;
    if (hideListingTags && (key === 'BEST' || key === 'NEW')) continue;
    seen.add(key);
    chips.push({ kind: 'tag', label: badge });
  }
  return chips;
}

export function ProductCard({
  action,
  badges,
  chips,
  brand,
  className,
  compareAtPrice,
  showDiscountRate,
  href,
  image,
  imageBackground,
  name,
  price,
  priceMax,
  soldOut,
  salePeriod,
  unavailableLabel,
  listSurface = 'preview',
  listingAppearance,
  cartGood,
  imageShape,
  masked,
  reviewSummary,
}: ProductCardProps) {
  const { listing } = useStorePresentation();
  const configured = listSurface !== 'preview';
  const gallery = configured && listing.imageMode === 'gallery' ? [...new Set([imageBackground ?? '', ...(listingAppearance?.gallery ?? [])])].filter(Boolean).slice(0, 10) : [];
  const [imageIndex, setImageIndex] = useState(0);
  const selectedImage = gallery.length ? gallery[imageIndex % gallery.length] : imageBackground;
  const cardChips = chips ?? badgeChips(badges, configured && !listing.showTags);
  /* 판매기간·예약 상태 문구가 품절보다 앞선다 — 접수 예정 예약판매는 재고 0이어도 'SOLD OUT'이 아니다(상세와 같은 판정). */
  const saleLabel = unavailableLabel
    ?? productCardUnavailableLabel({ salePeriod: salePeriod ?? cartGood?.salePeriod, options: cartGood?.options }, Boolean(soldOut));
  const availabilityLabel = saleLabel ?? (soldOut ? '품절' : null);
  if (masked) return <MaskedProductCard action={action} brand={brand} className={className} href={href} name={name} price={price} priceMax={priceMax} />;
  return (
    <article className={`wc-product-card${className ? ` ${className}` : ''}`} data-list-shape={configured ? imageShape ?? listing.imageShape : undefined}>
      <div className="wc-product-card__media">
        <Link aria-hidden className="wc-product-card__media-link" href={href} tabIndex={-1}>
          {image ?? <div className="wc-product-card__image" style={{ background: goodsImageBackground(selectedImage) }} />}
          {availabilityLabel ? (
            <div className="wc-product-card__soldout"><span>{saleLabel ?? 'SOLD OUT'}</span></div>
          ) : null}
        </Link>
        {action ? <div className="wc-product-card__action">{action}</div> : null}
        {gallery.length > 1 ? <div className="wc-product-card__gallery" aria-label={`${name} 이미지 선택`}><button type="button" aria-label={`${name} 이전 이미지`} onClick={() => setImageIndex(current => (current + gallery.length - 1) % gallery.length)}>‹</button><span aria-live="polite">{imageIndex % gallery.length + 1} / {gallery.length}</span><button type="button" aria-label={`${name} 다음 이미지`} onClick={() => setImageIndex(current => (current + 1) % gallery.length)}>›</button></div> : null}
      </div>
      <div className="wc-product-card__info">
        {brand ? <p className="wc-product-card__brand">{brand}</p> : null}
        <h3 className="wc-product-card__name">
          <Link className="wc-product-card__name-link" href={href}>{name}</Link>
          {availabilityLabel ? <span className="wc-sr-only"> ({availabilityLabel})</span> : null}
        </h3>
        {configured && listing.showColors && listingAppearance?.colors.length ? <ul className="wc-product-card__colors" aria-label="굿즈 색상">{listingAppearance.colors.map(chip => <li key={chip.label} title={chip.label}><span style={{ backgroundColor: chip.hex }} /><span className="wc-sr-only">{chip.label}</span></li>)}</ul> : null}
        <PriceBlock compareAtPrice={compareAtPrice} price={price} priceMax={priceMax} showDiscountRate={showDiscountRate} variant="inline" />
        {/* 칩 줄은 가격 바로 아래다(Figma). 예약판매·무료배송·캡슐토이는 굿즈 데이터에서, 운영 배지는 저장 배지에서 온다.
            판매 상태를 전하는 텍스트라 숨긴 이미지 링크 밖에 둔다. */}
        {cardChips.length ? (
          <div className="wc-product-card__chips">
            {cardChips.map((chip) => <span className={`wc-x-chip wc-x-chip--${chip.kind}`} key={`${chip.kind}:${chip.label}`}>{chip.label}</span>)}
          </div>
        ) : null}
        {/* 리뷰가 있을 때만 칩 줄 아래 별 다섯 칸 + (리뷰 수). 별은 잉크 한 색이고(DESIGN §2 단일 액센트),
            스크린리더에는 별 문자 대신 숨은 문장을 읽힌다(상세 별점과 같은 반올림). */}
        {reviewSummary && reviewSummary.count > 0 ? (
          <p className="wc-product-card__rating">
            <span aria-hidden className="wc-product-card__stars">
              {'★'.repeat(reviewStarCount(reviewSummary.average))}
              <span className="wc-product-card__stars-empty">{'★'.repeat(5 - reviewStarCount(reviewSummary.average))}</span>
            </span>
            <span aria-hidden className="wc-product-card__rating-count">{`(${reviewSummary.count.toLocaleString('ko-KR')})`}</span>
            <span className="wc-sr-only">{reviewSummaryLabel(reviewSummary)}</span>
          </p>
        ) : null}
        {configured && listing.showDescription && listingAppearance?.description ? <p className="wc-product-card__description">{listingAppearance.description}</p> : null}
        {listSurface === 'standard' && listing.showCart && cartGood ? <div className="wc-product-card__cart"><AddToCartButton good={cartGood} /></div> : null}
      </div>
    </article>
  );
}
