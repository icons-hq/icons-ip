'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useStorePresentation } from '@/components/shell/StorePresentationProvider';
import { AddToCartButton } from '@/components/shop/AddToCartButton';
import type { Good } from '@/lib/data';
import type { GoodsListingAppearance } from '@/lib/store-presentation';
import { Badge } from '@/components/wc/Badge';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { goodsImageBackground } from '@/lib/goods-image';
import { goodsSaleUnavailableLabel, type GoodsSalePeriod } from '@/lib/goods-sale-period';

export interface ProductCardProps {
  href: string;
  name: string;
  brand?: string | null;
  price: number;
  priceMax?: number;
  compareAtPrice?: number | null;
  showDiscountRate?: boolean;
  badges?: string[];
  soldOut?: boolean;
  salePeriod?: GoodsSalePeriod;
  imageBackground?: string;
  image?: ReactNode;
  action?: ReactNode;
  className?: string;
  listSurface?: 'standard' | 'best' | 'story' | 'preview';
  listingAppearance?: GoodsListingAppearance;
  cartGood?: Good;
  imageShape?: 'square' | 'portrait';
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
 * '(품절)'이 그 상태를 대신 읽어주는 유일한 지점이다(WCAG 1.3.1).
 */
export function ProductCard({
  action,
  badges,
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
  listSurface = 'preview',
  listingAppearance,
  cartGood,
  imageShape,
}: ProductCardProps) {
  const { listing } = useStorePresentation();
  const configured = listSurface !== 'preview';
  const gallery = configured && listing.imageMode === 'gallery' ? [...new Set([imageBackground ?? '', ...(listingAppearance?.gallery ?? [])])].filter(Boolean).slice(0, 10) : [];
  const [imageIndex, setImageIndex] = useState(0);
  const selectedImage = gallery.length ? gallery[imageIndex % gallery.length] : imageBackground;
  const visibleBadges = configured && !listing.showTags ? badges?.filter(badge => !['BEST', 'NEW'].includes(badge.toUpperCase())) : badges;
  const saleLabel = goodsSaleUnavailableLabel(salePeriod ?? cartGood?.salePeriod);
  const availabilityLabel = saleLabel ?? (soldOut ? '품절' : null);
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
        {visibleBadges?.length ? (
          <div className="wc-product-card__badges">
            {/* SALE 만 흰 바탕 + 틴트 테두리 아웃라인이다 — NEW·EXCLUSIVE 같은 저장 배지(색 바탕)와
                할인에서 파생된 표기를 모양으로 가른다(R-03 §1.5 · 11 CL-03). */}
            {visibleBadges.map((badge) => <Badge key={badge} variant={badge === 'SALE' ? 'outline' : 'tint'}>{badge}</Badge>)}
          </div>
        ) : null}
        {brand ? <p className="wc-product-card__brand">{brand}</p> : null}
        <h3 className="wc-product-card__name">
          <Link className="wc-product-card__name-link" href={href}>{name}</Link>
          {availabilityLabel ? <span className="wc-sr-only"> ({availabilityLabel})</span> : null}
        </h3>
        {configured && listing.showColors && listingAppearance?.colors.length ? <ul className="wc-product-card__colors" aria-label="굿즈 색상">{listingAppearance.colors.map(chip => <li key={chip.label} title={chip.label}><span style={{ backgroundColor: chip.hex }} /><span className="wc-sr-only">{chip.label}</span></li>)}</ul> : null}
        <PriceBlock compareAtPrice={compareAtPrice} price={price} priceMax={priceMax} showDiscountRate={showDiscountRate} />
        {configured && listing.showDescription && listingAppearance?.description ? <p className="wc-product-card__description">{listingAppearance.description}</p> : null}
        {listSurface === 'standard' && listing.showCart && cartGood ? <div className="wc-product-card__cart"><AddToCartButton good={cartGood} /></div> : null}
      </div>
    </article>
  );
}
