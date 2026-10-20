'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useStorePresentation } from '@/components/shell/StorePresentationProvider';
import { AddToCartButton } from '@/components/shop/AddToCartButton';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { goodsSaleUnavailableLabel } from '@/lib/goods-sale-period';
import { WishlistHeart } from '@/components/shop/WishlistHeart';
import { EmptyState } from '@/components/wc/EmptyState';
import { MypageShell } from '@/components/wc/MypageShell';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { WcButton } from '@/components/wc/WcButton';
import { Badge } from '@/components/wc/Badge';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import type { CatalogSnapshot } from '@/lib/catalog';
import { goodsImageBackground } from '@/lib/goods-image';
import type { Good, Ip } from '@/lib/data';
import type { WishlistEntry } from '@/lib/wishlist.server';

/*
 * 위시리스트 화면 (#326 S4).
 *
 * 그리드가 아니라 리스트 행이다. 찜한 굿즈는 "다시 보러 온 것"이라 이름·가격·담기를
 * 한 줄에서 비교하는 편이 빠르고, 하트를 카드 위에 겹치면 해제 버튼이 이미지 링크와
 * 같은 자리를 다툰다(R-02·04 실측).
 *
 * 카탈로그에서 사라진 굿즈(보관·삭제)도 행을 지운다: 찜 기록은 남아 있는데 목록에서
 * 조용히 빠지면 사용자는 자기가 해제한 줄 안다. 판매 종료로 표시하고 해제 수단을 남긴다.
 */

export interface WishlistProps {
  catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>;
  entries: WishlistEntry[];
}

interface WishlistLine {
  goodId: string;
  good: Good | null;
  ip: Ip | null;
}

function shopCta() {
  return (
    <WcButton href="/shop" variant="primary">
      굿즈샵 둘러보기
    </WcButton>
  );
}

function WishlistRow({ line }: { line: WishlistLine }) {
  const { good, goodId, ip } = line;
  const { listing } = useStorePresentation();
  const [imageIndex, setImageIndex] = useState(0);

  if (!good) {
    return (
      <li className="wc-wishlist__row">
        <span aria-hidden className="wc-wishlist__media" />
        <div className="wc-wishlist__info">
          <p className="wc-wishlist__name">판매 종료</p>
          <p className="wc-wishlist__state">더 이상 판매하지 않는 굿즈예요.</p>
        </div>
        <div className="wc-wishlist__actions">
          <WishlistHeart goodId={goodId} initialWished />
        </div>
      </li>
    );
  }

  const soldOut = good.stock === 'soldout' || good.stockQty <= 0;
  const saleLabel = goodsSaleUnavailableLabel(good.salePeriod);
  const gallery = listing.imageMode === 'gallery' ? [...new Set([good.img, ...(good.listingAppearance?.gallery ?? [])])].filter(Boolean).slice(0, 10) : [good.img];
  const badges = goodDisplayBadges(good).filter(badge => listing.showTags || !['BEST', 'NEW'].includes(badge.toUpperCase()));

  return (
    <li className="wc-wishlist__row">
      <div className="wc-wishlist__media" data-list-shape={listing.imageShape}><Link aria-hidden className="wc-wishlist__media-link" href={`/shop/${good.id}`} tabIndex={-1}>
        <span className="wc-wishlist__image" style={{ background: goodsImageBackground(gallery[imageIndex % gallery.length]) }} />
      </Link>{gallery.length > 1 ? <div className="wc-product-card__gallery" aria-label={`${good.name} 이미지 선택`}><button type="button" aria-label={`${good.name} 이전 이미지`} onClick={() => setImageIndex(index => (index + gallery.length - 1) % gallery.length)}>‹</button><span aria-live="polite">{imageIndex % gallery.length + 1} / {gallery.length}</span><button type="button" aria-label={`${good.name} 다음 이미지`} onClick={() => setImageIndex(index => (index + 1) % gallery.length)}>›</button></div> : null}</div>
      <div className="wc-wishlist__info">
        {badges.length ? <div className="wc-product-card__badges">{badges.map(badge => <Badge key={badge}>{badge}</Badge>)}</div> : null}
        {ip ? <p className="wc-wishlist__brand">{ip.title}</p> : null}
        <p className="wc-wishlist__name">
          <Link className="wc-wishlist__name-link" href={`/shop/${good.id}`}>{good.name}</Link>
          {saleLabel || soldOut ? <span className="wc-sr-only"> ({saleLabel ?? '품절'})</span> : null}
        </p>
        {listing.showColors && good.listingAppearance?.colors.length ? <ul className="wc-product-card__colors" aria-label="굿즈 색상">{good.listingAppearance.colors.map(chip => <li key={chip.label} title={chip.label}><span style={{ backgroundColor: chip.hex }} /><span className="wc-sr-only">{chip.label}</span></li>)}</ul> : null}
        <PriceBlock showDiscountRate={good.showDiscountRate} compareAtPrice={good.compareAtPrice} price={good.price} />
        {saleLabel ? <p className="wc-wishlist__state">{saleLabel}</p> : null}
        {listing.showDescription && good.listingAppearance?.description ? <p className="wc-product-card__description">{good.listingAppearance.description}</p> : null}
      </div>
      <div className="wc-wishlist__actions">
        <WishlistHeart goodId={good.id} initialWished />
        {listing.showCart ? <AddToCartButton good={good} /> : null}
      </div>
    </li>
  );
}

export function Wishlist({ catalog, entries }: WishlistProps) {
  const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
  const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));

  const lines: WishlistLine[] = entries.map((entry) => {
    const good = goodsById.get(entry.goodId) ?? null;
    return { goodId: entry.goodId, good, ip: good ? ipsById.get(good.ip) ?? null : null };
  });

  return (
    <MypageShell active="/my/wishlist">
      <GoodsSalePeriodRefresh goods={catalog.goods} />
      <section aria-labelledby="wishlist-heading" className="wc-wishlist">
        <div className="wc-mypage__headbar">
          <h1 className="wc-mypage__headbar-title" id="wishlist-heading">위시리스트</h1>
        </div>
        {lines.length ? (
          <ul className="wc-wishlist__list">
            {lines.map((line) => <WishlistRow key={line.goodId} line={line} />)}
          </ul>
        ) : (
          <EmptyState
            action={shopCta()}
            description="마음에 드는 굿즈를 하트로 담아 두면 여기에 모여요."
            title="아직 찜한 굿즈가 없어요"
          />
        )}
      </section>
    </MypageShell>
  );
}
